'use strict';
// api/household/find-get.js — S190
// Public read for a household "Find a new flatmate" listing card.
// GET ?token=xxx → { ok, listing }
// Mirrors vibe-card-get.js's pattern against the same listing_cards table
// (card_type 'find_flatmate' instead of 'vibe_individual'). All fields in
// `data` were already sanitised at creation time (find-create.js only ever
// writes public-safe fields), so this can return it as-is.

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
  if (!token) return res.status(400).json({ ok: false, error: 'token required' });

  const { data: card, error: cardErr } = await supabase
    .from('listing_cards')
    .select('token, card_type, data, created_by, expires_at, created_at')
    .eq('token', token)
    .eq('card_type', 'find_flatmate')
    .maybeSingle();

  if (cardErr) {
    console.error('find-get error:', cardErr);
    return res.status(500).json({ ok: false, error: 'Failed to fetch listing' });
  }
  if (!card) {
    return res.status(404).json({ ok: false, error: 'Listing not found' });
  }

  if (card.expires_at && new Date(card.expires_at) < new Date()) {
    return res.status(410).json({ ok: false, error: 'Listing has expired' });
  }

  return res.status(200).json({
    ok: true,
    listing: card.data,
    expires_at: card.expires_at,
    created_at: card.created_at
  });
};
