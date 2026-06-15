// api/agents/stats.js
// GET /api/agents/stats?city=melbourne
// Returns: suburb demand heat, enquiry trend, budget distribution, uni breakdown, market context
// Auth: x-agent-token header (same as /api/agents/leads)
// CommonJS — no ES module syntax

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Validate agent token against agents table
async function getAgent(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('agents')
    .select('id, name, city, partner_since')
    .eq('token', token)
    .single();
  return data || null;
}

// ── Suburb demand heat ──────────────────────────────────────────────────────
// profiles.suburbs is a jsonb array of suburb strings
async function getSuburbHeat(city) {
  let query = supabase
    .from('profiles')
    .select('suburbs')
    .not('suburbs', 'is', null);
  if (city) query = query.eq('city', city);

  const { data, error } = await query;
  if (error || !data) return [];

  const counts = {};
  data.forEach(function(row) {
    let subs = row.suburbs;
    if (typeof subs === 'string') {
      try { subs = JSON.parse(subs); } catch (e) { return; }
    }
    if (!Array.isArray(subs)) return;
    subs.forEach(function(s) {
      if (typeof s === 'string' && s.trim()) {
        const key = s.trim();
        counts[key] = (counts[key] || 0) + 1;
      }
    });
  });

  return Object.entries(counts)
    .map(function(e) { return { suburb: e[0], count: e[1] }; })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 5);
}

// ── Enquiry trend — last 12 weeks from agent_leads ─────────────────────────
async function getTrend(city) {
  const now = new Date();
  const since = new Date(now.getTime() - 12 * 7 * 24 * 3600 * 1000).toISOString();

  let query = supabase
    .from('agent_leads')
    .select('created_at')
    .gte('created_at', since);
  if (city) query = query.eq('city', city);

  const { data, error } = await query;
  if (error || !data) return [];

  // Build 12-week buckets
  const weeks = [];
  for (var i = 11; i >= 0; i--) {
    const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 3600 * 1000);
    const weekEnd = new Date(now.getTime() - i * 7 * 24 * 3600 * 1000);
    const count = data.filter(function(l) {
      const d = new Date(l.created_at);
      return d >= weekStart && d < weekEnd;
    }).length;

    // Label as "Wk 1", "Wk 2" etc; mark Feb/July intake approach weeks
    const weekNum = 12 - i;
    const weekEndMonth = weekEnd.getMonth(); // 0=Jan, 1=Feb, 6=Jul
    let intakeLabel = null;
    // Flag weeks that end in late Jan (approaching Feb intake) or late Jun (approaching Jul)
    if (weekEndMonth === 0 && weekEnd.getDate() >= 20) intakeLabel = 'Feb intake';
    if (weekEndMonth === 5 && weekEnd.getDate() >= 20) intakeLabel = 'Jul intake';

    weeks.push({
      label: 'W' + weekNum,
      count: count,
      intakeLabel: intakeLabel
    });
  }
  return weeks;
}

// ── Budget distribution — from profiles ────────────────────────────────────
async function getBudgetBands(city) {
  let query = supabase
    .from('profiles')
    .select('budget_max')
    .not('budget_max', 'is', null);
  if (city) query = query.eq('city', city);

  const { data, error } = await query;
  if (error || !data) return [];

  // Bands: <150, 150-199, 200-249, 250-299, 300-349, 350+
  const bands = [
    { label: '<$150', min: 0, max: 149, count: 0 },
    { label: '$150-199', min: 150, max: 199, count: 0 },
    { label: '$200-249', min: 200, max: 249, count: 0 },
    { label: '$250-299', min: 250, max: 299, count: 0 },
    { label: '$300-349', min: 300, max: 349, count: 0 },
    { label: '$350+', min: 350, max: 9999, count: 0 }
  ];

  data.forEach(function(row) {
    const b = parseInt(row.budget_max, 10);
    if (isNaN(b)) return;
    for (var i = 0; i < bands.length; i++) {
      if (b >= bands[i].min && b <= bands[i].max) {
        bands[i].count++;
        break;
      }
    }
  });

  return bands;
}

// ── University breakdown — from profiles ────────────────────────────────────
async function getUniBreakdown(city) {
  let query = supabase
    .from('profiles')
    .select('uni')
    .not('uni', 'is', null);
  if (city) query = query.eq('city', city);

  const { data, error } = await query;
  if (error || !data) return [];

  const counts = {};
  data.forEach(function(row) {
    const u = (row.uni || '').trim();
    if (!u || u === 'Other' || u === 'TAFE / College') return;
    counts[u] = (counts[u] || 0) + 1;
  });

  return Object.entries(counts)
    .map(function(e) { return { uni: e[0], count: e[1] }; })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 7);
}

// ── Market context ──────────────────────────────────────────────────────────
async function getMarketContext(city) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // New student registrations this month
  let profilesQuery = supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStart);
  if (city) profilesQuery = profilesQuery.eq('city', city);

  // Total profiles
  let totalQuery = supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true });
  if (city) totalQuery = totalQuery.eq('city', city);

  // Active break lease listings (not expired)
  let leaseQuery = supabase
    .from('lease_listings')
    .select('id', { count: 'exact', head: true })
    .gt('expires_at', now.toISOString());
  if (city) leaseQuery = leaseQuery.eq('city', city);

  const [profilesRes, totalRes, leaseRes] = await Promise.all([
    profilesQuery,
    totalQuery,
    leaseQuery
  ]);

  return {
    newStudentsMonth: profilesRes.count !== null ? profilesRes.count : '—',
    totalProfiles: totalRes.count !== null ? totalRes.count : '—',
    activeLeaseListings: leaseRes.count !== null ? leaseRes.count : '—'
  };
}

// ── Main handler ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-agent-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-agent-token'];
  const agent = await getAgent(token);
  if (!agent) return res.status(401).json({ error: 'Unauthorised' });

  // City: use query param if provided, else agent's city, else all
  const city = req.query.city || null;

  try {
    const [suburbs, trend, budgetBands, unis, market] = await Promise.all([
      getSuburbHeat(city),
      getTrend(city),
      getBudgetBands(city),
      getUniBreakdown(city),
      getMarketContext(city)
    ]);

    return res.status(200).json({
      city: city || 'all',
      suburbs,
      trend,
      budgetBands,
      unis,
      market
    });
  } catch (err) {
    console.error('stats error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
