// api/auth/verify-email-otp.js
// Verifies the 6-digit OTP against Supabase email_verifications table.
// On success: marks email as verified, creates/updates profile row.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { otp, city: reqCity } = req.body || {};
  // S135: normalize casing at the source — Postgres string comparison is
  // case-sensitive, so "User@Gmail.com" and "user@gmail.com" were being
  // treated as different people throughout matching and messaging.
  const email = ((req.body || {}).email || '').trim().toLowerCase();
  // S135: city was previously hardcoded to 'melbourne' on new-profile insert
  // regardless of which city page called this endpoint. Now accepts city
  // from the request body (frontend passes it), defaulting to 'melbourne'
  // only for backward compatibility with city pages not yet sending it.
  const city = reqCity || 'melbourne';
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP required' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    // Look up the most recent OTP record for this email
    const lookupRes = await fetch(
      `${supabaseUrl}/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}&select=otp,expires_at&order=created_at.desc&limit=1`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );
    const records = await lookupRes.json();

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No OTP found for this email — request a new code' });
    }

    const record = records[0];

    // Check expiry
    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ error: 'Code has expired — request a new one' });
    }

    // Check OTP matches
    if (record.otp !== otp.trim()) {
      return res.status(400).json({ error: 'Incorrect code' });
    }

    // OTP valid — delete ALL records for this email (clean up duplicates too)
    await fetch(
      `${supabaseUrl}/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );

    // Upsert profile — patch if exists
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=representation',
        },
        body: JSON.stringify({
          email,
          email_verified: true,
          updated_at:     new Date().toISOString(),
          last_seen:      new Date().toISOString(),
        }),
      }
    );
    const patched = await patchRes.json();

    // If no existing profile, insert one
    if (Array.isArray(patched) && patched.length === 0) {
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
          body: JSON.stringify({
            email,
            email_verified: true,
            city:           city,
            updated_at:     new Date().toISOString(),
            last_seen:      new Date().toISOString(),
          }),
        }
      );
      const inserted = await insertRes.json();
      return res.status(200).json({ success: true, profile: inserted[0] });
    }

    return res.status(200).json({ success: true, profile: patched[0] });

  } catch (err) {
    console.error('verify-email-otp error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
