// api/reviews/list.js
// Returns approved reviews for a given city.
// GET ?city=melbourne[&limit=20][&offset=0]
// Returns { reviews: [...], total: N }
 
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY  // anon key — only reads approved rows
);
 
const ALLOWED_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
 
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  try {
    const { city, limit: limitRaw, offset: offsetRaw } = req.query;
 
    // --- Validate city ---
    if (!city || !ALLOWED_CITIES.includes(city)) {
      return res.status(400).json({ error: 'Invalid or missing city' });
    }
 
    // --- Parse pagination ---
    const limit = Math.min(parseInt(limitRaw, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(parseInt(offsetRaw, 10) || 0, 0);
 
    // --- Query Supabase (only approved reviews) ---
    const { data, error, count } = await supabase
      .from('reviews')
      .select('id, city, reviewer_name, reviewer_uni, rating, text, suburb, created_at', { count: 'exact' })
      .eq('city', city.toLowerCase())
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
 
    if (error) {
      console.error('[reviews/list] Supabase error:', error);
      return res.status(500).json({ error: 'Failed to fetch reviews' });
    }
 
    return res.status(200).json({
      reviews: data || [],
      total: count || 0,
      limit,
      offset,
    });
 
  } catch (err) {
    console.error('[reviews/list] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
