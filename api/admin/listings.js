const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('./_verify');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const payload = verifyToken(req.headers['authorization'], process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorised' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Query params: ?queue=pending_review | ?queue=flagged | ?city=brisbane
  const { queue, city } = req.query;

  let query = supabase
    .from('lease_listings')
    .select('id, ref, city, status, report_count, created_at, expires_at, poster_email, suburb, property_type, weekly_rent, scam_signals')
    .order('created_at', { ascending: false })
    .limit(200);

  if (queue === 'pending_review') {
    query = query.eq('status', 'pending_review');
  } else if (queue === 'flagged') {
    query = query.gte('report_count', 3).eq('status', 'active');
  }

  if (city) {
    query = query.eq('city', city);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Admin listings error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, listings: data || [] });
};
