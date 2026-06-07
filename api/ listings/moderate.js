const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../_verify');
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
 
  const payload = verifyToken(req.headers['authorization'], process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorised' });
 
  const { listing_id, action } = req.body || {};
 
  if (!listing_id || !action) {
    return res.status(400).json({ ok: false, error: 'listing_id and action required' });
  }
 
  // Valid actions:
  // approve  — pending_review → active
  // reject   — any → rejected
  // resolve  — clears report_count (leaves listing active)
  const validActions = ['approve', 'reject', 'resolve'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ ok: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }
 
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
 
  let update = {};
  if (action === 'approve')  update = { status: 'active', moderated_at: new Date().toISOString() };
  if (action === 'reject')   update = { status: 'rejected', moderated_at: new Date().toISOString() };
  if (action === 'resolve')  update = { report_count: 0, moderated_at: new Date().toISOString() };
 
  const { data, error } = await supabase
    .from('lease_listings')
    .update(update)
    .eq('id', listing_id)
    .select('id, ref, status, report_count')
    .single();
 
  if (error) {
    console.error('Moderate error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
 
  return res.status(200).json({ ok: true, listing: data });
};
