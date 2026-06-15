// api/admin/audit-log.js
// GET /api/admin/audit-log   — return last 20 audit runs from audit_log table
// Returns empty array gracefully if table doesn't exist yet (pre-S72)

const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('./_verify');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const payload = verifyToken(req.headers['authorization'], process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorised' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, run_date, trigger, html_files_checked, internal_ok, internal_broken, external_ok, external_broken, broken_links, passed, created_at')
      .order('run_date', { ascending: false })
      .limit(20);

    if (error) {
      // Gracefully handle missing table — S72 will create it
      if (error.message && (error.message.includes('audit_log') || error.message.includes('does not exist'))) {
        return res.status(200).json({
          ok: true,
          runs: [],
          note: 'audit_log table not yet created — will be added in S72 (GitHub Actions setup)'
        });
      }
      throw error;
    }

    return res.status(200).json({ ok: true, runs: data || [] });
  } catch (err) {
    console.error('Audit log GET error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
