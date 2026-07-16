'use strict';
// api/household/find-create.js — S190
// Builds the full "Find a new flatmate" listing card originally specced as
// Feature E (Flatmate Wanted Listing Card, household version) back when the
// Household Hub was first designed. That spec was never fully built — the
// "Find a new flatmate" button ended up just showing a bare invite link,
// and a simpler plain-text-only generator ("Room Available", S187) was
// added later as a partial stand-in. This restores the original intent:
// a shareable public listing (/find/:token) with an embeddable household
// vibe card and the creator's own individual vibe card, same pattern as
// vibe-card.js (reuses the generic `listing_cards` table — card_type
// 'find_flatmate' — rather than a new bespoke schema).
//
// POST { email, household_id, rent, bedrooms, available_from, note,
//        include_vibe_card, include_household_card, include_cob_message }
// → { ok, token, url, expires_at }

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

  const {
    email, household_id,
    rent, bedrooms, available_from, note,
    include_vibe_card, include_household_card, include_cob_message
  } = req.body || {};

  if (!email || !household_id) {
    return res.status(400).json({ ok: false, error: 'email and household_id required' });
  }

  const normEmail = email.toLowerCase().trim();

  // Confirm the caller is actually a member of this household — the same
  // "auth-lite" pattern used elsewhere in api/household/* (no session
  // tokens on this platform yet, so membership itself is the check).
  const { data: membership, error: memErr } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('household_id', household_id)
    .eq('email', normEmail)
    .maybeSingle();

  if (memErr) {
    console.error('find-create membership check error:', memErr);
    return res.status(500).json({ ok: false, error: 'Could not verify household membership' });
  }
  if (!membership) {
    return res.status(403).json({ ok: false, error: 'Not a member of this household' });
  }

  // Household + members, same shape card-view.js already uses.
  const { data: household, error: hhErr } = await supabase
    .from('households')
    .select('id, share_token')
    .eq('id', household_id)
    .maybeSingle();

  if (hhErr || !household) {
    return res.status(404).json({ ok: false, error: 'Household not found' });
  }

  const { data: members } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household_id);

  const memberEmails = (members || []).map(function (m) { return m.email; });
  let memberProfiles = [];
  if (memberEmails.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, display_name, city, university, sleep_schedule, cleanliness, vibe_emoji_primary, vibe_emoji_secondary, cob_summary')
      .in('email', memberEmails);
    memberProfiles = profiles || [];
  }

  const city = (memberProfiles.find(function (p) { return p.city; }) || {}).city || 'my city';

  // If the creator wants their own individual vibe card included, look up
  // (but don't create — that's vibe-card.js's job) their existing token.
  let creatorVibeToken = null;
  if (include_vibe_card) {
    const { data: existingVibe } = await supabase
      .from('listing_cards')
      .select('token, expires_at')
      .eq('created_by', normEmail)
      .eq('card_type', 'vibe_individual')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingVibe && (!existingVibe.expires_at || new Date(existingVibe.expires_at) > new Date())) {
      creatorVibeToken = existingVibe.token;
    }
  }

  // Optional Cob one-liner — kept short and in-voice, not a full paragraph.
  var cobMessage = null;
  if (include_cob_message) {
    var n = memberProfiles.length;
    cobMessage = "🤠 " + n + (n === 1 ? " person" : " people") + " already calling this place home — seems like a good bunch. Reckon you'd fit right in.";
  }

  const cardData = {
    rent: rent || null,
    bedrooms: bedrooms || null,
    available_from: available_from || null,
    note: (note || '').slice(0, 140),
    city: city,
    members: memberProfiles.map(function (p) {
      return {
        display_name: p.display_name || p.email.split('@')[0],
        vibe_emoji: p.vibe_emoji_primary || '🏠'
      };
    }),
    sleep_traits: Array.from(new Set(memberProfiles.map(function (p) { return p.sleep_schedule; }).filter(Boolean))),
    clean_traits: Array.from(new Set(memberProfiles.map(function (p) { return p.cleanliness; }).filter(Boolean))),
    unis: Array.from(new Set(memberProfiles.map(function (p) { return p.university; }).filter(Boolean))),
    household_card_token: include_household_card ? household.share_token : null,
    creator_vibe_token: creatorVibeToken,
    cob_message: cobMessage,
    generated_at: new Date().toISOString()
  };

  const token = crypto.randomBytes(16).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertErr } = await supabase
    .from('listing_cards')
    .insert({
      created_by: normEmail,
      household_id: household_id,
      card_type: 'find_flatmate',
      token: token,
      data: cardData,
      expires_at: expiresAt
    });

  if (insertErr) {
    console.error('find-create insert error:', insertErr);
    return res.status(500).json({ ok: false, error: 'Could not save listing' });
  }

  return res.status(200).json({
    ok: true,
    token: token,
    url: 'https://unirenter.com.au/find/' + token,
    expires_at: expiresAt
  });
};
