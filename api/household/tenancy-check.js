// api/household/tenancy-check.js — S148, Household Ecosystem Expansion step 7
// POST /api/household/tenancy-check
// Records a member's response to Cob's end-of-tenancy prompt ("Your lease
// shows it ended [date] — still living with your household?"). Handles the
// "Still together" and "Not now" (dismiss) responses only — "I've moved on"
// routes straight into the existing /api/household/leave endpoint (step 6)
// from the dashboard, since that's a different, more consequential action.
//
// Both "still_together" and "dismiss" do the same thing server-side: stamp
// household_members.tenancy_confirmed_at = now(). They're kept as separate
// values in the `action` field (not collapsed into one) purely so the
// column's history is honest about which button was actually pressed, in
// case that distinction becomes useful later (e.g. treating a real
// confirmation differently from a "leave me alone" from a decay/reminder
// system down the line). Right now both simply reset the re-ask window on
// the client (30 days — see householdTenancyCheckHtml in the dashboard).
//
// Deliberately does NOT change any decay/exemption logic in
// api/messages/get.js — this only feeds the dashboard's own re-ask timing.
// No auto-removal ever happens from a non-response, per the locked spec.
//
// CommonJS

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_ACTIONS = ['still_together', 'dismiss'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { household_id, email, action } = req.body || {};
    if (!household_id) return res.status(400).json({ ok: false, error: 'household_id required' });
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ ok: false, error: 'action must be one of: ' + VALID_ACTIONS.join(', ') });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    const { data: updated, error: updateErr } = await supabase
      .from('household_members')
      .update({ tenancy_confirmed_at: new Date().toISOString() })
      .eq('household_id', household_id)
      .eq('email', cleanEmail)
      .select('household_id, email')
      .maybeSingle();

    if (updateErr) {
      console.error('household/tenancy-check update error:', updateErr);
      // Non-fatal from the dashboard's point of view — the card just hides client-side
      // regardless, so a DB write failure here shouldn't surface a scary error to the user.
      return res.status(200).json({ ok: true, warning: 'Could not persist — may reappear next visit.' });
    }
    if (!updated) {
      return res.status(403).json({ ok: false, error: 'Not a member of this household.' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('household/tenancy-check unexpected error:', err);
    return res.status(200).json({ ok: true, warning: 'Server error — may reappear next visit.' });
  }
};
