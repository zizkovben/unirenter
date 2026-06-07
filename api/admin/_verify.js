const crypto = require('crypto');

function verifyToken(authHeader, secret) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  } catch {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  const sigBuf = Buffer.from(sig.padEnd(64, '0').slice(0, 64));
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;

  try {
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  } catch {
    return null;
  }

  if (payload.exp < Date.now()) return null;
  if (payload.role !== 'admin') return null;

  return payload;
}

module.exports = { verifyToken };
