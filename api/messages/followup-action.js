// api/messages/followup-action.js — POST /api/messages/followup-action
// S145: records that the user has acted on (or dismissed) the post-match
// follow-up nudge ("Create a household / Leave a review / Not needed") for
// a specific conversation partner, so get.js's show_followup never fires
// again for that pair. Any of the three choices dismisses the card — the
// nudge itself is one-time regardless of which option was picked.
//
// POST body: { email, partner_email, action }
//   action: 'household_created' | 'reviewed' | 'not_needed'
//
// Upserts message_threads rather than requiring the row to already exist —
// safe even if get.js hasn't synced this pair yet (e.g. a race on first load).
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ACTIONS = ['household_created', 'reviewed', 'not_needed'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    const partnerEmail = (body.partner_email || '').trim().toLowerCase();
    const action = body.action;

    if (!email || !partnerEmail) {
      return res.status(400).json({ ok: false, error: 'email and partner_email required' });
    }
    if (!ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ ok: false, error: 'action must be one of: ' + ALLOWED_ACTIONS.join(', ') });
    }

    const [participant_a, participant_b] = [email, partnerEmail].sort();

    // Update rather than upsert — by the time this nudge is shown, get.js's
    // write-through sync has already created the message_threads row (the
    // nudge only appears for conversations already computed as cooling/
    // archived). Using update avoids violating other NOT NULL columns
    // (first_message_at, status, etc.) that a bare upsert wouldn't supply.
    // If no row exists yet (rare race), this just no-ops — the nudge will
    // correctly reappear next load rather than erroring the user's click.
    const { data, error } = await supabase
      .from('message_threads')
      .update({
        followup_dismissed: true,
        followup_action: action,
      })
      .eq('participant_a', participant_a)
      .eq('participant_b', participant_b)
      .select('participant_a');

    if (error) {
      console.error('[followup-action] Supabase error:', error);
      return res.status(500).json({ ok: false, error: 'Could not save' });
    }

    return res.status(200).json({ ok: true, updated: (data || []).length > 0 });

  } catch (err) {
    console.error('[followup-action] Unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
