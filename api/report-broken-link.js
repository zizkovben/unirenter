// api/report-broken-link.js — S151
// POST /api/report-broken-link
// Body: { url, label, city, page, page_path, user_email? }
// Logs the report to Supabase (broken_link_reports) and emails Ben a heads-up via Resend.
// CommonJS.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // S151: this is a write, but there's no reason a CDN/browser should ever cache
  // a POST response either — same no-store lesson from the S151 caching bug.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { url, label, city, page, page_path, user_email } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'url required' });

    const { data: inserted, error: insertErr } = await supabase
      .from('broken_link_reports')
      .insert([{
        url:         String(url).slice(0, 2000),
        label:       label ? String(label).slice(0, 300) : null,
        city:        city || null,
        page:        page || null,
        page_path:   page_path || null,
        user_email:  user_email ? String(user_email).toLowerCase().trim() : null,
      }])
      .select()
      .single();

    if (insertErr) {
      console.error('[report-broken-link] insert error:', insertErr);
      return res.status(500).json({ ok: false, error: 'Could not save report' });
    }

    // Best-effort email notification — a failure here should never block the
    // student-facing response, since the report is already safely logged.
    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'UniRenter <noreply@unirenter.com.au>',
            to: ['benjcarey75@gmail.com'],
            subject: `🚩 Broken link reported — ${label || url}`,
            text:
              `A student flagged a broken link.\n\n` +
              `Label: ${label || '(none)'}\n` +
              `URL: ${url}\n` +
              `City: ${city || '(unknown)'}\n` +
              `Page: ${page || '(unknown)'} (${page_path || 'no path recorded'})\n` +
              `Reported by: ${user_email || 'anonymous (not signed in)'}\n` +
              `Time: ${new Date().toISOString()}\n`,
          }),
        });
      } catch (emailErr) {
        console.error('[report-broken-link] email notify failed (non-fatal):', emailErr);
      }
    }

    return res.status(200).json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error('[report-broken-link] unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
