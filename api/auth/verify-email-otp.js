
// api/auth/verify-email-otp.js
// Verifies the 6-digit OTP against Supabase email_verifications table.
// On success: marks email as verified, creates/updates profile row.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP required' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    // Look up the OTP record
    const lookupRes = await fetch(
      `${supabaseUrl}/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}&select=otp,expires_at`,
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

    // OTP valid — delete it (one-time use)
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

    // Upsert profile — create if not exists, mark email_verified = true
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
            city:           'melbourne',
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
}
