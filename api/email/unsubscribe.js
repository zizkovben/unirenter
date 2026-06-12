// api/email/unsubscribe.js
// Validates HMAC token from email footer link, sets email_unsubscribed = true in profiles.
// CommonJS — no ES module syntax.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function makeHmacToken(email) {
  const secret = process.env.RESEND_API_KEY || 'ur-secret';
  return crypto.createHmac('sha256', secret).update(email).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ error: 'email and token required' });
  }

  // ── Validate HMAC token ───────────────────────────────────────────────────
  const expected = makeHmacToken(email);
  const isValid = crypto.timingSafeEqual(
    Buffer.from(token, 'hex'),
    Buffer.from(expected, 'hex')
  );

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // ── Set unsubscribed ──────────────────────────────────────────────────────
  const { error } = await supabase
    .from('profiles')
    .update({ email_unsubscribed: true })
    .eq('email', email);

  if (error) {
    console.error('Unsubscribe DB error:', error);
    return res.status(500).json({ error: 'Failed to update preference' });
  }

  return res.status(200).json({ success: true, message: 'Unsubscribed successfully' });
};
