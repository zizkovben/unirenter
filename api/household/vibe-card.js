'use strict';
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });

  // Verify caller is a known verified profile
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('email, display_name, university, city, vibe_emoji_primary, vibe_emoji_secondary, cob_summary, star_sign, generation')
    .eq('email', email)
    .eq('email_verified', true)
    .single();

  if (profErr || !profile) {
    return res.status(404).json({ ok: false, error: 'Profile not found or not verified' });
  }

  if (!profile.vibe_emoji_primary || !profile.cob_summary) {
    return res.status(400).json({ ok: false, error: 'Complete your vibe summary first' });
  }

  // Check for an existing non-expired individual vibe card for this email
  const { data: existing } = await supabase
    .from('listing_cards')
    .select('token, expires_at')
    .eq('created_by', email)
    .eq('card_type', 'vibe_individual')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing && existing.expires_at && new Date(existing.expires_at) > new Date()) {
    // Return existing token
    return res.status(200).json({ ok: true, token: existing.token });
  }

  // Generate URL-safe base64url token
  const token = crypto.randomBytes(16).toString('base64url');

  // Expires 90 days from now
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const cardData = {
    display_name: profile.display_name,
    university: profile.university,
    city: profile.city,
    vibe_emoji_primary: profile.vibe_emoji_primary,
    vibe_emoji_secondary: profile.vibe_emoji_secondary,
    cob_summary: profile.cob_summary,
    star_sign: profile.star_sign,
    generation: profile.generation,
    generated_at: new Date().toISOString()
  };

  const { error: insertErr } = await supabase
    .from('listing_cards')
    .insert({
      created_by: email,
      household_id: null,
      card_type: 'vibe_individual',
      token: token,
      data: cardData,
      expires_at: expiresAt
    });

  if (insertErr) {
    return res.status(500).json({ ok: false, error: 'Could not save vibe card' });
  }

  return res.status(200).json({ ok: true, token: token });
};
