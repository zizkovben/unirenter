// api/household/card-view.js — S160
// GET — public view of a household "card": members + household vibe, plus
// the locked housemate agreement if one exists. Deliberately separate from
// agreement-view.js's token space (households.share_token, not
// household_agreement.share_token) — a household can be shared the moment
// it exists, with or without ever starting an agreement. If a locked
// agreement is found for the household, it's included in the response in
// the exact same shape agreement-view.js already returns, so the shared
// page (unirenter-housemate-agreement.html) can render it with the same code path
// regardless of which route the visitor arrived from.
// Query: token
// Returns: { ok, agreement: {...} | null, members }
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

  const { token } = req.query || {};
  if (!token) {
    return res.status(400).json({ ok: false, error: 'Missing token' });
  }

  const { data: household, error: hhErr } = await supabase
    .from('households')
    .select('id, share_token')
    .eq('share_token', token)
    .maybeSingle();

  if (hhErr) {
    console.error('card-view household lookup error:', hhErr);
    return res.status(500).json({ ok: false, error: 'Failed to fetch household' });
  }
  if (!household) {
    return res.status(404).json({ ok: false, error: 'Household not found' });
  }

  // Members + vibe (same shape agreement-view.js already returns, so the
  // shared page's rendering code doesn't need to know which endpoint it came from)
  const { data: members } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household.id);

  var memberEmails = (members || []).map(function(m) { return m.email; });
  var memberProfiles = [];
  if (memberEmails.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, display_name, vibe_emoji_primary, vibe_emoji_secondary, cob_summary')
      .in('email', memberEmails);

    memberProfiles = (profiles || []).map(function(p) {
      return {
        email: p.email,
        display_name: p.display_name || p.email.split('@')[0],
        vibe_emoji: p.vibe_emoji_primary || '🏠',
        vibe_emoji_primary:   p.vibe_emoji_primary   || null,
        vibe_emoji_secondary: p.vibe_emoji_secondary || null,
        cob_summary:          p.cob_summary          || null
      };
    });
  }

  // Locked agreement, if any — layered in automatically. Not present, not
  // locked yet (draft), or never started all resolve to the same thing here:
  // agreement: null, and the shared page renders a members/vibe-only card.
  var agreementOut = null;
  const { data: agreement } = await supabase
    .from('household_agreement')
    .select('*')
    .eq('household_id', household.id)
    .not('locked_at', 'is', null)
    .order('locked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (agreement) {
    agreementOut = {
      id: agreement.id,
      tier: agreement.tier,
      clauses: agreement.clauses,
      all_equal_responsibility: agreement.all_equal_responsibility,
      head_tenant_email: agreement.head_tenant_email,
      locked_at: agreement.locked_at,
      locked_version: agreement.locked_version,
      share_token: agreement.share_token,
      created_at: agreement.created_at
    };
  }

  return res.status(200).json({
    ok: true,
    agreement: agreementOut,
    members: memberProfiles
  });
};
