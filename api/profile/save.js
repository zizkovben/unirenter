// api/profile/save.js
// Receives profile builder data from any city page and upserts into Supabase profiles table.
// Called via POST /api/profile/save
// Auth: uses SUPABASE_SERVICE_ROLE_KEY (server-side only — never exposed to client)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const body = req.body;

    if (!body.email && !body.id) {
      return res.status(400).json({ error: 'email or id required' });
    }

    // Validate city — only accept known cities, default to melbourne
    const VALID_CITIES = ['melbourne', 'sydney', 'brisbane'];
    const city = VALID_CITIES.includes(body.city) ? body.city : 'melbourne';

    const payload = {
      updated_at:       new Date().toISOString(),
      last_seen:        new Date().toISOString(),
      profile_complete: body.profile_complete ?? 0,
      is_active:        true,
      city,
    };

    const fields = [
      'email', 'phone', 'display_name', 'photo_url',
      'university', 'student_status', 'field_of_study', 'year_of_study',
      'uni_email', 'uni_email_verified', 'email_verified',
      'seeking', 'move_in_date', 'lease_duration', 'household_type',
      'suburb_preferences', 'budget_min', 'budget_max',
      'sleep_schedule', 'cleanliness', 'study_location',
      'guests', 'substances', 'dietary', 'pets',
    ];

    for (const f of fields) {
      if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
        payload[f] = body[f];
      }
    }

    const matchCol = body.email ? 'email' : 'id';
    const matchVal = body.email || body.id;

    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?${matchCol}=eq.${encodeURIComponent(matchVal)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=representation',
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    // No existing row — insert
    if (Array.isArray(data) && data.length === 0) {
      const insertPayload = { ...payload };
      if (body.email) insertPayload.email = body.email;
      if (body.id)    insertPayload.id    = body.id;

      const insertRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer':        'return=representation',
          },
          body: JSON.stringify(insertPayload),
        }
      );

      const inserted = await insertRes.json();

      if (!insertRes.ok) {
        console.error('Supabase insert error:', inserted);
        return res.status(500).json({ error: 'Failed to create profile', detail: inserted });
      }

      return res.status(200).json({ success: true, action: 'inserted', profile: inserted[0] });
    }

    if (!response.ok) {
      console.error('Supabase patch error:', data);
      return res.status(500).json({ error: 'Failed to update profile', detail: data });
    }

    return res.status(200).json({ success: true, action: 'updated', profile: data[0] });

  } catch (err) {
    console.error('profile/save error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
