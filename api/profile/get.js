// api/profile/get.js
// Returns a student's full profile from Supabase by email.
// Called via GET /api/profile/get?email=student@example.com
// Used by the dashboard to load profile data on login.
// Auth: uses SUPABASE_SERVICE_ROLE_KEY (server-side only — never exposed to client)
// Fixed S107: expanded select list to return all profile fields (was truncated to 15 fields,
// causing first_name, university, vibe fields, language fields etc. to appear null on dashboard)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query param required' });
  }

  try {
    const selectFields = [
      'id',
      'email',
      'display_name',
      'photo_url',
      'university',
      'student_status',
      'field_of_study',
      'year_of_study',
      'uni_email',
      'uni_email_verified',
      'email_verified',
      'phone',
      'seeking',
      'move_in_date',
      'lease_duration',
      'household_type',
      'suburb_preferences',
      'budget_min',
      'budget_max',
      'sleep_schedule',
      'cleanliness',
      'study_location',
      'guests',
      'substances',
      'dietary',
      'pets',
      'vibe_emoji_primary',
      'vibe_emoji_secondary',
      'cob_summary',
      'star_sign',
      'generation',
      'chinese_zodiac',
      'vibe_lifestyle',
      'vibe_quiz_answers',
      'language_home',
      'languages_spoken',
      'english_practice',
      'stay_duration',
      'sleep_mode',
      'listing_token',
      'listing_expires_at',
      'city',
      'profile_complete',
      'is_active',
      'last_seen',
      'created_at',
      'updated_at',
    ].join(',');

    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=${selectFields}`,
      {
        method: 'GET',
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Supabase fetch error:', data);
      return res.status(500).json({ error: 'Failed to fetch profile', detail: data });
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = data[0];
    // cob_refined_fields lives in localStorage (ur_cob_refined) — not a Supabase column
    profile.cob_refined_fields = profile.cob_refined_fields || [];
    return res.status(200).json({ success: true, profile });

  } catch (err) {
    console.error('profile/get error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
