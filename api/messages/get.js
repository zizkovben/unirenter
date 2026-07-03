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
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_email.eq.${email},recipient_email.eq.${email}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Messages list error:', error);
      return res.status(500).json({ error: 'Failed to load conversations' });
    }

    // Group by conversation partner
    const convMap = {};
    (data || []).forEach(msg => {
      const partner = msg.sender_email === email ? msg.recipient_email : msg.sender_email;
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
      if (msg.sender_email === email) c.sawFromMe = true; else c.sawFromThem = true;
      // Count unread (messages TO me that I haven't read)
      if (msg.recipient_email === email && !msg.read) {
        convMap[partner].unread++;
      }
    });

    // S144: derive Active / Cooling / Archived / Deleted per conversation.
    // A thread only "decays" while it's a one-sided, unanswered request
    // (has_reply === false). The moment both people have sent at least one
    // message, it's a real ongoing conversation and stays 'active' — pauses
    // in an established conversation are normal and shouldn't get flagged
    // as a stale lead the way an unanswered opener should.
    const now = Date.now();
    Object.values(convMap).forEach(c => {
      const hasReply = c.sawFromMe && c.sawFromThem;
      const daysSinceLast = (now - new Date(c.last_message_at).getTime()) / 86400000;
      let status = 'active';
      let expiresInDays = null;
      if (!hasReply) {
        if (daysSinceLast >= 90) status = 'deleted';
        else if (daysSinceLast >= 30) status = 'archived';
        else if (daysSinceLast >= 7) status = 'cooling';
        else { status = 'active'; expiresInDays = Math.max(0, Math.ceil(7 - daysSinceLast)); }
      }
      c.has_reply = hasReply;
      c.status = status;
      c.expires_in_days = expiresInDays;
    });

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
    const visiblePartners = Object.values(convMap).filter(c => c.status !== 'deleted');

    // Fetch display names for all partners
    const partnerEmails = visiblePartners.map(c => c.partner_email);
    let profileMap = {};
    if (partnerEmails.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('email, display_name, university, suburb_preferences, match_score')
        .in('email', partnerEmails);
      (profiles || []).forEach(p => { profileMap[p.email] = p; });
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
      return {
        partner_email: c.partner_email,
        last_message: c.last_message,
        last_time: c.last_time,
        unread: c.unread,
        city: c.city,
        status: c.status,
        expires_in_days: c.expires_in_days,
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
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_email.eq.${email},recipient_email.eq.${other}),and(sender_email.eq.${other},recipient_email.eq.${email})`
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
    .eq('sender_email', other)
    .eq('recipient_email', email)
    .eq('read', false);

  return res.status(200).json({ messages: data || [] });
};
