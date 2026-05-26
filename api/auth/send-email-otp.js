
// api/auth/send-email-otp.js
// Generates a 6-digit OTP, stores it in Supabase email_verifications table,
// and sends it to the user via Resend.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey   = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !serviceKey || !resendKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Generate 6-digit OTP
  const otp     = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  try {
    // Store OTP in Supabase email_verifications table
    // Delete any existing OTP for this email first
    await fetch(
      `${supabaseUrl}/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );

    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/email_verifications`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ email, otp, expires_at: expires }),
      }
    );

    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error('Supabase insert error:', err);
      return res.status(500).json({ error: 'Failed to store OTP' });
    }

    // Send email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from:    'UniRenter <onboarding@resend.dev>',
        to:      [email],
        subject: `${otp} — your UniRenter verification code`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <div style="font-size:24px;font-weight:700;margin-bottom:8px;">UniRenter 🏠</div>
            <p style="color:#555;margin-bottom:24px;">Your verification code is:</p>
            <div style="font-size:48px;font-weight:700;letter-spacing:12px;color:#0d1f2d;background:#f5f5f5;padding:24px;border-radius:12px;text-align:center;">
              ${otp}
            </div>
            <p style="color:#888;font-size:13px;margin-top:24px;">
              This code expires in 10 minutes. If you didn't request this, you can safely ignore it.
            </p>
            <p style="color:#bbb;font-size:12px;margin-top:32px;">UniRenter — student accommodation matching</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true, message: 'OTP sent' });

  } catch (err) {
    console.error('send-email-otp error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
