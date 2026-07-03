// api/reviews/public.js
// GET /api/reviews/public?city=melbourne
// Returns approved 4-5 star reviews for a given city (or all cities if no city param).
// Used to gate and populate the review slider on guide, settled, and city pages.
// Gate: slider only shown when 3+ approved reviews exist for the requested city.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const city = req.query.city || null;

    // S145 fix: the underlying column is 'city' (matches api/reviews/submit.js's
    // insert payload) — 'reviewer_city' never existed as a real column, which
    // caused every call to this endpoint to 500. Aliased back to reviewer_city
    // in the select so the response shape (and unirenter-guide.html's existing
    // rv.reviewer_city read) doesn't need to change.
    let query = supabase
      .from('reviews')
      .select('id, reviewer_name, reviewer_uni, reviewer_city:city, rating, review_text, created_at')
      .eq('status', 'approved')
      .gte('rating', 4)
      .order('created_at', { ascending: false })
      .limit(50);

    if (city) {
      query = query.eq('city', city.toLowerCase());
    }

    const { data, error } = await query;

    if (error) {
      console.error('Reviews fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch reviews' });
    }

    const reviews = data || [];

    // Gate: return count so client can decide whether to show slider
    return res.status(200).json({
      reviews,
      count: reviews.length,
      gated: reviews.length < 3  // true = not enough reviews to show slider
    });

  } catch (err) {
    console.error('Unexpected error in /api/reviews/public:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
