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

    // S150 fix: the underlying column is 'text' (confirmed via
    // information_schema.columns — 'review_text' never existed as a real
    // column), which caused every call to this endpoint to 500 with a
    // 42703 error. Aliased back to review_text in the select so the
    // response shape (and unirenter-guide.html's existing rv.review_text
    // read) doesn't need to change. Same pattern already used for
    // reviewer_city:city below (from the S145 fix).
    let query = supabase
      .from('reviews')
      .select('id, reviewer_name, reviewer_uni, reviewer_city:city, rating, review_text:text, created_at')
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
