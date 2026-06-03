// api/notify/register.js
// Registers a student for "notify me when matches open" for a given city.
// Body: { email, city }
//
// Flow:
// 1. Validate input
// 2. Upsert into coming_soon_notify table
// 3. Send confirmation email via Resend
// 4. Check if city has now crossed the broadcast threshold:
//    - Condition A: >= 15 verified profiles in that city (10 for Canberra)
//    - Condition B: >= 60% of those profiles would receive >= 3 real matches
//    - If both: fire broadcast to all notified emails for that city
//              set city_status.city_launched = true (prevents repeat broadcast)
// 5. Return { ok: true, already_registered: bool }
 
const BROADCAST_THRESHOLDS = {
  melbourne: 15,
  sydney:    15,
  brisbane:  15,
  adelaide:  15,
  perth:     15,
  canberra:  10,
};
 
const MATCH_DENSITY_THRESHOLD = 0.6; // 60% of profiles must get >= 3 matches
const MIN_MATCHES_FOR_DENSITY  = 3;
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey   = process.env.RESEND_API_KEY;
 
  if (!supabaseUrl || !serviceKey || !resendKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }
 
  const { email, city } = req.body || {};
 
  if (!email || !city) {
    return res.status(400).json({ error: 'email and city are required' });
  }
 
  const emailLower = email.toLowerCase().trim();
  const cityLower  = city.toLowerCase().trim();
 
  const validCities = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
  if (!validCities.includes(cityLower)) {
    return res.status(400).json({ error: 'Invalid city' });
  }
 
  const headers = {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates,return=representation',
  };
 
  try {
    // ── 1. Upsert into coming_soon_notify ────────────────────────────────────
    const upsertRes = await fetch(
      `${supabaseUrl}/rest/v1/coming_soon_notify`,
      {
        method:  'POST',
        headers,
        body: JSON.stringify({
          email:      emailLower,
          city:       cityLower,
          created_at: new Date().toISOString(),
        }),
      }
    );
 
    const upsertData = await upsertRes.json();
    const alreadyRegistered = Array.isArray(upsertData) && upsertData.length > 0
      ? upsertData[0].notified_at !== null
      : false;
 
    // ── 2. Send confirmation email ────────────────────────────────────────────
    const cityDisplay = cityLower.charAt(0).toUpperCase() + cityLower.slice(1);
    await sendConfirmationEmail(resendKey, emailLower, cityDisplay);
 
    // ── 3. Check broadcast threshold (async, non-blocking for response) ──────
    checkAndBroadcast({ supabaseUrl, serviceKey, resendKey, city: cityLower, cityDisplay })
      .catch(err => console.error('Broadcast check error:', err));
 
    return res.status(200).json({ ok: true, already_registered: alreadyRegistered });
 
  } catch (err) {
    console.error('api/notify/register error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
 
// ── Confirmation email ────────────────────────────────────────────────────────
 
async function sendConfirmationEmail(resendKey, email, cityDisplay) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'UniRenter <noreply@unirenter.com.au>',
      to:      [email],
      subject: `You're on the list — UniRenter ${cityDisplay}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#0d1f2d;color:#e8f0f5;padding:32px;border-radius:12px;">
          <div style="font-family:Epilogue,sans-serif;font-size:22px;font-weight:700;margin-bottom:8px;">
            🤠 You're on the list!
          </div>
          <p style="color:#7a96aa;font-size:14px;margin-bottom:24px;">
            You're registered for match notifications in <strong style="color:#4BBFE0;">${cityDisplay}</strong>.
          </p>
          <p style="font-size:15px;line-height:1.7;margin-bottom:24px;">
            As soon as enough compatible students join UniRenter ${cityDisplay},
            we'll email you straight away — usually within a few days of the city launch.
          </p>
          <p style="font-size:13px;color:#7a96aa;">
            While you wait, your profile is already saved. When the matches open, you'll be first in line.
          </p>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
          <p style="font-size:12px;color:#7a96aa;">
            UniRenter · Helping students find their place in Australia 🇦🇺<br>
            <a href="https://unirenter.vercel.app" style="color:#4BBFE0;">unirenter.vercel.app</a>
          </p>
        </div>
      `,
    }),
  });
}
 
// ── Auto-broadcast check ──────────────────────────────────────────────────────
// Runs after every registration. Checks if city has crossed both thresholds.
// If yes, fires broadcast and marks city as launched in city_status table.
 
