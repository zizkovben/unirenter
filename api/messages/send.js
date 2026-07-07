// api/messages/send.js — POST /api/messages/send
const { createClient } = require('@supabase/supabase-js');
const notifyRecipient = require('./notify');
const { applyFastTrackSuspension, checkStandardLadder, checkAccountEnforcement } = require('./_trust-safety');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BLOCKED_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /\b\d{6}[\s-]\d{6,10}\b/,
  /\b(paypal\.me|cashapp|venmo|binance)\b/i,
  /\bwhatsapp\b/i,
];

// S155a: Cob Trust & Safety — soft scam-pattern detection, reproduced from
// the rental-scam red flags already used in Cob's own system prompt
// (api/cob.js), adapted for peer-to-peer messages. Unlike BLOCKED_PATTERNS
// above (which reject the send outright), a SCAM_PATTERNS match still lets
// the message through — it only logs a CONFIDENTIAL flag (message_flags,
// keyed by the actual recipient) so Cob can show that recipient a private
// safety bubble. The sender is never told their message was flagged.
const SCAM_PATTERNS = [
  { label: 'gift_card_or_crypto',   pattern: /\b(gift\s?cards?|itunes\s?card|google\s?play\s?card|steam\s?card|bitcoin|crypto|usdt|western\s?union|moneygram)\b/i },
  { label: 'pay_before_viewing',    pattern: /\b(pay|send|wire|transfer)\b.{0,25}\b(deposit|bond|rent|money)\b.{0,25}\b(before|without)\b.{0,15}\b(view|inspect|see|meet)\b/i },
  { label: 'cant_meet_in_person',   pattern: /\b(i'?m\s+overseas|currently\s+overseas|can'?t\s+meet\s+in\s+person|out\s+of\s+the\s+country)\b/i },
  { label: 'artificial_urgency',    pattern: /\b(act\s+now|first\s+come\s+first\s+served|before\s+someone\s+else\s+takes\s+it|only\s+available\s+today)\b/i },
];

function matchScamPatterns(text) {
  return SCAM_PATTERNS.filter(p => p.pattern.test(text)).map(p => p.label);
}

