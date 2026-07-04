// api/household/feed-mark-read.js — S147, Household Ecosystem Expansion step 4
// POST /api/household/feed-mark-read
// Body: { household_id, email }
// Updates household_members.last_feed_read_at for the caller — powers the
// household feed unread badge the same way messages' unread count is derived
// from raw data rather than a separate cached flag.
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

  try {
    const { household_id, email } = req.body || {};
    if (!household_id || !email) {
      return res.status(400).json({ ok: false, error: 'household_id and email are required' });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    const { error: updateErr } = await supabase
      .from('household_members')
      .update({ last_feed_read_at: new Date().toISOString() })
      .eq('household_id', household_id)
      .eq('email', cleanEmail);

    if (updateErr) {
      console.warn('feed-mark-read update error (non-fatal):', updateErr.message);
      return res.status(200).json({ ok: true, synced: false });
    }

    return res.status(200).json({ ok: true, synced: true });

  } catch (err) {
    console.error('household/feed-mark-read unexpected error:', err);
    return res.status(200).json({ ok: true, synced: false });
  }
};
