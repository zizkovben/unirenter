// api/auth/send-email-otp.js
// UniRenter — Email OTP sender via Resend REST API (no npm package needed)
// Session 11: Uses fetch() directly — no require('resend')

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawEmail = (req.body || {}).email;
  // S135: normalize casing at the source — Postgres string comparison is
  // case-sensitive, so "User@Gmail.com" and "user@gmail.com" were being
  // treated as different people throughout matching and messaging.
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Delete any existing OTP rows for this email first — prevents stale row buildup
    await fetch(`${supabaseUrl}/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    // Insert fresh OTP row
    const supaRes = await fetch(`${supabaseUrl}/rest/v1/email_verifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ email, otp, expires_at: expires }),
    });

    if (!supaRes.ok) {
      const err = await supaRes.text();
      console.error('Supabase OTP store error:', err);
      return res.status(500).json({ error: 'Could not store OTP' });
    }
  } catch (err) {
    console.error('Supabase fetch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }

  // Send email via Resend REST API
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: email,
        subject: 'Your UniRenter login code',
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f2d;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#182f42;border-radius:16px;overflow:hidden;max-width:100%;">
          <tr>
            <td style="background:#162535;padding:28px 36px;border-bottom:1px solid rgba(255,255,255,0.07);">
              <span style="font-family:'Epilogue',Arial,sans-serif;font-weight:800;font-size:22px;color:#4BBFE0;letter-spacing:-0.5px;">UniRenter</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 36px 28px;">
              <p style="margin:0 0 8px;font-size:15px;color:#7a96aa;">Your verification code</p>
              <p style="margin:0 0 28px;font-size:14px;color:#7a96aa;line-height:1.6;">
                Enter this code to sign in to UniRenter. It expires in <strong style="color:#e8f0f5;">10 minutes</strong>.
              </p>
              <div style="background:#0d1f2d;border:1px solid rgba(75,191,224,0.2);border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
                <span style="font-family:'Epilogue',Arial,sans-serif;font-size:44px;font-weight:800;letter-spacing:12px;color:#F5B800;">${otp}</span>
              </div>
              <p style="margin:0;font-size:13px;color:#7a96aa;line-height:1.6;">
                Didn't request this? You can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#162535;padding:20px 36px;border-top:1px solid rgba(255,255,255,0.07);">
              <p style="margin:0;font-size:12px;color:#7a96aa;line-height:1.6;">
                © 2026 UniRenter · <a href="https://unirenter.vercel.app" style="color:#4BBFE0;text-decoration:none;">unirenter.vercel.app</a><br>
                Helping students settle into Australia — without housing stress.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        text: `Your UniRenter verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nDidn't request this? You can safely ignore this email.`,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend error:', JSON.stringify(resendData));
      return res.status(500).json({ error: 'Could not send email. Please try again.' });
    }

    return res.status(200).json({ success: true, message: 'Code sent' });

  } catch (err) {
    console.error('Resend fatal error:', err);
    return res.status(500).json({ error: 'Email delivery failed. Please try again.' });
  }
};
