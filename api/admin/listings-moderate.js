// api/admin/listings-moderate.js
// POST — approve / reject / resolve a lease listing
// Renamed from api/admin/listings/moderate.js (3-level nesting not supported by Vercel)
// CommonJS

const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('./_verify');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const payload = verifyToken(req.headers.authorization, process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ error: 'Unauthorised' });

  const { listing_id, action } = req.body || {};
  if (!listing_id || !action) {
    return res.status(400).json({ error: 'listing_id and action required' });
  }

  const validActions = ['approve', 'reject', 'resolve'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
  }

  let update = { moderated_at: new Date().toISOString() };

  if (action === 'approve') {
    update.status = 'active';
  } else if (action === 'reject') {
    update.status = 'rejected';
  } else if (action === 'resolve') {
    // Clear report count, keep active
    update.report_count = 0;
  }

  const { error } = await supabase
    .from('lease_listings')
    .update(update)
    .eq('id', listing_id);

  if (error) {
    console.error('moderate error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ ok: true, action, listing_id });
};
