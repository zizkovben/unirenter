// api/household/agreement-get.js
// GET — fetch agreement + ticks for a household
// Query: email, household_id
// Returns: { ok, agreement, ticks }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { email, household_id } = req.query || {};

  if (!email || !household_id) {
    return res.status(400).json({ ok: false, error: 'Missing email or household_id' });
  }

  // Verify membership
  const { data: memberRow } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household_id)
    .eq('email', email)
    .maybeSingle();

  if (!memberRow) {
    return res.status(403).json({ ok: false, error: 'Not a member of this household' });
  }

  // Fetch agreement
  const { data: agreement, error: agErr } = await supabase
    .from('household_agreement')
    .select('*')
    .eq('household_id', household_id)
    .maybeSingle();

  if (agErr) {
    console.error('agreement-get error:', agErr);
    return res.status(500).json({ ok: false, error: 'Failed to fetch agreement' });
  }

  if (!agreement) {
    return res.status(200).json({ ok: true, agreement: null, ticks: [] });
  }

  // Fetch all ticks for this agreement
  const { data: ticks } = await supabase
    .from('household_agreement_ticks')
    .select('member_email, clause_id, ticked_at')
    .eq('agreement_id', agreement.id);

  // Fetch all members so we can show who has/hasn't ticked each clause
  const { data: members } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household_id);

  return res.status(200).json({
    ok: true,
    agreement,
    ticks: ticks || [],
    members: (members || []).map(function(m) { return m.email; })
  });
};
