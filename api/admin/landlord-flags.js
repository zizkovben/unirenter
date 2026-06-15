// api/admin/landlord-flags.js
// GET  /api/admin/landlord-flags   — list profiles where landlord_flagged = true
// POST /api/admin/landlord-flags   — clear flag or ban profile
//   body: { email, action: 'clear' | 'ban' }

const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('./_verify');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = verifyToken(req.headers['authorization'], process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorised' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── GET — list flagged profiles ──────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('email, display_name, city, landlord_flag_reason, created_at')
        .eq('landlord_flagged', true)
        .order('created_at', { ascending: false });

      if (error) {
        // If column doesn't exist yet (pre-migration), return empty gracefully
        if (error.message && error.message.includes('landlord_flagged')) {
          return res.status(200).json({ ok: true, profiles: [], note: 'landlord_flagged column not yet in DB — run pending SQL migration' });
        }
        throw error;
      }

      return res.status(200).json({ ok: true, profiles: data || [] });
    } catch (err) {
      console.error('Landlord flags GET error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST — clear flag or ban ─────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { email, action } = req.body || {};
      if (!email) return res.status(400).json({ ok: false, error: 'email required' });
      if (!['clear', 'ban'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'action must be clear or ban' });
      }

      if (action === 'clear') {
        // Remove the flag — user can continue as normal
        const { error } = await supabase
          .from('profiles')
          .update({ landlord_flagged: false, landlord_flag_reason: null })
          .eq('email', email);
        if (error) throw error;
      } else {
        // Ban — remove flag but mark as banned (using landlord_flag_reason as a record)
        // Note: a full ban system (email blocklist) is future scope — this is a manual flag for now
        const { error } = await supabase
          .from('profiles')
          .update({ landlord_flagged: true, landlord_flag_reason: 'BANNED — confirmed landlord' })
          .eq('email', email);
        if (error) throw error;
      }

      return res.status(200).json({ ok: true, action });
    } catch (err) {
      console.error('Landlord flags POST error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
