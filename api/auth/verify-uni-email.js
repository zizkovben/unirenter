// api/auth/verify-uni-email.js
// Two actions via `action` field in request body:
//   'send'   — sends a 6-digit OTP to the .edu.au address via Resend
//   'verify' — checks the OTP, sets uni_email_verified=true in Supabase
// CommonJS — no ES module syntax.

const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, email, uni_email, otp } = req.body;

  if (!action || !email) {
    return res.status(400).json({ error: 'action and email required' });
  }

  // ── SEND OTP ──────────────────────────────────────────────────────────────
  if (action === 'send') {
    if (!uni_email) {
      return res.status(400).json({ error: 'uni_email required' });
    }

    // Enforce .edu.au
    if (!uni_email.toLowerCase().endsWith('.edu.au')) {
      return res.status(400).json({ error: 'Must be a valid .edu.au address' });
    }

    // Check profile exists
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'Profile not found — complete your main signup first' });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    // Store in email_verifications table (reuse existing table, type = 'uni_email')
    const { error: insertErr } = await supabase
      .from('email_verifications')
      .upsert({
        email: uni_email.toLowerCase(),
        profile_email: email,
        code,
        expires_at: expiresAt.toISOString(),
        type: 'uni_email',
      }, { onConflict: 'email,type' });

    if (insertErr) {
      console.error('OTP insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to create verification' });
    }

    // Also save the uni_email on the profile (unverified for now)
    await supabase
      .from('profiles')
      .update({ uni_email: uni_email.toLowerCase(), uni_email_verified: false })
      .eq('email', email);

    // Send email
    try {
      await resend.emails.send({
        from: 'Cob from UniRenter <noreply@unirenter.com.au>',
        to: uni_email,
        bcc: 'benjcarey75@gmail.com',
        subject: `${code} — your UniRenter uni verification code`,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;color:#e8f0f5;">
  <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:26px;font-weight:800;color:#e8f0f5;">UniRenter</div>
    </div>
    <div style="background:#162535;border-radius:16px;padding:32px 28px;text-align:center;">
      <div style="font-size:22px;margin-bottom:8px;">🎓</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:16px;color:#e8f0f5;">Ay! Verify your uni email</div>
      <div style="font-size:14px;color:#a0bccf;margin-bottom:28px;line-height:1.6;">
        Enter this code on UniRenter to get your 🎓 badge. It shows other students you're the real deal.
      </div>
      <div style="font-size:42px;font-weight:800;letter-spacing:10px;color:#F5B800;background:rgba(245,184,0,0.08);padding:20px;border-radius:12px;margin-bottom:20px;">${code}</div>
      <div style="font-size:12px;color:#4a6272;">Expires in 15 minutes. If you didn't request this, ignore it.</div>
    </div>
    <div style="text-align:center;padding:16px 0 0;font-size:11px;color:#4a6272;">
      Cob 🤠 · UniRenter · Free for students in Australia
    </div>
  </div>
</body>
</html>`,
      });

      return res.status(200).json({ sent: true });
    } catch (err) {
      console.error('Uni OTP email error:', err);
      return res.status(500).json({ error: 'Failed to send OTP email', detail: err.message });
    }
  }

  // ── VERIFY OTP ────────────────────────────────────────────────────────────
  if (action === 'verify') {
    if (!uni_email || !otp) {
      return res.status(400).json({ error: 'uni_email and otp required' });
    }

    const { data: record, error: lookupErr } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('email', uni_email.toLowerCase())
      .eq('profile_email', email)
      .eq('type', 'uni_email')
      .single();

    if (lookupErr || !record) {
      return res.status(400).json({ error: 'No pending verification found — request a new code' });
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code expired — request a new one' });
    }

    if (record.code !== String(otp).trim()) {
      return res.status(400).json({ error: 'Incorrect code — try again' });
    }

    // Mark verified
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        uni_email: uni_email.toLowerCase(),
        uni_email_verified: true,
      })
      .eq('email', email);

    if (updateErr) {
      console.error('Uni email verify update error:', updateErr);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    // Clean up OTP record
    await supabase
      .from('email_verifications')
      .delete()
      .eq('email', uni_email.toLowerCase())
      .eq('type', 'uni_email');

    return res.status(200).json({ verified: true });
  }

  return res.status(400).json({ error: 'Invalid action — must be "send" or "verify"' });
};
