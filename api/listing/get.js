// api/listing/get.js
// Public read — returns profile data for a listing token.
// GET /api/listing/get?token=xxx
// No auth required. Returns only public-safe fields. Returns 404 if expired or not found.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'token required' });

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'display_name, city, university, student_status, budget_min, budget_max, ' +
      'sleep_schedule, cleanliness, guests, pets, household_type, about, ' +
      'suburb_preferences, vibe_emoji_primary, vibe_emoji_secondary, cob_summary, ' +
      'move_in_date, listing_token, listing_expires_at, created_at'
    )
    .eq('listing_token', token)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Listing not found' });

  // Check expiry
  if (data.listing_expires_at) {
    const expired = new Date(data.listing_expires_at) < new Date();
    if (expired) return res.status(410).json({ error: 'Listing has expired' });
  }

  // Sanitise — never return email or sensitive fields
  const safe = {
    display_name:      data.display_name,
    city:              data.city,
    university:        data.university,
    student_status:    data.student_status,
    budget_min:        data.budget_min,
    budget_max:        data.budget_max,
    sleep_schedule:    data.sleep_schedule,
    cleanliness:       data.cleanliness,
    guests:            data.guests,
    pets:              data.pets,
    household_type:    data.household_type,
    about:             data.about,
    suburb_preferences: data.suburb_preferences,
    vibe_emoji_primary:   data.vibe_emoji_primary,
    vibe_emoji_secondary: data.vibe_emoji_secondary,
    cob_summary:          data.cob_summary,
    move_in_date:         data.move_in_date,
    expires_at:           data.listing_expires_at,
  };

  return res.status(200).json({ listing: safe });
};
