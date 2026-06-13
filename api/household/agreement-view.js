// api/household/agreement-view.js
// GET — public view of a locked agreement by share_token
// Query: token
// Returns: { ok, agreement, members }

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

  // Fetch agreement by share_token
  const { data: agreement, error: agErr } = await supabase
    .from('household_agreement')
    .select('*')
    .eq('share_token', token)
    .maybeSingle();

  if (agErr) {
    console.error('agreement-view error:', agErr);
    return res.status(500).json({ ok: false, error: 'Failed to fetch agreement' });
  }

  if (!agreement) {
    return res.status(404).json({ ok: false, error: 'Agreement not found' });
  }

  // Fetch member display info from profiles (first name + vibe emoji)
  const { data: members } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', agreement.household_id);

  var memberEmails = (members || []).map(function(m) { return m.email; });

  var memberProfiles = [];
  if (memberEmails.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, display_name, vibe_emoji_primary')
      .in('email', memberEmails);

    memberProfiles = (profiles || []).map(function(p) {
      return {
        email: p.email,
        display_name: p.display_name || p.email.split('@')[0],
        vibe_emoji: p.vibe_emoji_primary || '🏠'
      };
    });
  }

  return res.status(200).json({
    ok: true,
    agreement: {
      id: agreement.id,
      tier: agreement.tier,
      clauses: agreement.clauses,
      all_equal_responsibility: agreement.all_equal_responsibility,
      head_tenant_email: agreement.head_tenant_email,
      locked_at: agreement.locked_at,
      locked_version: agreement.locked_version,
      share_token: agreement.share_token,
      created_at: agreement.created_at
    },
    members: memberProfiles
  });
};
