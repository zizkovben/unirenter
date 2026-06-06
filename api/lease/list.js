// api/lease/list.js
// Returns active, non-expired lease listings for a given city.
// Called by unirenter-lease.html loadLeaseListings() after incoming gate is passed.
// Public read — no auth required (RLS on lease_listings already limits to active + not expired).
 
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
const VALID_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
 
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
 
  const city = (req.query.city || 'melbourne').toLowerCase();
 
  if (!VALID_CITIES.includes(city)) {
    return res.status(400).json({ error: 'Invalid city' });
  }
 
  try {
    const now = new Date().toISOString();
 
    const { data: listings, error } = await supabase
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
        created_at
      `)
      .eq('city', city)
      .eq('status', 'active')
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(50);
 
    if (error) {
      console.error('lease/list error:', error);
      return res.status(500).json({ error: 'Could not fetch listings' });
    }
 
    return res.status(200).json({ listings: listings || [] });
 
  } catch (err) {
    console.error('lease/list error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
