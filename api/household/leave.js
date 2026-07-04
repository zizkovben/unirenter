// api/household/leave.js — S148, Household Ecosystem Expansion step 6
// POST /api/household/leave
// Removes the caller from a household: deletes their household_members row
// and unlinks (nulls) their lease_companions.household_id, so their lease
// dates stop appearing in the old household's layered timeline / calendar
// once they're no longer actually living there.
//
// Deliberately NOT a cascading delete of anything else. household_feed and
// household_feed_acks rows they authored/ticked are left untouched — chat
// history should still show who said what, and feed-get.js already gates
// access to the feed on current household_members membership, so a former
// member can no longer read or post to it once this runs.
//
// If this was the last member, the household row itself is left in place
// (orphaned, zero members) rather than deleted — consistent with this
// project's standing "soft, non-destructive by default" convention (see
// the message_threads "soft hide, not delete" decision, S144). An orphaned
// household with no members is invisible to everyone (household/get.js and
// feed-get.js both gate on household_members membership) and costs nothing
// to leave behind; a real hard-delete of household history is a one-way
// door that should be a deliberate future decision, not a side effect of
// one person leaving.
//
// CommonJS

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { household_id, email } = req.body || {};
    if (!household_id) return res.status(400).json({ ok: false, error: 'household_id required' });
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });

    const cleanEmail = String(email).toLowerCase().trim();

    // Verify the caller is actually a member of this household before removing anything.
    const { data: membership, error: memberCheckErr } = await supabase
      .from('household_members')
      .select('household_id, email')
      .eq('household_id', household_id)
      .eq('email', cleanEmail)
      .maybeSingle();

    if (memberCheckErr) {
      console.error('household/leave membership check error:', memberCheckErr);
      return res.status(500).json({ ok: false, error: 'Could not verify membership.' });
    }
    if (!membership) {
      // Already not a member — treat as idempotent success rather than an error,
      // so a double-click or a stale localStorage id doesn't surface a scary message.
      return res.status(200).json({ ok: true, already_left: true });
    }

    // ── Remove the membership row ────────────────────────────────────────────
    const { error: deleteErr } = await supabase
      .from('household_members')
      .delete()
      .eq('household_id', household_id)
      .eq('email', cleanEmail);

    if (deleteErr) {
      console.error('household/leave delete error:', deleteErr);
      return res.status(500).json({ ok: false, error: 'Could not leave household. Please try again.' });
    }

    // ── Unlink Lease Companion data from this household (non-fatal) ─────────
    // Without this, a departed housemate's lease_start/lease_end would keep
    // showing up in their old household's layered timeline and calendar
    // forever, since lease_companions rows are looked up independently of
    // household_members. Their lease data itself is untouched — just the
    // household_id link (added S146) is cleared.
    try {
      await supabase
        .from('lease_companions')
        .update({ household_id: null })
        .eq('email', cleanEmail)
        .eq('household_id', household_id);
    } catch (leaseErr) {
      console.warn('household/leave lease_companions unlink error (non-fatal):', leaseErr.message);
    }

    // ── Check remaining member count (informational only) ───────────────────
    let remaining = null;
    try {
      const { count } = await supabase
        .from('household_members')
        .select('*', { count: 'exact', head: true })
        .eq('household_id', household_id);
      remaining = typeof count === 'number' ? count : null;
    } catch (countErr) {
      console.warn('household/leave remaining-count error (non-fatal):', countErr.message);
    }

    return res.status(200).json({ ok: true, remaining_members: remaining });

  } catch (err) {
    console.error('household/leave unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};
