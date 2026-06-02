const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  const { city } = req.query;
 
  if (!city) {
    return res.status(400).json({ error: 'city is required' });
  }
 
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, city, rating, comment, feature_mentioned, created_at')
      .eq('city', city)
      .eq('approved', true)
      .eq('rating', 5)
      .not('comment', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);
 
    if (error) throw error;
 
    // Only return reviews with a meaningful comment (10+ words)
    const filtered = (data || []).filter(r => {
      const words = (r.comment || '').trim().split(/\s+/);
      return words.length >= 10;
    });
 
    return res.status(200).json({ reviews: filtered });
  } catch (err) {
    console.error('Review list error:', err);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};
