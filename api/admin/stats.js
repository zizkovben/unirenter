const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('./_verify');

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
    const [
      profilesRes,
      listingsRes,
      handoversRes,
      leaseCompanionRes,
      householdsRes,
      agentLeadsRes,
      matchedThreadsRes
    ] = await Promise.all([
      supabase.from('profiles').select(
        'city, student_status, generation, sleep_mode, email_unsubscribed, uni_email_verified, vibe_emoji_primary, cob_summary, match_email_1_sent_at, created_at'
      ),
      supabase.from('lease_listings').select('city, status, created_at'),
      supabase.from('lease_handover').select('status, created_at'),
      supabase.from('lease_companion_data').select('id, created_at'),
      supabase.from('households').select('city, created_at'),
      supabase.from('agent_leads').select('city, status, created_at'),
      // S180-ish: "Mark as matched" — self-reported confirmation count.
      supabase.from('message_threads').select('matched_confirmed_at').not('matched_confirmed_at', 'is', null)
    ]);

    const profiles  = profilesRes.data  || [];
    const listings  = listingsRes.data  || [];
    const handovers = handoversRes.data || [];
    const companions = leaseCompanionRes.data || [];
    const households = householdsRes.data || [];
    const leads = agentLeadsRes.data || [];
    const successfulMatches = (matchedThreadsRes.data || []).length;

    // ── Demographics ──────────────────────────────────
    const studentStatusMap = {};
    const generationMap = {};
    let sleepModeCount = 0;
    let unsubscribedCount = 0;
    let uniVerifiedCount = 0;
    let vibeCount = 0;
    let matchEmailCount = 0;

    profiles.forEach(p => {
      // Student status
      if (p.student_status) {
        studentStatusMap[p.student_status] = (studentStatusMap[p.student_status] || 0) + 1;
      }
      // Generation
      if (p.generation) {
        generationMap[p.generation] = (generationMap[p.generation] || 0) + 1;
      }
      if (p.sleep_mode) sleepModeCount++;
      if (p.email_unsubscribed) unsubscribedCount++;
      if (p.uni_email_verified) uniVerifiedCount++;
      if (p.vibe_emoji_primary) vibeCount++;
      if (p.match_email_1_sent_at) matchEmailCount++;
    });

    // City profile breakdown
    const cityProfiles = CITIES.map(city => ({
      city,
      count: profiles.filter(p => p.city === city).length
    }));

    // Signups over last 30 days (day buckets)
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const signupsByDay = {};
    for (let d = 0; d < 30; d++) {
      const dayKey = new Date(now - d * 86400000).toISOString().slice(0, 10);
      signupsByDay[dayKey] = 0;
    }
    profiles.forEach(p => {
      if (!p.created_at) return;
      const t = new Date(p.created_at).getTime();
      if (t >= thirtyDaysAgo) {
        const dayKey = new Date(t).toISOString().slice(0, 10);
        if (dayKey in signupsByDay) signupsByDay[dayKey]++;
      }
    });
    const signupTrend = Object.entries(signupsByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // ── Feature usage ─────────────────────────────────
    const breakLeaseTotal   = listings.length;
    const breakLeaseActive  = listings.filter(l => l.status === 'active').length;
    const breakLeaseFilled  = listings.filter(l => l.status === 'filled').length;
    const handoverTotal     = handovers.length;
    const handoverComplete  = handovers.filter(h => h.status === 'complete').length;
    const leaseCompanionUse = companions.length;
    const householdCount    = households.length;
    const agentLeadsTotal   = leads.length;
    const agentLeadsOpen    = leads.filter(l => l.status === 'new' || l.status === 'contacted' || l.status === 'in_progress').length;

    // Agent leads by city
    const agentLeadsByCity = CITIES.map(city => ({
      city,
      count: leads.filter(l => l.city === city).length
    }));

    return res.status(200).json({
      ok: true,
      demographics: {
        total_profiles: profiles.length,
        student_status: studentStatusMap,
        generation: generationMap,
        city_profiles: cityProfiles,
        signup_trend: signupTrend,
        sleep_mode_count: sleepModeCount,
        unsubscribed_count: unsubscribedCount,
        uni_verified_count: uniVerifiedCount,
        vibe_count: vibeCount,
        match_email_count: matchEmailCount
      },
      features: {
        break_lease_total: breakLeaseTotal,
        break_lease_active: breakLeaseActive,
        break_lease_filled: breakLeaseFilled,
        handover_total: handoverTotal,
        handover_complete: handoverComplete,
        lease_companion: leaseCompanionUse,
        households: householdCount,
        vibe_quizzes: vibeCount,
        match_emails_sent: matchEmailCount,
        successful_matches: successfulMatches,
        agent_leads_total: agentLeadsTotal,
        agent_leads_open: agentLeadsOpen,
        agent_leads_by_city: agentLeadsByCity
      }
    });

  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
