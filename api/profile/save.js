// api/profile/save.js
// Receives profile builder data from any city page and upserts into Supabase profiles table.
// Called via POST /api/profile/save
// Auth: uses SUPABASE_SERVICE_ROLE_KEY (server-side only — never exposed to client)
 
module.exports = async function handler(req, res) {
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
    const VALID_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
    const city = VALID_CITIES.includes(body.city) ? body.city : 'melbourne';
 
    // ── Profile completeness — calculated server-side (S110) ──────────────────
    // The client sends a DOM-state calculation that can be low during intermediate
    // step-advance saves (unlockAndGo fires on every tab advance). We recalculate
    // here from actual payload field values AND compare against what's already
    // stored in Supabase, always taking the highest value so completeness never
    // decreases due to a partial intermediate save.
    function calcComplete(b) {
      const fields = [
        b.display_name, b.university, b.student_status, b.seeking,
        b.move_in_date, b.household_type, b.sleep_schedule, b.cleanliness,
        b.budget_min, b.budget_max,
      ];
      const filled = fields.filter(v => v !== undefined && v !== null && v !== '').length;
      return Math.round((filled / 10) * 100);
    }

    // Fetch currently-stored completeness so we never lower it
    let storedPct = 0;
    try {
      const matchCol2 = body.email ? 'email' : 'id';
      const matchVal2 = body.email || body.id;
      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?${matchCol2}=eq.${encodeURIComponent(matchVal2)}&select=profile_complete`,
        {
          headers: {
            'apikey':        serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
          },
        }
      );
      const existingData = await existingRes.json();
      if (Array.isArray(existingData) && existingData.length > 0) {
        storedPct = existingData[0].profile_complete || 0;
      }
    } catch (_) { /* non-fatal — storedPct stays 0 */ }

    const clientPct = typeof body.profile_complete === 'number' ? body.profile_complete : 0;
    const serverPct = calcComplete(body);
    // Never lower completeness — take max across client report, server calc, and stored value
    const derivedPct = Math.max(clientPct, serverPct, storedPct);

    const payload = {
      updated_at:       new Date().toISOString(),
      last_seen:        new Date().toISOString(),
      profile_complete: derivedPct,
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
      'vibe_emoji_primary', 'vibe_emoji_secondary', 'cob_summary',
      'star_sign', 'generation', 'vibe_lifestyle', 'vibe_quiz_answers',
      'language_home', 'languages_spoken', 'english_practice',
      'chinese_zodiac', 'sleep_mode', 'listing_token', 'listing_expires_at',
      'stay_duration',
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
