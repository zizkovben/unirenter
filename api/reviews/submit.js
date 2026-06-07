// api/reviews/submit.js
// Saves a student review to Supabase reviews table.
// POST body: { city, reviewer_name, reviewer_uni, rating, text, suburb (optional) }
// Validates input, saves to Supabase, returns { ok: true, id } on success.
 
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
const ALLOWED_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
 
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  try {
    const { city, reviewer_name, reviewer_uni, rating, text, suburb } = req.body;
 
    // --- Validation ---
    if (!city || !ALLOWED_CITIES.includes(city)) {
      return res.status(400).json({ error: 'Invalid or missing city' });
    }
    if (!reviewer_name || typeof reviewer_name !== 'string' || reviewer_name.trim().length < 2) {
      return res.status(400).json({ error: 'reviewer_name must be at least 2 characters' });
    }
    if (!reviewer_uni || typeof reviewer_uni !== 'string' || reviewer_uni.trim().length < 2) {
      return res.status(400).json({ error: 'reviewer_uni must be at least 2 characters' });
    }
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({ error: 'rating must be an integer 1–5' });
    }
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return res.status(400).json({ error: 'Review text must be at least 10 characters' });
    }
    if (text.trim().length > 1000) {
      return res.status(400).json({ error: 'Review text must be 1000 characters or fewer' });
    }
 
    // --- Sanitise ---
    const payload = {
      city: city.toLowerCase().trim(),
      reviewer_name: reviewer_name.trim().slice(0, 80),
      reviewer_uni: reviewer_uni.trim().slice(0, 120),
      rating,
      text: text.trim().slice(0, 1000),
      suburb: suburb ? suburb.trim().slice(0, 80) : null,
      status: 'pending',   // reviews need moderation before showing
      created_at: new Date().toISOString(),
    };
 
    // --- Insert ---
    const { data, error } = await supabase
      .from('reviews')
      .insert([payload])
      .select('id')
      .single();
 
    if (error) {
      console.error('[reviews/submit] Supabase error:', error);
      return res.status(500).json({ error: 'Failed to save review' });
    }
 
    return res.status(200).json({ ok: true, id: data.id });
 
  } catch (err) {
    console.error('[reviews/submit] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
