const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../_verify');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const payload = verifyToken(req.headers['authorization'], process.env.ADMIN_TOKEN_SECRET);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorised' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];

  try {
    // Run all queries in parallel
    const [
      profilesRes,
      listingsRes,
      handoversRes,
      recentProfilesRes,
      recentListingsRes
    ] = await Promise.all([
      supabase.from('profiles').select('city, created_at', { count: 'exact' }),
      supabase.from('lease_listings').select('city, status, report_count, created_at', { count: 'exact' }),
      supabase.from('lease_handover').select('status, created_at', { count: 'exact' }),
      // Recent signups — last 7 days
      supabase.from('profiles')
        .select('email, city, created_at')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
      // Recent listings — last 7 days
      supabase.from('lease_listings')
        .select('ref, city, status, created_at, poster_email')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10)
    ]);

    const profiles   = profilesRes.data   || [];
    const listings   = listingsRes.data   || [];
    const handovers  = handoversRes.data  || [];

    // --- KPI cards ---
    const totalProfiles        = profiles.length;
    const totalListings        = listings.length;
    const activeListings       = listings.filter(l => l.status === 'active').length;
    const pendingReview        = listings.filter(l => l.status === 'pending_review').length;
    const flaggedListings      = listings.filter(l => l.report_count >= 3 && l.status === 'active').length;
    const handoversInProgress  = handovers.filter(h => h.status !== 'complete').length;
    const handoversComplete    = handovers.filter(h => h.status === 'complete').length;

    // --- City breakdown ---
    const cityBreakdown = CITIES.map(city => ({
      city,
      profiles:        profiles.filter(p => p.city === city).length,
      active_listings: listings.filter(l => l.city === city && l.status === 'active').length,
      pending:         listings.filter(l => l.city === city && l.status === 'pending_review').length,
      flagged:         listings.filter(l => l.city === city && l.report_count >= 3 && l.status === 'active').length,
    }));

    // --- Recent activity feed (merge + sort) ---
    const activity = [
      ...(recentProfilesRes.data || []).map(p => ({
        type: 'signup',
        label: `New student signup — ${p.city}`,
        time: p.created_at,
        city: p.city
      })),
      ...(recentListingsRes.data || []).map(l => ({
        type: 'listing',
        label: `New listing ${l.ref} — ${l.city} (${l.status})`,
        time: l.created_at,
        city: l.city,
        status: l.status
      }))
    ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 15);

    return res.status(200).json({
      ok: true,
      kpis: {
        total_profiles:        totalProfiles,
        total_listings:        totalListings,
        active_listings:       activeListings,
        pending_review:        pendingReview,
        flagged_listings:      flaggedListings,
        handovers_in_progress: handoversInProgress,
        handovers_complete:    handoversComplete
      },
      city_breakdown: cityBreakdown,
      recent_activity: activity
    });

  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
