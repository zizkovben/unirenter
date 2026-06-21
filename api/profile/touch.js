// api/profile/touch.js
// Lightweight activity ping — bumps last_seen to now for a given email.
// Called from the dashboard on load (S81), separate from api/profile/save.js
// which only bumps last_seen when the student actually saves profile changes.
// A student who logs in just to check matches (without editing anything) should
// still count as recently active for matching purposes — this endpoint covers
// that case without the overhead of a full profile payload PATCH.
// Auth: uses SUPABASE_SERVICE_ROLE_KEY (server-side only — never exposed to client)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ last_seen: new Date().toISOString() }),
      }
    );

    if (!response.ok) {
      // Non-fatal — a missed activity ping shouldn't break the dashboard.
      const detail = await response.text().catch(() => '');
      console.warn('profile/touch: patch failed (non-fatal):', response.status, detail);
      return res.status(200).json({ success: false });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    // Non-fatal — log and return success:false rather than a 500, since the
    // caller (dashboard on load) doesn't need to handle this as an error.
    console.warn('profile/touch error (non-fatal):', err.message);
    return res.status(200).json({ success: false });
  }
};
