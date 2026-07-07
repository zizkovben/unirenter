// api/messages/report.js — POST /api/messages/report
// S155b: wires the previously front-end-only "Report a profile" modal
// (report-modal / submitReport()) to the same message_flags table S155a
// built for automatic scam detection. A manual report and an
// auto-detected flag count identically toward 155c's cross-user
// aggregation — a report IS one of the "3 distinct people" a sender can be
// flagged by. Reports on the fast-track categories (violence, sexual
// exploitation, illegal goods) trigger the same immediate
// suspended_pending_review as an auto-detected fast-track match, since the
// "pending manual review" framing in the original spec applies regardless
// of how the flag was raised.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STANDARD_CATEGORIES = ['fake', 'scam', 'harassment', 'hate_speech', 'spam', 'visa_marriage_dating'];
const FASTTRACK_CATEGORIES = ['violence', 'sexual_exploitation', 'illegal_goods'];
const VALID_CATEGORIES = STANDARD_CATEGORIES.concat(FASTTRACK_CATEGORIES);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = req.body || {};
    const reporter_email = (rawBody.reporter_email || '').trim().toLowerCase();
    const reported_email = (rawBody.reported_email || '').trim().toLowerCase();
    const category = (rawBody.category || '').trim();

    if (!reporter_email || !reported_email || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid report category' });
    }
    if (reporter_email === reported_email) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    const isFasttrack = FASTTRACK_CATEGORIES.includes(category);

    const { error: insertErr } = await supabase.from('message_flags').insert({
      message_id: null, // manual reports aren't tied to one specific message
      sender_email: reported_email,   // the profile being reported
      recipient_email: reporter_email, // the person filing the report
      category,
      matched_terms: null,
      source: 'reported',
      severity: isFasttrack ? 'fast_track' : 'standard',
    });

    if (insertErr) {
      console.error('report.js message_flags insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to submit report', detail: insertErr.message });
    }

    if (isFasttrack) {
      try {
        await supabase.from('profiles')
          .update({ account_status: 'suspended_pending_review' })
          .eq('email', reported_email);
      } catch (suspendErr) {
        console.warn('report.js suspend error (non-fatal):', suspendErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('report.js unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
