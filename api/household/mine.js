// api/household/mine.js
// GET /api/household/mine?email=xxx
// Lightweight membership check — does this user currently belong to a
// household, and (if so) is its agreement locked? Built for the post-match
// email sequence (S180-ish) so the day-14 Email 3 lazy-check can pick the
// right nudge (household vs agreement vs tenancy) without the caller
// needing to already know a household_id, which api/household/get.js
// requires. Deliberately minimal — no member list, no feed, no vibe card.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const rawEmail = (req.query || {}).email;
    if (!rawEmail) return res.status(400).json({ ok: false, error: 'email required' });
    const email = rawEmail.toLowerCase().trim();

    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .ilike('email', email)
      .maybeSingle();

    if (!membership) {
      return res.status(200).json({ ok: true, has_household: false, household_id: null, agreement_locked: false });
    }

    let agreementLocked = false;
    try {
      const { data: agreement } = await supabase
        .from('household_agreement')
        .select('locked_at')
        .eq('household_id', membership.household_id)
        .maybeSingle();
      agreementLocked = !!(agreement && agreement.locked_at);
    } catch (agErr) {
      // Non-fatal — agreement table shape may vary; absence just reads as not-locked.
    }

    return res.status(200).json({
      ok: true,
      has_household: true,
      household_id: membership.household_id,
      agreement_locked: agreementLocked,
    });
  } catch (err) {
    console.error('[household/mine] Unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
