// api/household/join.js — S45
// POST /api/household/join
// Validates an invite token and adds the caller to the household.
// Returns: { ok: true, household_id }
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
    const { token, email } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'token required' });
    if (!email)  return res.status(400).json({ ok: false, error: 'email required' });

    // Verify email is a known verified profile
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('email, email_verified')
      .eq('email', email)
      .single();

    if (profileErr || !profile) {
      return res.status(400).json({ ok: false, error: 'Profile not found. Please complete your profile first.' });
    }
    if (!profile.email_verified) {
      return res.status(400).json({ ok: false, error: 'Email not verified.' });
    }

    // Look up household by invite token
    const { data: household, error: hhErr } = await supabase
      .from('households')
      .select('id, created_by')
      .eq('invite_token', token)
      .maybeSingle();

    if (hhErr || !household) {
      return res.status(400).json({ ok: false, error: 'Invalid or expired invite link.' });
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('household_id', household.id)
      .eq('email', email)
      .maybeSingle();

    if (existingMember) {
      // Already a member — idempotent success
      return res.status(200).json({
        ok: true,
        household_id: household.id,
        already_member: true
      });
    }

    // Check if user is already in a different household
    const { data: otherMembership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('email', email)
      .maybeSingle();

    if (otherMembership && otherMembership.household_id !== household.id) {
      return res.status(400).json({
        ok: false,
        error: 'You\'re already in a different household. Contact support if you need to change households.'
      });
    }

    // Household size guard — max 6 members (a typical share house)
    const { count } = await supabase
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', household.id);

    if (count >= 6) {
      return res.status(400).json({ ok: false, error: 'This household is full (max 6 members).' });
    }

    // Add member
    const { error: memberErr } = await supabase
      .from('household_members')
      .insert({
        household_id: household.id,
        email: email
      });

    if (memberErr) {
      console.error('household_members join insert error:', memberErr);
      return res.status(500).json({ ok: false, error: 'Could not join household. Please try again.' });
    }

    return res.status(200).json({
      ok: true,
      household_id: household.id
    });

  } catch (err) {
    console.error('household/join unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};
