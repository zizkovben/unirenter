// api/household/create.js — S45
// POST /api/household/create
// Creates a new household row and adds the creator as the first member.
// Returns: { ok: true, household_id, invite_token }
// CommonJS
 
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
 
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
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });
 
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
 
    // Check if user is already in a household
    const { data: existingMember } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('email', email)
      .maybeSingle();
 
    if (existingMember) {
      // Return existing household rather than creating another
      const inviteToken = await getOrCreateInviteToken(existingMember.household_id);
      return res.status(200).json({
        ok: true,
        household_id: existingMember.household_id,
        invite_token: inviteToken,
        existing: true
      });
    }
 
    // Generate a short, URL-safe invite token
    const inviteToken = crypto.randomBytes(12).toString('base64url');
 
    // Create household row
    const { data: household, error: hhErr } = await supabase
      .from('households')
      .insert({
        created_by: email,
        invite_token: inviteToken
      })
      .select('id')
      .single();
 
    if (hhErr || !household) {
      console.error('household create error:', hhErr);
      return res.status(500).json({ ok: false, error: 'Could not create household.' });
    }
 
    // Add creator as first member
    const { error: memberErr } = await supabase
      .from('household_members')
      .insert({
        household_id: household.id,
        email: email
      });
 
    if (memberErr) {
      console.error('household_members insert error:', memberErr);
      // Non-fatal — household created, member insert failed. Return partial success.
      return res.status(200).json({
        ok: true,
        household_id: household.id,
        invite_token: inviteToken,
        warning: 'Member row insert failed — reload to retry.'
      });
    }
 
    return res.status(200).json({
      ok: true,
      household_id: household.id,
      invite_token: inviteToken
    });
 
  } catch (err) {
    console.error('household/create unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};
 
async function getOrCreateInviteToken(householdId) {
  const { data } = await supabase
    .from('households')
    .select('invite_token')
    .eq('id', householdId)
    .single();
  if (data && data.invite_token) return data.invite_token;
  // Generate fresh token if missing
  const token = crypto.randomBytes(12).toString('base64url');
  await supabase.from('households').update({ invite_token: token }).eq('id', householdId);
  return token;
}
