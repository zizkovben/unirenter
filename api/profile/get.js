// api/profile/get.js
// Returns a student's profile from Supabase by email.
// Called via GET /api/profile/get?email=student@example.com
// Used by the dashboard to load profile data without requiring a new city page session.
// Auth: uses SUPABASE_SERVICE_ROLE_KEY (server-side only — never exposed to client)
 
export default async function handler(req, res) {
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
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=display_name,university,student_status,seeking,budget_min,budget_max,household_type,suburb_preferences,sleep_schedule,cleanliness,guests,pets,study_location,city,profile_complete`,
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
    // cob_refined_fields lives in localStorage (ur_cob_refined) until Supabase column is migrated
    profile.cob_refined_fields = profile.cob_refined_fields || [];
    return res.status(200).json({ success: true, profile });
 
  } catch (err) {
    console.error('profile/get error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
