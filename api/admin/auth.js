const crypto = require('crypto');
 
function signToken(payload, secret) {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  const encoded = Buffer.from(data).toString('base64url');
  return `${encoded}.${sig}`;
}
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
 
  const { password } = req.body || {};
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
 
  if (!ADMIN_PASSWORD || !ADMIN_TOKEN_SECRET) {
    return res.status(500).json({ ok: false, error: 'Admin credentials not configured' });
  }
 
  if (!password || password !== ADMIN_PASSWORD) {
    // Constant-time comparison to prevent timing attacks
    const dummy = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update('dummy').digest('hex');
    const real  = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(password || '').digest('hex');
    crypto.timingSafeEqual(Buffer.from(dummy), Buffer.from(dummy)); // always run
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }
 
  const payload = {
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8 hours
  };
 
  const token = signToken(payload, ADMIN_TOKEN_SECRET);
  return res.status(200).json({ ok: true, token });
};
 
