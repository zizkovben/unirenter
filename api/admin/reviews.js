// api/admin/reviews.js
// GET  /api/admin/reviews         — list all reviews (all statuses)
// POST /api/admin/reviews         — approve or reject a review
//   body: { review_id, action: 'approve' | 'reject' }

const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('./_verify');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = verifyToken(req.headers['authorization'], process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorised' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── GET — list all reviews ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, reviewer_name, reviewer_uni, city, rating, review_text, status, created_at')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      return res.status(200).json({ ok: true, reviews: data || [] });
    } catch (err) {
      console.error('Reviews GET error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST — approve or reject ─────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { review_id, action } = req.body || {};
      if (!review_id) return res.status(400).json({ ok: false, error: 'review_id required' });
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'action must be approve or reject' });
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      const { error } = await supabase
        .from('reviews')
        .update({ status: newStatus })
        .eq('id', review_id);

      if (error) throw error;

      return res.status(200).json({ ok: true, status: newStatus });
    } catch (err) {
      console.error('Reviews POST error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
