// api/account/appeal.js — POST /api/account/appeal
// S155c: minimal appeal capture. No automated re-instatement — Ben reviews
// account_appeals manually (Supabase or a future admin page) and clears
// profiles.account_status by hand if warranted.
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  try {
    const rawBody = req.body || {};
    const email = (rawBody.email || '').trim().toLowerCase();
    const message = (rawBody.message || '').trim();
    const account_status_at_appeal = rawBody.account_status_at_appeal || null;
 
    if (!email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Appeal must be under 2000 characters' });
    }
 
    const { error: insertErr } = await supabase.from('account_appeals').insert({
      email, message, account_status_at_appeal,
    });
 
    if (insertErr) {
      console.error('appeal.js insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to submit appeal', detail: insertErr.message });
    }
 
    // Best-effort admin notification, reusing the same Resend setup as
    // the rest of Trust & Safety (see api/messages/_trust-safety.js).
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: 'benjcarey75@gmail.com',
        subject: '[Trust & Safety] New appeal — ' + email,
        html: `<p><strong>${email}</strong> submitted an appeal (account status at the time: ${account_status_at_appeal || 'unknown'}).</p>
               <p>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
               <p>Review in Supabase's <code>account_appeals</code> table.</p>`,
      });
    } catch (emailErr) {
      console.warn('appeal.js admin email error (non-fatal):', emailErr.message);
    }
 
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('appeal.js unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
 
