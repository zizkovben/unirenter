// api/messages/send.js — POST /api/messages/send
const { createClient } = require('@supabase/supabase-js');
const notifyRecipient = require('./notify');

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

    // S155a: confidential scam-pattern flag — never blocks the send, never
    // surfaced to the sender. Recorded against the actual recipient so a
    // later session's cross-user aggregation (3-strike ladder, V170 spec)
    // can count distinct reporters per category per sender.
    try {
      const matched = matchScamPatterns(trimmed);
      if (matched.length > 0) {
        await supabase.from('message_flags').insert({
          message_id: data.id,
          sender_email,
          recipient_email: resolvedRecipientEmail,
          category: 'scam',
          matched_terms: matched,
        });
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
