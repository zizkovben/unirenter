// api/household/feed-tick.js — S147, Household Ecosystem Expansion step 4
// POST /api/household/feed-tick — toggle a member's acceptance of a feed item (upsert/delete)
// Body: { email, feed_id, acked }
// Mirrors the exact upsert/delete mechanic in api/household/agreement-tick.js.
// On a fresh accept of a dated item (note/todo/reminder with event_date), also
// writes it into the accepter's own calendar_events (source: 'household') per
// the project bible spec — non-fatal if that insert fails or already exists.
// CommonJS

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { email, feed_id, acked } = req.body || {};

  if (!email || !feed_id) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const cleanEmail = String(email).toLowerCase().trim();

  // Fetch the feed item to find its household + dated-item details
  const { data: feedItem } = await supabase
    .from('household_feed')
    .select('id, household_id, type, text, event_date')
    .eq('id', feed_id)
    .maybeSingle();

  if (!feedItem) {
    return res.status(404).json({ ok: false, error: 'Feed item not found' });
  }

  // Verify membership
  const { data: memberRow } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', feedItem.household_id)
    .eq('email', cleanEmail)
    .maybeSingle();

  if (!memberRow) {
    return res.status(403).json({ ok: false, error: 'Not a member of this household' });
  }

  if (acked) {
    const { error: upsertErr } = await supabase
      .from('household_feed_acks')
      .upsert(
        { feed_id: feed_id, member_email: cleanEmail, acked_at: new Date().toISOString() },
        { onConflict: 'feed_id,member_email' }
      );

    if (upsertErr) {
      console.error('feed-tick upsert error:', upsertErr);
      return res.status(500).json({ ok: false, error: 'Failed to save acceptance' });
    }

    // Accepting a dated item also writes it into the accepter's own calendar —
    // best-effort, never blocks the tick response.
    if (feedItem.event_date && (feedItem.type === 'todo' || feedItem.type === 'reminder' || feedItem.type === 'note')) {
      try {
        const { data: existing } = await supabase
          .from('calendar_events')
          .select('id')
          .eq('user_email', cleanEmail)
          .eq('source', 'household')
          .eq('date', feedItem.event_date)
          .eq('title', feedItem.text.slice(0, 200))
          .maybeSingle();

        if (!existing) {
          await supabase.from('calendar_events').insert({
            user_email: cleanEmail,
            title: feedItem.text.slice(0, 200),
            category: 'other',
            date: feedItem.event_date,
            source: 'household',
            status: 'pending',
            editable: true,
            created_at: new Date().toISOString()
          });
        }
      } catch (calErr) {
        console.warn('feed-tick calendar sync error (non-fatal):', calErr.message);
      }
    }
  } else {
    const { error: deleteErr } = await supabase
      .from('household_feed_acks')
      .delete()
      .eq('feed_id', feed_id)
      .eq('member_email', cleanEmail);

    if (deleteErr) {
      console.error('feed-tick delete error:', deleteErr);
      return res.status(500).json({ ok: false, error: 'Failed to remove acceptance' });
    }
  }

  return res.status(200).json({ ok: true, acked: !!acked });
};