// S155b: remaining "standard" categories — same soft-flag behaviour as
// SCAM_PATTERNS above (message still sends, confidential flag logged,
// counts toward 155c's 3-strike ladder). Kept as separate category groups
// rather than one big list so each match records which category it was.
//
// hate_speech intentionally ships with NO real terms below. A regex list of
// slurs is something Claude won't hand-author, and a hard-coded list is a
// poor fit for this category anyway (adversarial spelling variants evade it
// fast). Ben: either paste your own vetted term list into HATE_SPEECH_TERMS,
// or point this category at a dedicated moderation API/vendor instead — the
// category, logging, and bubble all already work end-to-end once matches
// start coming in from either source.
const HATE_SPEECH_TERMS = []; // Ben: populate or replace with a vendor call
const STANDARD_PATTERNS = [
  { category: 'harassment',         label: 'threat_language',        pattern: /\b(i('| a)?ll find you|i know where you live|watch your back|you'?ll regret this)\b/i },
  { category: 'hate_speech',        label: 'term_match',             pattern: HATE_SPEECH_TERMS.length ? new RegExp('\\b(' + HATE_SPEECH_TERMS.join('|') + ')\\b', 'i') : null },
  { category: 'spam',               label: 'promotional_link',       pattern: /\b(click\s+here|buy\s+now|limited\s+time\s+offer|check\s+out\s+my\s+(page|shop|store))\b/i },
  { category: 'impersonation',      label: 'claims_official_role',   pattern: /\b(official\s+unirenter\s+(support|staff|admin)|i\s+work\s+for\s+unirenter|this\s+is\s+an?\s+official\s+(message|notice))\b/i },
  { category: 'visa_marriage_dating', label: 'visa_marriage_offer',  pattern: /\b(marry\s+me\s+for\s+a?\s*visa|pay\s+you\s+to\s+marry|fake\s+marriage\s+for\s+visa|need\s+a\s+partner\s+visa)\b/i },
].filter(p => p.pattern); // drops hate_speech until HATE_SPEECH_TERMS is populated

function matchStandardPatterns(text) {
  return STANDARD_PATTERNS.filter(p => p.pattern.test(text)).map(p => ({ category: p.category, label: p.label }));
}

// S155b: fast-track categories — unlike everything else in this file, a
// match here (a) BLOCKS the send outright, like BLOCKED_PATTERNS, and
// (b) immediately suspends the sender's account pending manual review,
// independent of the 155c ladder. No admin review surface ships this
// session (155c) — a suspended account just can't send further messages
// until Ben manually reviews and clears account_status in Supabase.
//
// sexual_exploitation and illegal_goods ship as placeholders for the same
// reason as HATE_SPEECH_TERMS above — these categories deserve a properly
// vetted term list or a dedicated safety vendor, not a regex list
// hand-authored here. violence ships with a small set of concrete threat
// phrases since those are unambiguous and low false-positive.
const FASTTRACK_PATTERNS = [
  { category: 'violence',            label: 'direct_threat', pattern: /\b(i'?m\s+going\s+to\s+(hurt|kill|attack)\s+you|i'?ll\s+hurt\s+you|bringing\s+a\s+weapon\s+to)\b/i },
  { category: 'sexual_exploitation', label: 'term_match',    pattern: null }, // Ben: populate or use a vendor
  { category: 'illegal_goods',       label: 'term_match',    pattern: null }, // Ben: populate or use a vendor
].filter(p => p.pattern);

function matchFasttrackPatterns(text) {
  return FASTTRACK_PATTERNS.filter(p => p.pattern.test(text)).map(p => ({ category: p.category, label: p.label }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = req.body || {};
    // S135: normalize casing at the source — Postgres string comparison is
    // case-sensitive, so "User@Gmail.com" and "user@gmail.com" were being
    // treated as different people, producing phantom duplicate conversation
    // threads for the same real person in the Messages tab.
    const sender_email = (rawBody.sender_email || '').trim().toLowerCase();
    const recipient_email = rawBody.recipient_email ? rawBody.recipient_email.trim().toLowerCase() : null;
    const { recipient_id, city, body } = rawBody;

    // S128: accept recipient_id (UUID from matches API) OR recipient_email
    if (!sender_email || (!recipient_email && !recipient_id) || !city || !body) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const trimmed = (body || '').trim();
    if (!trimmed || trimmed.length > 2000) {
      return res.status(400).json({ error: 'Message must be 1–2000 characters' });
    }
    if (BLOCKED_PATTERNS.some(p => p.test(trimmed))) {
      return res.status(400).json({ error: 'Message contains blocked content' });
    }

    // Verify sender exists and is verified
    const { data: senderProfile, error: senderErr } = await supabase
      .from('profiles')
      .select('email, email_verified, display_name')
      .eq('email', sender_email)
      .single();

    if (senderErr || !senderProfile) {
      return res.status(403).json({ error: 'Sender profile not found' });
    }
    if (!senderProfile.email_verified) {
      return res.status(403).json({ error: 'Sender not verified — please verify your email first' });
    }
    // S155c: replaces the old inline `account_status === 'suspended_pending_review'`
    // check — now handles all enforcement states (fast-track suspension,
    // both ban tiers) and lazily auto-clears suspended_pending_review /
    // banned_2wk once their window has passed. 'warned' never blocks.
    const enforcement = await checkAccountEnforcement(supabase, sender_email);
    if (enforcement.blocked) {
      return res.status(403).json({ error: 'Message could not be sent' });
    }

    // Resolve recipient email — by id (from matches API) or directly
    let resolvedRecipientEmail = recipient_email || null;

    if (!resolvedRecipientEmail && recipient_id) {
      const { data: recipById, error: recipByIdErr } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', recipient_id)
        .single();
      if (recipByIdErr || !recipById || !recipById.email) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
      resolvedRecipientEmail = recipById.email.trim().toLowerCase();
    } else if (resolvedRecipientEmail) {
      const { data: recipientProfile, error: recipientErr } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', resolvedRecipientEmail)
        .single();
      if (recipientErr || !recipientProfile) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
    }

    if (!resolvedRecipientEmail) {
      return res.status(400).json({ error: 'Could not resolve recipient' });
    }

    if (sender_email === resolvedRecipientEmail) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    // S155b/c: fast-track categories — block outright (never delivered)
    // and suspend the sender immediately, pending manual review,
    // independent of the standard ladder. applyFastTrackSuspension() also
    // sends Ben an admin email (S155c) and stamps account_status_since so
    // it lazily auto-clears after 7 days if untouched.
    const fasttrackMatches = matchFasttrackPatterns(trimmed);
    if (fasttrackMatches.length > 0) {
      try {
        await supabase.from('message_flags').insert({
          message_id: null, // message was never inserted — nothing to reference it by
          sender_email,
          recipient_email: resolvedRecipientEmail,
          category: fasttrackMatches[0].category,
          matched_terms: fasttrackMatches.map(m => m.label),
          source: 'detected',
          severity: 'fast_track',
        });
      } catch (fastErr) {
        console.warn('fast-track flag insert error (non-fatal, still blocking send):', fastErr.message);
      }
      await applyFastTrackSuspension(supabase, sender_email, fasttrackMatches[0].category, 'detected');
      return res.status(400).json({ error: 'Message contains blocked content' });
    }

    // S155a: block check — deliberately checked BOTH directions but with a
    // single generic error message either way. If sender blocked recipient
    // (or vice versa), the send silently fails with no indication of which
    // direction the block runs — a blocked sender must never learn they've
    // been blocked, or it defeats the point of a confidential block.
    const { data: blockRows, error: blockErr } = await supabase
      .from('user_blocks')
      .select('id')
      .or(
        `and(blocker_email.eq.${sender_email},blocked_email.eq.${resolvedRecipientEmail}),` +
        `and(blocker_email.eq.${resolvedRecipientEmail},blocked_email.eq.${sender_email})`
      );
    if (blockErr) console.warn('user_blocks check error (non-fatal, allowing send):', blockErr.message);
    if (!blockErr && blockRows && blockRows.length > 0) {
      return res.status(403).json({ error: 'Message could not be sent' });
    }

    // S131: Check if a thread ALREADY EXISTS between these two people in EITHER direction.
    // If a thread exists → allow send (it's a reply, not a duplicate opener).
    // If NO thread exists AND sender has already sent to recipient → block (duplicate opener).
    //
    // A "thread exists" means at least one message exists where:
    //   (sender=A, recipient=B) OR (sender=B, recipient=A)
    const { count: threadCount } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .or(
        `and(sender_email.eq.${sender_email},recipient_email.eq.${resolvedRecipientEmail}),` +
        `and(sender_email.eq.${resolvedRecipientEmail},recipient_email.eq.${sender_email})`
      );

    const threadExists = (threadCount || 0) > 0;

    if (!threadExists) {
      // No thread yet — check if THIS sender has already tried to open (duplicate opener guard)
      const { count: senderCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_email', sender_email)
        .eq('recipient_email', resolvedRecipientEmail);

      if ((senderCount || 0) > 0) {
        return res.status(409).json({ error: 'Already messaged this person' });
      }
    }
    // If threadExists → fall through and allow the reply

    // Insert message
    const { data, error: insertErr } = await supabase
      .from('messages')
      .insert({ sender_email, recipient_email: resolvedRecipientEmail, city, body: trimmed })
      .select()
      .single();

    if (insertErr) {
      console.error('Message insert error:', JSON.stringify(insertErr));
      return res.status(500).json({ error: 'Failed to send message', detail: insertErr.message });
    }

    // S155a/b: confidential pattern flags — never block the send, never
    // surfaced to the sender. Recorded against the actual recipient so
    // 155c's cross-user aggregation (3-strike ladder) can count distinct
    // reporters per category per sender.
    try {
      const scamMatched = matchScamPatterns(trimmed);
      if (scamMatched.length > 0) {
        await supabase.from('message_flags').insert({
          message_id: data.id,
          sender_email,
          recipient_email: resolvedRecipientEmail,
          category: 'scam',
          matched_terms: scamMatched,
          source: 'detected',
          severity: 'standard',
        });
        // S155c: check after every insert — cheap no-op unless this flag
        // happens to be the 3rd distinct person against this category.
        await checkStandardLadder(supabase, sender_email, 'scam');
      }
      const standardMatched = matchStandardPatterns(trimmed);
      for (const m of standardMatched) {
        await supabase.from('message_flags').insert({
          message_id: data.id,
          sender_email,
          recipient_email: resolvedRecipientEmail,
          category: m.category,
          matched_terms: [m.label],
          source: 'detected',
          severity: 'standard',
        });
        await checkStandardLadder(supabase, sender_email, m.category);
      }
    } catch (flagErr) {
      console.warn('message_flags insert error (non-fatal):', flagErr.message);
    }

    // Fire notify only on first message in thread (i.e. threadCount was 0 before this insert)
    if (!threadExists) {
      notifyRecipient({
        recipientEmail: resolvedRecipientEmail,
        senderName: senderProfile.display_name || sender_email.split('@')[0],
        messagePreview: trimmed,
        city,
      });
    }

    // S144: keep message_threads (lifecycle status tracker) in sync.
    // Never let a failure here block the send — it's a secondary write.
    try {
      const [participant_a, participant_b] = [sender_email, resolvedRecipientEmail].sort();
      const nowIso = new Date().toISOString();

      if (!threadExists) {
        // First message ever in this thread — create the tracker row.
        await supabase.from('message_threads').insert({
          participant_a, participant_b,
          first_sender: sender_email,
          first_message_at: nowIso,
          last_message_at: nowIso,
          has_reply: false,
          status: 'active',
          status_updated_at: nowIso,
        });
      } else {
        const { data: existingThread } = await supabase
          .from('message_threads')
          .select('first_sender, has_reply')
          .eq('participant_a', participant_a)
          .eq('participant_b', participant_b)
          .maybeSingle();

        if (existingThread) {
          const hasReply = existingThread.has_reply || (sender_email !== existingThread.first_sender);
          // Any new message means the thread is live again right now —
          // reset status to 'active' and let get.js's lazy decay recompute
          // cooling/archived over time from this fresh last_message_at.
          await supabase.from('message_threads')
            .update({ last_message_at: nowIso, has_reply: hasReply, status: 'active', status_updated_at: nowIso })
            .eq('participant_a', participant_a)
            .eq('participant_b', participant_b);
        } else {
          // Thread existed in messages but predates the message_threads table
          // (pre-S144 conversation never yet backfilled by get.js) — create it now.
          await supabase.from('message_threads').insert({
            participant_a, participant_b,
            first_sender: sender_email,
            first_message_at: nowIso,
            last_message_at: nowIso,
            has_reply: true, // safe assumption: a reply-path send on an untracked existing thread
            status: 'active',
            status_updated_at: nowIso,
          });
        }
      }
    } catch (threadErr) {
      console.warn('message_threads sync error (non-fatal):', threadErr.message);
    }

    return res.status(200).json({ ok: true, message: data });

  } catch (err) {
    console.error('send.js unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
