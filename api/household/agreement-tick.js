// api/household/agreement-tick.js
// POST — toggle a member's tick on a clause (upsert/delete)
// Body: { email, agreement_id, clause_id, ticked }
// Returns: { ok, ticked }

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

  const { email, agreement_id, clause_id, ticked } = req.body || {};

  if (!email || !agreement_id || !clause_id) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Check agreement is not locked
  const { data: agreement } = await supabase
    .from('household_agreement')
    .select('locked_at, household_id')
    .eq('id', agreement_id)
    .maybeSingle();

  if (!agreement) {
    return res.status(404).json({ ok: false, error: 'Agreement not found' });
  }

  if (agreement.locked_at) {
    return res.status(403).json({ ok: false, error: 'Agreement is locked' });
  }

  // Verify membership
  const { data: memberRow } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', agreement.household_id)
    .eq('email', email)
    .maybeSingle();

  if (!memberRow) {
    return res.status(403).json({ ok: false, error: 'Not a member of this household' });
  }

  if (ticked) {
    // Upsert tick
    const { error: upsertErr } = await supabase
      .from('household_agreement_ticks')
      .upsert(
        { agreement_id, member_email: email, clause_id, ticked_at: new Date().toISOString() },
        { onConflict: 'agreement_id,member_email,clause_id' }
      );

    if (upsertErr) {
      console.error('agreement-tick upsert error:', upsertErr);
      return res.status(500).json({ ok: false, error: 'Failed to save tick' });
    }
  } else {
    // Remove tick
    const { error: deleteErr } = await supabase
      .from('household_agreement_ticks')
      .delete()
      .eq('agreement_id', agreement_id)
      .eq('member_email', email)
      .eq('clause_id', clause_id);

    if (deleteErr) {
      console.error('agreement-tick delete error:', deleteErr);
      return res.status(500).json({ ok: false, error: 'Failed to remove tick' });
    }
  }

  return res.status(200).json({ ok: true, ticked: !!ticked });
};
