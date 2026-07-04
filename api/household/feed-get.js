// api/household/feed-get.js — S147, Household Ecosystem Expansion step 4
// GET /api/household/feed-get?household_id=<uuid>&email=<email>&count_only=1
// Returns unified household feed (chat/note/todo/reminder), who's accepted each
// dated item, and an unread count computed against household_members.last_feed_read_at.
// CommonJS

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { household_id, email, count_only } = req.query || {};
    if (!household_id) return res.status(400).json({ ok: false, error: 'household_id required' });
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });

    const cleanEmail = String(email).toLowerCase().trim();

    // Verify caller is a member of this household + fetch their last_feed_read_at
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id, last_feed_read_at')
      .eq('household_id', household_id)
      .eq('email', cleanEmail)
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ ok: false, error: 'Not a member of this household.' });
    }

    const lastRead = membership.last_feed_read_at || null;

    // ── count_only mode: cheap unread-count check for the nav badge ──────────
    if (count_only) {
      let query = supabase
        .from('household_feed')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', household_id)
        .neq('author_email', cleanEmail);
      if (lastRead) query = query.gt('created_at', lastRead);
      const { count, error: countErr } = await query;
      if (countErr) {
        console.warn('feed-get count_only error (non-fatal):', countErr.message);
        return res.status(200).json({ ok: true, unread_count: 0 });
      }
      return res.status(200).json({ ok: true, unread_count: count || 0 });
    }

    // ── Full feed fetch ────────────────────────────────────────────────────
    const { data: feedRows, error: feedErr } = await supabase
      .from('household_feed')
      .select('id, household_id, author_email, type, text, event_date, created_at')
      .eq('household_id', household_id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (feedErr) {
      console.error('household_feed fetch error:', feedErr);
      // Table probably doesn't exist yet — return empty rather than a hard error,
      // consistent with the message_threads / lease_companions non-fatal pattern.
      return res.status(200).json({ ok: true, items: [], unread_count: 0 });
    }

    const rows = feedRows || [];
    const feedIds = rows.map(function (r) { return r.id; });

    // Acks for these items
    let acksByFeed = {};
    if (feedIds.length) {
      const { data: ackRows } = await supabase
        .from('household_feed_acks')
        .select('feed_id, member_email')
        .in('feed_id', feedIds);
      (ackRows || []).forEach(function (a) {
        if (!acksByFeed[a.feed_id]) acksByFeed[a.feed_id] = [];
        acksByFeed[a.feed_id].push(a.member_email);
      });
    }

    // Author display names
    const authorEmails = Array.from(new Set(rows.map(function (r) { return r.author_email; })));
    let nameMap = {};
    if (authorEmails.length) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('email, display_name')
        .in('email', authorEmails);
      (profileRows || []).forEach(function (p) { nameMap[p.email] = p.display_name; });
    }

    const items = rows.map(function (r) {
      const acked_by = acksByFeed[r.id] || [];
      return {
        id: r.id,
        author_email: r.author_email,
        author_name: nameMap[r.author_email] || null,
        type: r.type,
        text: r.text,
        event_date: r.event_date || null,
        created_at: r.created_at,
        acked_by: acked_by,
        accepted_by_me: acked_by.indexOf(cleanEmail) !== -1
      };
    });

    let unread_count = 0;
    rows.forEach(function (r) {
      if (r.author_email === cleanEmail) return;
      if (!lastRead || new Date(r.created_at) > new Date(lastRead)) unread_count++;
    });

    return res.status(200).json({ ok: true, items: items, unread_count: unread_count });

  } catch (err) {
    console.error('household/feed-get unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};