async function checkAndBroadcast({ supabaseUrl, serviceKey, resendKey, city, cityDisplay }) {
  const headers = {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type':  'application/json',
  };
 
  // ── Check if already launched ─────────────────────────────────────────────
  const statusRes = await fetch(
    `${supabaseUrl}/rest/v1/city_status?city=eq.${city}&limit=1`,
    { headers }
  );
  const statusData = await statusRes.json();
  if (Array.isArray(statusData) && statusData.length > 0 && statusData[0].city_launched) {
    return; // Already launched — do nothing
  }
 
  // ── Condition A: count verified profiles ─────────────────────────────────
  const threshold = BROADCAST_THRESHOLDS[city] || 15;
  const profilesRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?city=eq.${city}&email_verified=eq.true&is_active=eq.true&select=id,suburb_preferences,budget_min,budget_max,sleep_schedule,cleanliness,household_type,seeking,study_location,guests,email_verified,uni_email_verified,profile_complete`,
    { headers }
  );
  const profiles = await profilesRes.json();
 
  if (!Array.isArray(profiles) || profiles.length < threshold) {
    return; // Not enough verified profiles yet
  }
 
  // ── Condition B: match density check ─────────────────────────────────────
  // For each profile, count how many other profiles it would match with score >= 50
  let profilesWithGoodMatches = 0;
 
  for (const profile of profiles) {
    const others = profiles.filter(p => p.id !== profile.id);
    const matchCount = others.filter(other => {
      return quickScore(profile, other) >= 50;
    }).length;
 
    if (matchCount >= MIN_MATCHES_FOR_DENSITY) {
      profilesWithGoodMatches++;
    }
  }
 
  const density = profilesWithGoodMatches / profiles.length;
 
  if (density < MATCH_DENSITY_THRESHOLD) {
    return; // Not enough match density yet
  }
 
  // ── Both conditions met — fire broadcast ─────────────────────────────────
  // 1. Mark city as launched first (prevents duplicate broadcast if called concurrently)
  await fetch(
    `${supabaseUrl}/rest/v1/city_status`,
    {
      method:  'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        city,
        city_launched:    true,
        launched_at:      new Date().toISOString(),
        profile_count:    profiles.length,
        match_density:    Math.round(density * 100),
      }),
    }
  );
 
  // 2. Fetch all registered notify emails for this city (not yet notified)
  const notifyRes = await fetch(
    `${supabaseUrl}/rest/v1/coming_soon_notify?city=eq.${city}&notified_at=is.null`,
    { headers }
  );
  const notifyList = await notifyRes.json();
 
  if (!Array.isArray(notifyList) || notifyList.length === 0) {
    return;
  }
 
  // 3. Send broadcast emails (batch — Resend supports up to 100 recipients per call via bcc)
  //    We send individually to personalise + avoid exposing addresses to each other
  const emails = notifyList.map(r => r.email).filter(Boolean);
 
  // Send in batches of 50 to avoid rate limits
  const BATCH_SIZE = 50;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(email => sendBroadcastEmail(resendKey, email, city, cityDisplay, profiles.length)));
  }
 
  // 4. Mark all as notified
  const notifiedIds = notifyList.map(r => r.id);
  await fetch(
    `${supabaseUrl}/rest/v1/coming_soon_notify?city=eq.${city}&notified_at=is.null`,
    {
      method:  'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    }
  );
 
  console.log(`✅ Broadcast fired for ${city}: ${emails.length} emails sent. Profiles: ${profiles.length}, Density: ${Math.round(density * 100)}%`);
}
 
// ── Broadcast email ───────────────────────────────────────────────────────────
 
async function sendBroadcastEmail(resendKey, email, city, cityDisplay, profileCount) {
  const cityUrl = city === 'melbourne'
    ? 'https://unirenter.vercel.app'
    : `https://unirenter.vercel.app/${city}`;
 
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'UniRenter <noreply@unirenter.com.au>',
      to:      [email],
      subject: `🎉 Your matches are ready — UniRenter ${cityDisplay}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#0d1f2d;color:#e8f0f5;padding:32px;border-radius:12px;">
          <div style="font-family:Epilogue,sans-serif;font-size:24px;font-weight:700;margin-bottom:8px;">
            🎉 Your matches are live!
          </div>
          <p style="color:#7a96aa;font-size:14px;margin-bottom:24px;">
            UniRenter ${cityDisplay} is now live with real student profiles.
          </p>
          <p style="font-size:15px;line-height:1.7;margin-bottom:24px;">
            We now have <strong style="color:#F5B800;">${profileCount}+ verified students</strong>
            looking for accommodation in ${cityDisplay}.
            Your matches are ready — go see who you're compatible with.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${cityUrl}" style="background:#F5B800;color:#0d1f2d;font-family:Epilogue,sans-serif;font-weight:700;font-size:16px;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;">
              See my matches →
            </a>
          </div>
          <p style="font-size:13px;color:#7a96aa;line-height:1.6;">
            Your profile is already saved. Just open UniRenter and tap "Show my matches" — 
            Cob will walk you through the rest 🤠
          </p>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
          <p style="font-size:12px;color:#7a96aa;">
            UniRenter · Helping students find their place in Australia 🇦🇺<br>
            <a href="https://unirenter.vercel.app" style="color:#4BBFE0;">unirenter.vercel.app</a>
          </p>
        </div>
      `,
    }),
  });
}
 
// ── Quick score helper (lightweight — for density check only) ────────────────
 
function quickScore(a, b) {
  let score = 0;
 
  // Budget overlap
  if (a.budget_min && a.budget_max && b.budget_min && b.budget_max) {
    const overlapMin = Math.max(a.budget_min, b.budget_min);
    const overlapMax = Math.min(a.budget_max, b.budget_max);
    if (overlapMax >= overlapMin) score += 25;
  }
 
  // Sleep schedule
  if (a.sleep_schedule && b.sleep_schedule) {
    if (a.sleep_schedule === b.sleep_schedule) score += 20;
    else if (isAdjacentSleep(a.sleep_schedule, b.sleep_schedule)) score += 10;
  }
 
  // Cleanliness
  if (a.cleanliness && b.cleanliness) {
    if (a.cleanliness === b.cleanliness) score += 20;
    else if (isAdjacentClean(a.cleanliness, b.cleanliness)) score += 10;
  }
 
  // Suburb overlap
  if (a.suburb_preferences && b.suburb_preferences) {
    const aSuburbs = new Set(a.suburb_preferences);
    const shared = (b.suburb_preferences || []).filter(s => aSuburbs.has(s));
    if (shared.length > 0) score += Math.min(15, shared.length * 8);
  }
 
  return Math.min(100, score);
}
 
function isAdjacentSleep(a, b) {
  const order = ['early_bird', 'flexible', 'night_owl'];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  return ai !== -1 && bi !== -1 && Math.abs(ai - bi) === 1;
}
 
function isAdjacentClean(a, b) {
  const order = ['relaxed', 'average', 'tidy', 'very_tidy'];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  return ai !== -1 && bi !== -1 && Math.abs(ai - bi) === 1;
}
