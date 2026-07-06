// api/report-problem.js — S153
// POST /api/report-problem
// Body: { feature, trigger_type, expected_vs_actual?, description?, error_message?,
//         page_path, user_email?, browser_info? }
// Logs the report to Supabase (problem_reports) and emails Ben a heads-up via
// Resend. Metadata only — never accepts or stores the original photo/document;
// the "expected_vs_actual" field is the deliberate substitute for that, so a
// student can flag "it said 12 July, should be 12 June" without re-uploading
// the lease. Mirrors api/report-broken-link.js's (S151) pattern exactly.
// CommonJS.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_TRIGGER_TYPES = ['manual', 'auto_error'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const {
      feature, trigger_type, expected_vs_actual, description,
      error_message, page_path, user_email, browser_info
    } = req.body || {};

    if (!feature) return res.status(400).json({ ok: false, error: 'feature required' });

    const triggerType = VALID_TRIGGER_TYPES.includes(trigger_type) ? trigger_type : 'manual';

    const { data: inserted, error: insertErr } = await supabase
      .from('problem_reports')
      .insert([{
        feature:            String(feature).slice(0, 200),
        trigger_type:       triggerType,
        expected_vs_actual: expected_vs_actual ? String(expected_vs_actual).slice(0, 1000) : null,
        description:        description ? String(description).slice(0, 2000) : null,
        error_message:       error_message ? String(error_message).slice(0, 1000) : null,
        page_path:          page_path || null,
        user_email:         user_email ? String(user_email).toLowerCase().trim() : null,
        browser_info:       browser_info ? String(browser_info).slice(0, 500) : null,
      }])
      .select()
      .single();

    if (insertErr) {
      console.error('[report-problem] insert error:', insertErr);
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
            subject: `⚠️ Problem reported — ${feature} (${triggerType})`,
            text:
              `A student reported a problem.\n\n` +
              `Feature: ${feature}\n` +
              `Trigger: ${triggerType}\n` +
              `What they expected vs. got: ${expected_vs_actual || '(not given)'}\n` +
              `Description: ${description || '(none)'}\n` +
              (error_message ? `Auto-captured error: ${error_message}\n` : '') +
              `Page: ${page_path || '(unknown)'}\n` +
              `Reported by: ${user_email || 'anonymous (not signed in)'}\n` +
              `Browser: ${browser_info || '(unknown)'}\n` +
              `Time: ${new Date().toISOString()}\n`,
          }),
        });
      } catch (emailErr) {
        console.error('[report-problem] email notify failed (non-fatal):', emailErr);
      }
    }

    return res.status(200).json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error('[report-problem] unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
