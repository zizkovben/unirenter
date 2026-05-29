// api/auth/send-email-otp.js
// UniRenter — Email OTP sender via Resend
// Session 11: Updated sender to noreply@unirenter.com.au
// Place at: /api/auth/send-email-otp.js in repo root

const { Resend } = require('resend');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

  // Store in Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Upsert OTP record
    const supaRes = await fetch(`${supabaseUrl}/rest/v1/email_verifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ email, otp, expires_at: new Date(expires).toISOString() }),
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

  // Send email via Resend
  // IMPORTANT: Sender uses unirenter.com.au domain.
  // You must verify unirenter.com.au in Resend dashboard first:
  //   1. Go to resend.com → Domains → Add Domain → enter unirenter.com.au
  //   2. Add the DNS records Resend provides to your domain registrar
  //   3. Wait for verification (usually 5-30 min)
  //   4. Then this sender address will work for any recipient
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: 'UniRenter <noreply@unirenter.com.au>',
      to: email,
      subject: 'Your UniRenter login code',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f2d;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#182f42;border-radius:16px;overflow:hidden;max-width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#162535;padding:28px 36px;border-bottom:1px solid rgba(255,255,255,0.07);">
              <span style="font-family:'Epilogue',Arial,sans-serif;font-weight:800;font-size:22px;color:#4BBFE0;letter-spacing:-0.5px;">UniRenter</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px;">
              <p style="margin:0 0 8px;font-size:15px;color:#7a96aa;">Your verification code</p>
              <p style="margin:0 0 28px;font-size:14px;color:#7a96aa;line-height:1.6;">
                Enter this code to sign in to UniRenter. It expires in <strong style="color:#e8f0f5;">10 minutes</strong>.
              </p>
              <!-- OTP block -->
              <div style="background:#0d1f2d;border:1px solid rgba(75,191,224,0.2);border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
                <span style="font-family:'Epilogue',Arial,sans-serif;font-size:44px;font-weight:800;letter-spacing:12px;color:#F5B800;">${otp}</span>
              </div>
              <p style="margin:0 0 8px;font-size:13px;color:#7a96aa;line-height:1.6;">
                Didn't request this? You can safely ignore this email — no account has been created.
              </p>
            </td>
          </tr>
          <!-- Footer -->
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
</html>
      `.trim(),
      text: `Your UniRenter verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nDidn't request this? You can safely ignore this email.`,
    });

    if (error) {
      console.error('Resend send error:', error);
      // If domain not yet verified, Resend returns a specific error.
      // Surface a friendly message.
      if (error.message && error.message.includes('domain')) {
        return res.status(503).json({
          error: 'Email service temporarily unavailable. Please try again shortly.',
          _debug: 'Domain not yet verified in Resend — add unirenter.com.au to Resend dashboard'
        });
      }
      return res.status(500).json({ error: 'Could not send email. Please try again.' });
    }

    return res.status(200).json({ success: true, message: 'Code sent' });

  } catch (err) {
    console.error('Resend fatal error:', err);
    return res.status(500).json({ error: 'Email delivery failed. Please try again.' });
  }
};
