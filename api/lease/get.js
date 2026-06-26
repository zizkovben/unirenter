// api/lease/get.js
// Returns a single lease transfer listing by listing_ref.
// Called via GET /api/lease/get?ref=MEL-1234
// Used by listing detail view, handover flow, and lister's own management panel.
// Public read for active listings. Email param unlocks lister-only fields (status history etc).
// Auth: SUPABASE_SERVICE_ROLE_KEY server-side.

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { ref, email } = req.query;

  if (!ref || typeof ref !== 'string' || ref.trim().length < 4) {
    return res.status(400).json({ error: 'listing ref is required (e.g. MEL-1234)' });
  }

  try {
    const { data: listing, error } = await supabase
      .from('lease_listings')
      .select(`
        id,
        listing_ref,
        city,
        suburb,
        property_type,
        bedrooms,
        weekly_rent,
        available_from,
        lease_ends,
        furnished,
        pets_allowed,
        title,
        description,
        status,
        report_count,
        created_at,
        updated_at,
        expires_at
      `)
      .eq('listing_ref', ref.trim().toUpperCase())
      .maybeSingle();

    if (error) {
      console.error('[lease/get] Supabase error:', error);
      return res.status(500).json({ error: 'Could not fetch listing' });
    }

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // If requester is the lister (email matches), include lister-only fields
    let isOwner = false;
    if (email && typeof email === 'string') {
      const { data: ownerCheck } = await supabase
        .from('lease_listings')
        .select('email')
        .eq('listing_ref', ref.trim().toUpperCase())
        .maybeSingle();

      if (ownerCheck && ownerCheck.email === email.toLowerCase().trim()) {
        isOwner = true;
      }
    }

    // Non-owners cannot see withdrawn or timed_out listings
    if (!isOwner && !['active', 'proceeding', 'inspection_booked', 'handover', 'complete'].includes(listing.status)) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    return res.status(200).json({ success: true, listing, is_owner: isOwner });

  } catch (err) {
    console.error('[lease/get] error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
