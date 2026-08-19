// api/cron/keep-alive.js
//
// Weekly Supabase keep-alive ping.
// Supabase free-tier projects auto-pause after 7 days with no API activity.
// Vercel Cron hits this endpoint once a week so the project never goes idle
// long enough to pause. Runs a single trivial read against the `profiles`
// table using the service role key already configured in Vercel env vars.
//
// Wired up via the "crons" entry in vercel.json — see that file for the
// schedule. Hobby plan allows cron jobs down to once-per-day frequency,
// so a weekly schedule is well within limits.
//
// Optional protection: if CRON_SECRET is set in Vercel env vars, Vercel
// automatically sends it as "Authorization: Bearer <CRON_SECRET>" on cron
// invocations, and this handler will require it to match. If CRON_SECRET
// is not set, the check is skipped (safe default for a read-only ping).
 
module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
  }
 
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ ok: false, error: 'Missing Supabase env vars' });
    return;
  }
 
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=id&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
 
    if (!response.ok) {
      const body = await response.text();
      console.error('Supabase keep-alive ping failed:', body);
      res.status(502).json({
        ok: false,
        error: 'Supabase request failed',
        status: response.status,
        body,
      });
      return;
    }
 
    const rows = await response.json();
 
    res.status(200).json({
      ok: true,
      pinged_at: new Date().toISOString(),
      rows_returned: Array.isArray(rows) ? rows.length : 0,
    });
  } catch (err) {
    console.error('Supabase keep-alive fetch error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
 
