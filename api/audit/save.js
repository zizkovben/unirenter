// api/audit/save.js
// POST /api/audit/save
// Called by GitHub Actions after each audit run (push + weekly).
// Writes result to audit_log table in Supabase.
// Protected by x-audit-secret header (must match ADMIN_TOKEN_SECRET env var).
// CommonJS — no ES module syntax.
 
const { createClient } = require('@supabase/supabase-js');
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-audit-secret');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
 
  // ── Auth — simple secret comparison (machine-to-machine, no JWT needed) ──
  const secret = process.env.ADMIN_TOKEN_SECRET;
  const provided = req.headers['x-audit-secret'];
  if (!secret || !provided || provided !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorised' });
  }
 
  // ── Parse body ────────────────────────────────────────────────────────────
  const body = req.body || {};
  const {
    trigger,
    html_files_checked,
    internal_ok,
    internal_broken,
    external_ok,
    external_broken,
    broken_links,
    passed
  } = body;
 
  // Basic validation
  if (typeof html_files_checked !== 'number') {
    return res.status(400).json({ ok: false, error: 'html_files_checked must be a number' });
  }
 
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
 
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .insert({
        trigger:             trigger || 'manual',
        html_files_checked:  html_files_checked || 0,
        internal_ok:         internal_ok || 0,
        internal_broken:     internal_broken || 0,
        external_ok:         external_ok || 0,
        external_broken:     external_broken || 0,
        broken_links:        Array.isArray(broken_links) ? broken_links : [],
        passed:              passed !== false,
        run_date:            new Date().toISOString()
      })
      .select('id')
      .single();
 
    if (error) throw error;
 
    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Audit save error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
