// api/messages/get.js — GET /api/messages/get?email=X&other=Y&city=Z
// Returns the conversation thread between email and other_email
// Also returns the list of all conversations (sidebar) if other is omitted
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // S151: confirmed via live Network tab that a sibling endpoint (household/get.js)
  // was being served as a cached 304 with no body on repeat identical calls,
  // which throws client-side on res.json(). This endpoint is called just as
  // repetitively (45s polling, tab switches, and the new S151 match-card
  // connected-state check) so it gets the same explicit no-store treatment
  // pre-emptively rather than waiting for it to fail the same way.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const rawQuery = req.query || {};
  // S135: normalize casing at the source — matches the same fix in send.js.
  // Without this, "User@Gmail.com" and "user@gmail.com" show up as two
  // separate conversation partners for the same real person.
  const email = (rawQuery.email || '').trim().toLowerCase();
  const other = rawQuery.other ? rawQuery.other.trim().toLowerCase() : undefined;
  const city = rawQuery.city;

  if (!email) return res.status(400).json({ error: 'Missing email' });

  // ── Mode 1: return all conversations for sidebar ──────────────────────────
  if (!other) {
    // Get all messages involving this user
    // S150: ilike here too (escaped) — eq() would silently miss any legacy
    // row where the current user's own address was stored in a different
    // case before the S135/S136 normalization fix, dropping that message
    // (and possibly a whole conversation) from the sidebar entirely.
    const escapeIlike0 = (s) => s.replace(/[%_]/g, ch => '\\' + ch);
    const emailPat0 = escapeIlike0(email);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_email.ilike.${emailPat0},recipient_email.ilike.${emailPat0}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Messages list error:', error);
      return res.status(500).json({ error: 'Failed to load conversations' });
    }

    // Group by conversation partner
    // S150: normalize both sides to lowercase before comparing/grouping.
    // Rows written before the S135/S136 case-normalization fix may still
    // have mixed-case sender/recipient emails. Without this, a legacy
    // mixed-case row (a) fails to match `email` in the eq() filter above
    // for some rows, (b) can split one real conversation into two entries
    // keyed by different casings, and (c) causes the profile lookup below
    // to miss a genuinely-complete profile, wrongly falling back to the
    // email-derived name — this was reported as "Steve" showing as
    // "Benrsl" in Messages despite display_name being set and correctly
    // shown on match cards (which don't share this lookup path).
    const convMap = {};
    (data || []).forEach(msg => {
      const senderLower = (msg.sender_email || '').toLowerCase();
      const recipientLower = (msg.recipient_email || '').toLowerCase();
      const partner = senderLower === email ? recipientLower : senderLower;
      if (!convMap[partner]) {
        convMap[partner] = {
          partner_email: partner,
          last_message: msg.body,
          last_time: msg.created_at,
          unread: 0,
          city: msg.city,
          // S144: lifecycle tracking fields, computed from the full message
          // history already fetched above — no extra queries needed.
          first_message_at: msg.created_at,
          last_message_at: msg.created_at,
          sawFromMe: false,
          sawFromThem: false,
        };
      }
      const c = convMap[partner];
      if (new Date(msg.created_at) < new Date(c.first_message_at)) c.first_message_at = msg.created_at;
      if (new Date(msg.created_at) > new Date(c.last_message_at)) c.last_message_at = msg.created_at;
      if (senderLower === email) c.sawFromMe = true; else c.sawFromThem = true;
      // Count unread (messages TO me that I haven't read)
      if (recipientLower === email && !msg.read) {
        convMap[partner].unread++;
      }
    });

    // S144c: household exemption — confirmed schema (screenshot, this session):
    // household_members(household_id uuid, email text, joined_at timestamptz).
    // If two people share a household_id, they're living together — their
    // thread should never silently archive/hide, they may still need it for
    // day-to-day logistics regardless of how long since they last messaged.
    let householdCoMembers = new Set();
    try {
      const { data: myHouseholds } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('email', email);
      const householdIds = [...new Set((myHouseholds || []).map(r => r.household_id))];
      if (householdIds.length > 0) {
        const { data: coMembers } = await supabase
          .from('household_members')
          .select('email')
          .in('household_id', householdIds)
          .neq('email', email);
        (coMembers || []).forEach(r => householdCoMembers.add(r.email));
      }
    } catch (householdErr) {
      console.warn('household lookup error (non-fatal):', householdErr.message);
    }

    // S146: per-pair, lease-aware exemption — replaces the S144c "forever"
    // rule. A household pair should eventually re-enter the normal decay
    // clock once BOTH people's leases have genuinely ended, rather than
    // staying exempt indefinitely regardless of reality. Uses
    // lease_companions.lease_end (one row per email, upserted from the
    // Lease Companion tool). Missing lease data on either side still
    // trusts the exemption — never penalise someone for not having filled
    // Lease Companion in. The full Cob end-of-tenancy prompt (bible
    // Household Ecosystem §2) is a future session; this only wires up the
    // underlying decay logic it will eventually gate further.
    const LEASE_GRACE_DAYS = 14;
    let leaseEndByEmail = {};
    if (householdCoMembers.size > 0) {
      try {
        const leaseEmails = [email, ...householdCoMembers];
        const { data: leaseRows } = await supabase
          .from('lease_companions')
          .select('email, lease_end')
          .in('email', leaseEmails);
        (leaseRows || []).forEach(r => { if (r.lease_end) leaseEndByEmail[r.email] = r.lease_end; });
      } catch (leaseErr) {
        console.warn('lease_companions lookup error (non-fatal):', leaseErr.message);
      }
    }
    function pairLeaseExpired(myEmail, partnerEmail) {
      const myEnd = leaseEndByEmail[myEmail];
      const theirEnd = leaseEndByEmail[partnerEmail];
      if (!myEnd || !theirEnd) return false; // missing data on either side → trust the exemption
      const graceMs = LEASE_GRACE_DAYS * 86400000;
      const nowMs = Date.now();
      return (nowMs - new Date(myEnd).getTime()) > graceMs && (nowMs - new Date(theirEnd).getTime()) > graceMs;
    }

    // S144b: revised per Ben — ALL conversations decay by time-since-last-
    // activity, including ones with a real back-and-forth (has_reply=true).
    // Two people who matched, chatted, then went quiet are just as "stale"
    // as an unanswered opener — the goal is clearing redundant chat clutter,
    // not just flagging ignored requests. `has_reply` is still tracked and
    // returned (used to pick badge language — "no reply yet" vs "gone
    // quiet after connecting"). Confirmed households (S144c) get a
    // conditional exemption — see S146 pairLeaseExpired() above: exempt
    // unless both people's leases have genuinely ended (+ grace period).
    const now = Date.now();
    Object.values(convMap).forEach(c => {
      const hasReply = c.sawFromMe && c.sawFromThem;
      const isHousehold = householdCoMembers.has(c.partner_email);
      const daysSinceLast = (now - new Date(c.last_message_at).getTime()) / 86400000;
      let status = 'active';
      let expiresInDays = null;
      // S146: household exemption is now conditional, not unconditional.
      // Still exempt (and stays that way) when either lease is missing or
      // still active — only falls through to normal decay once BOTH
      // people's leases have ended past the grace period.
      const leaseExempt = isHousehold && !pairLeaseExpired(email, c.partner_email);
      if (leaseExempt) {
        status = 'active'; // confirmed housemates, lease still active (or unknown) — exempt
      } else if (daysSinceLast >= 90) status = 'deleted';
      else if (daysSinceLast >= 30) status = 'archived';
      else if (daysSinceLast >= 7) status = 'cooling';
      else { status = 'active'; expiresInDays = Math.max(0, Math.ceil(7 - daysSinceLast)); }
      c.has_reply = hasReply;
      c.is_household = isHousehold;
      c.status = status;
      c.expires_in_days = expiresInDays;
      c.days_inactive = Math.floor(daysSinceLast);
    });

    // S145: post-match follow-up flow. Look up any existing message_threads
    // rows for this user's conversations to read followup_dismissed — a
    // one-time nudge ("Create a household / Leave a review / Not needed")
    // should never reappear once the user has acted on or dismissed it for
    // a given partner. Keyed by the same sorted participant_a/b pair used
    // by the write-through sync below, so lookups line up exactly.
    let followupDismissedSet = new Set();
    try {
      const pairKeys = Object.keys(convMap).map(partner => [email, partner].sort().join('|'));
      if (pairKeys.length > 0) {
        const { data: threadRows } = await supabase
          .from('message_threads')
          .select('participant_a, participant_b, followup_dismissed')
          .or(`participant_a.eq.${email},participant_b.eq.${email}`);
        (threadRows || []).forEach(r => {
          if (r.followup_dismissed) followupDismissedSet.add([r.participant_a, r.participant_b].sort().join('|'));
        });
      }
    } catch (followupErr) {
      console.warn('followup_dismissed lookup error (non-fatal):', followupErr.message);
    }

    // S144: write-through sync to message_threads so a future scheduled job
    // (e.g. the 7-day nudge email) can read authoritative status without
    // re-scanning the full messages table. Non-blocking — never fails the request.
    try {
      const threadRows = Object.values(convMap).map(c => {
        const [participant_a, participant_b] = [email, c.partner_email].sort();
        return {
          participant_a, participant_b,
          first_sender: c.sawFromMe ? email : c.partner_email, // best-effort on backfill
          first_message_at: c.first_message_at,
          last_message_at: c.last_message_at,
          has_reply: c.has_reply,
          status: c.status,
          status_updated_at: new Date().toISOString(),
        };
      });
      if (threadRows.length > 0) {
        await supabase.from('message_threads').upsert(threadRows, { onConflict: 'participant_a,participant_b' });
      }
    } catch (syncErr) {
      console.warn('message_threads sync error (non-fatal):', syncErr.message);
    }

    // S144: 'deleted' (90+ days, never replied to) is a soft hide — the rows
    // still exist in Supabase, they just drop out of the sidebar list.
    // S155a: also hide anyone *I've* blocked — confidential, so this only
    // ever looks at blocks where I'm the blocker, never the blocked side.
    let blockedByMeSet = new Set();
    try {
      const { data: blockRows } = await supabase
        .from('user_blocks')
        .select('blocked_email')
        .eq('blocker_email', email);
      (blockRows || []).forEach(r => blockedByMeSet.add((r.blocked_email || '').toLowerCase()));
    } catch (blockErr) {
      console.warn('user_blocks lookup error (non-fatal):', blockErr.message);
    }
    const visiblePartners = Object.values(convMap).filter(c => c.status !== 'deleted' && !blockedByMeSet.has(c.partner_email));

    // Fetch display names for all partners
    // S150: partnerEmails is now always lowercase (see grouping above), but
    // profiles.email itself may still hold mixed case for accounts created
    // before the S136 normalization fix. Use ilike (case-insensitive) per
    // email rather than .in(), which is case-sensitive and would silently
    // miss those rows — that miss was the actual cause of a real display
    // name showing as the email-derived fallback instead.
    const partnerEmails = visiblePartners.map(c => c.partner_email);
    let profileMap = {};
    if (partnerEmails.length > 0) {
      // Escape % and _ (SQL LIKE/ILIKE wildcards) since real email addresses
      // commonly contain underscores — without this, "john_doe@x.com" would
      // match "john%doe@x.com" style near-misses via the wildcard, not just
      // the exact address.
      const escapeIlike = (s) => s.replace(/[%_]/g, ch => '\\' + ch);
      const orFilter = partnerEmails.map(e => `email.ilike.${escapeIlike(e)}`).join(',');
      const { data: profiles, error: profilesErr } = await supabase
        .from('profiles')
        .select('email, display_name, university, suburb_preferences')
        .or(orFilter);
      // S150: this query was previously also selecting `match_score`, which
      // is a value computed on the fly by api/matches.js's scoring algorithm
      // — it has never been a real column on `profiles`. That made this
      // select fail with a 42703 error on every single call, and because
      // the error wasn't checked, it failed silently: profiles stayed
      // undefined, profileMap stayed empty, and every display_name fell
      // back to nameFromEmail() regardless of case. This was likely the
      // primary cause of real names showing wrong in Messages while match
      // cards (a different query, in api/matches.js) worked fine.
      if (profilesErr) console.error('profiles lookup error:', profilesErr);
      (profiles || []).forEach(p => { profileMap[(p.email || '').toLowerCase()] = p; });
    }

    // S135: fall back to a name derived from the partner's email local-part
    // (matches the pattern already used in send.js's notify call) instead of
    // a generic "Housemate" — this only fires for genuinely-incomplete
    // profiles (display_name written on Step 2, so abandoned signups before
    // that point have none), but a real name-ish fallback beats a placeholder.
    function nameFromEmail(email) {
      const local = (email || '').split('@')[0] || 'Student';
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    const conversations = visiblePartners.map(c => {
      const profile = profileMap[c.partner_email] || {};
      // S145: nudge shows for genuinely quiet, real (has_reply) conversations
      // that aren't already a confirmed household — no point suggesting
      // "create a household" to people already living together, and no
      // point nudging an unanswered opener that was never a two-way chat.
      const pairKey = [email, c.partner_email].sort().join('|');
      const showFollowup = (c.status === 'cooling' || c.status === 'archived')
        && c.has_reply
        && !c.is_household
        && !followupDismissedSet.has(pairKey);
      return {
        partner_email: c.partner_email,
        last_message: c.last_message,
        last_time: c.last_time,
        unread: c.unread,
        city: c.city,
        status: c.status,
        expires_in_days: c.expires_in_days,
        days_inactive: c.days_inactive,
        has_reply: c.has_reply,
        is_household: c.is_household,
        show_followup: showFollowup,
        display_name: profile.display_name || nameFromEmail(c.partner_email),
        university: profile.university || null,
        suburb_preferences: profile.suburb_preferences || [],
      };
    });

    // Sort by last_time desc
    conversations.sort((a, b) => new Date(b.last_time) - new Date(a.last_time));

    const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

    return res.status(200).json({ conversations, totalUnread });
  }

  // ── Mode 2: return thread between email and other ─────────────────────────
  // S150: same case-sensitivity issue as Mode 1 — eq() is case-sensitive,
  // so legacy mixed-case rows could fail to match here and the thread would
  // silently come back empty. ilike (with wildcards escaped) matches
  // case-insensitively while still requiring an exact address otherwise.
  const escapeIlike = (s) => s.replace(/[%_]/g, ch => '\\' + ch);
  const emailPat = escapeIlike(email);
  const otherPat = escapeIlike(other || '');
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_email.ilike.${emailPat},recipient_email.ilike.${otherPat}),and(sender_email.ilike.${otherPat},recipient_email.ilike.${emailPat})`
    )
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Thread load error:', error);
    return res.status(500).json({ error: 'Failed to load thread' });
  }

  // Mark messages from other → me as read
  await supabase
    .from('messages')
    .update({ read: true })
    .ilike('sender_email', otherPat)
    .ilike('recipient_email', emailPat)
    .eq('read', false);

  // S155a/b: confidential flag lookup — deliberately scoped to
  // recipient_email = email (the viewer). If the viewer is the sender of a
  // flagged message, this query returns nothing for it, so flags (and
  // Cob's bubble) are only ever visible on the recipient's own fetch of
  // the thread, never the sender's. Category-aware since S155b added
  // categories beyond scam (harassment, spam, impersonation, etc).
  let flagCategoriesByMessage = {};
  try {
    const { data: flagRows } = await supabase
      .from('message_flags')
      .select('message_id, category')
      .eq('recipient_email', email)
      .eq('sender_email', other);
    (flagRows || []).forEach(r => {
      if (!r.message_id) return; // manual reports / fast-track blocks aren't tied to a message
      if (!flagCategoriesByMessage[r.message_id]) flagCategoriesByMessage[r.message_id] = [];
      flagCategoriesByMessage[r.message_id].push(r.category);
    });
  } catch (flagErr) {
    console.warn('message_flags lookup error (non-fatal):', flagErr.message);
  }

  // S155a: tell the viewer's own client whether *they* blocked this
  // contact (never whether the contact blocked them) so the composer can
  // be disabled with an honest "you've blocked this contact" state.
  let youBlockedThem = false;
  try {
    const { data: blockRow } = await supabase
      .from('user_blocks')
      .select('id')
      .eq('blocker_email', email)
      .eq('blocked_email', other)
      .maybeSingle();
    youBlockedThem = !!blockRow;
  } catch (blockErr) {
    console.warn('user_blocks lookup error (non-fatal):', blockErr.message);
  }

  const messagesWithFlags = (data || []).map(m => ({
    ...m,
    flag_categories: flagCategoriesByMessage[m.id] || [],
  }));

  return res.status(200).json({ messages: messagesWithFlags, you_blocked_them: youBlockedThem });
};
