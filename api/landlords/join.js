// api/landlords/join.js
// Saves landlord waitlist entry to Supabase landlord_leads table.
// POST body: { name, email, cities[], property_type, room_count, rent_range, agreed_to_notify }
// Sends confirmation email via Resend.
// Returns { ok: true, id } on success.
 
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
const resend = new Resend(process.env.RESEND_API_KEY);
 
const ALLOWED_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
const ALLOWED_TYPES = ['share_house', 'apartment', 'student_complex', 'granny_flat'];
const ALLOWED_ROOMS = ['1', '2', '3', '4', '6+'];
const ALLOWED_RENTS = ['under200', '200-250', '250-300', '300-350', '350-400', '400+'];
 
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  try {
    const { name, email, cities, property_type, room_count, rent_range, agreed_to_notify } = req.body;
 
    // --- Validation ---
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (!Array.isArray(cities) || cities.length === 0) {
      return res.status(400).json({ error: 'At least one city must be selected' });
    }
    const validCities = cities.filter(c => ALLOWED_CITIES.includes(c));
    if (validCities.length === 0) {
      return res.status(400).json({ error: 'No valid cities provided' });
    }
    if (!property_type || !ALLOWED_TYPES.includes(property_type)) {
      return res.status(400).json({ error: 'Invalid property_type' });
    }
    if (!room_count || !ALLOWED_ROOMS.includes(room_count)) {
      return res.status(400).json({ error: 'Invalid room_count' });
    }
    if (!rent_range || !ALLOWED_RENTS.includes(rent_range)) {
      return res.status(400).json({ error: 'Invalid rent_range' });
    }
 
    // --- Check for duplicate email ---
    const { data: existing } = await supabase
      .from('landlord_leads')
      .select('id, cities')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
 
    const payload = {
      name: name.trim().slice(0, 120),
      email: email.toLowerCase().trim(),
      cities: validCities,
      property_type,
      room_count,
      rent_range,
      agreed_to_notify: agreed_to_notify === true,
      city_launched_notified: [],
      created_at: new Date().toISOString(),
    };
 
    let resultId;
 
    if (existing) {
      // Update existing — merge cities
      const mergedCities = [...new Set([...existing.cities, ...validCities])];
      const { data, error } = await supabase
        .from('landlord_leads')
        .update({ cities: mergedCities, ...payload })
        .eq('id', existing.id)
        .select('id')
        .single();
      if (error) throw error;
      resultId = data.id;
    } else {
      // Insert new
      const { data, error } = await supabase
        .from('landlord_leads')
        .insert([payload])
        .select('id')
        .single();
      if (error) throw error;
      resultId = data.id;
    }
 
    // --- Confirmation email to landlord ---
    const cityList = validCities.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ');
    try {
      await resend.emails.send({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: payload.email,
        subject: `You're on the UniRenter landlord waitlist 🏠`,
        html: `
          <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;color:#1a2e3d">
            <div style="background:#0d1f2d;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
              <h2 style="color:#F5B800;font-family:Epilogue,sans-serif;margin:0;font-size:1.4rem">UniRenter</h2>
            </div>
            <div style="background:#f9fbfc;padding:28px 24px;border-radius:0 0 12px 12px;border:1px solid #e2eaf2;border-top:none">
              <p style="font-size:1rem;margin:0 0 12px">Hi <strong>${payload.name}</strong>,</p>
              <p style="margin:0 0 12px">You're on the UniRenter landlord waitlist — we'll email you as soon as listings open in your city.</p>
              <div style="background:#e8f5ec;border-left:4px solid #3DAA5C;border-radius:6px;padding:12px 16px;margin:16px 0">
                <strong>Your waitlist details</strong><br>
                Cities: <strong>${cityList}</strong><br>
                Property type: <strong>${property_type.replace(/_/g, ' ')}</strong><br>
                Rooms: <strong>${room_count}</strong> · Rent: <strong>${rent_range.replace(/-/g, '–')}/wk</strong>
              </div>
              <p style="margin:0 0 12px">In the meantime, explore what your future renters experience at <a href="https://unirenter.com.au" style="color:#4BBFE0">unirenter.com.au</a>.</p>
              <p style="font-size:.8rem;color:#7a96aa;margin:20px 0 0">You joined the landlord waitlist. Your data is stored securely and will never be sold. To request deletion: <a href="mailto:hello@unirenter.com.au" style="color:#4BBFE0">hello@unirenter.com.au</a>.</p>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      // Don't fail the whole request if email fails — lead is already saved
      console.warn('[landlords/join] Confirmation email failed:', emailErr.message);
    }
 
    return res.status(200).json({ ok: true, id: resultId });
 
  } catch (err) {
    console.error('[landlords/join] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
