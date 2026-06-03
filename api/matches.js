// api/matches.js
// Returns scored, ranked housemate matches for a given user.
// Called via POST /api/matches from city pages
// Body: { email, city } — returns top 10 compatible profiles + near_misses for Cob Phase 2
//
// near_misses: array of { constraint, unlock, suggestion, label }
// - constraint: which field is blocking more matches ('suburb' | 'accommodation_type' | 'budget' | 'break_lease')
// - unlock: how many additional matches would appear if this constraint were relaxed
// - suggestion: human-readable suggestion string for Cob to surface
// - label: short label for the constraint (e.g. 'location', 'budget')
// Only included when matches.length < 4
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
 
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }
 
  const { email, city = 'melbourne' } = req.body || {};
 
  try {
    // ── Fetch the requesting user's profile ──────────────────────────────────
    let myProfile = null;
 
    if (email) {
      const myRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&limit=1`,
        {
          headers: {
            'apikey':        serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
          },
        }
      );
      const myData = await myRes.json();
      myProfile = Array.isArray(myData) && myData.length > 0 ? myData[0] : null;
    }
 
    // ── Fetch candidate profiles ─────────────────────────────────────────────
    let url = `${supabaseUrl}/rest/v1/profiles?is_active=eq.true&city=eq.${encodeURIComponent(city)}&limit=100`;
    if (email) {
      url += `&email=neq.${encodeURIComponent(email)}`;
    }
 
    const candRes = await fetch(url, {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
 
    const candidates = await candRes.json();
 
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(200).json({ matches: [], near_misses: [], total: 0, note: 'No profiles found yet' });
    }
 
    // ── Score each candidate ─────────────────────────────────────────────────
    const scored = candidates.map(c => scoreCandidate(c, myProfile, city));
 
    // ── Sort by score, return top 10 ─────────────────────────────────────────
    const sorted = scored.sort((a, b) => b.match_score - a.match_score);
    const top = sorted.slice(0, 10);
 
    // ── Near misses — only compute when < 4 real matches ─────────────────────
    let near_misses = [];
    if (myProfile && top.length < 4) {
      near_misses = computeNearMisses(myProfile, candidates, city);
    }
 
    return res.status(200).json({
      matches:     top,
      near_misses,
      total:       candidates.length,
      city,
    });
 
  } catch (err) {
    console.error('api/matches error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
 
// ── Score a single candidate against the user's profile ─────────────────────
 
function scoreCandidate(c, myProfile, city) {
  let score = 0;
  const reasons = [];
 
  if (myProfile) {
    // Budget overlap (25 points)
    if (myProfile.budget_min && myProfile.budget_max && c.budget_min && c.budget_max) {
      const overlapMin = Math.max(myProfile.budget_min, c.budget_min);
      const overlapMax = Math.min(myProfile.budget_max, c.budget_max);
      if (overlapMax >= overlapMin) {
        score += 25;
        reasons.push('budget');
      }
    }
 
    // Sleep schedule (20 points)
    if (myProfile.sleep_schedule && c.sleep_schedule) {
      if (myProfile.sleep_schedule === c.sleep_schedule) {
        score += 20;
        reasons.push('sleep');
      } else if (isAdjacentSleep(myProfile.sleep_schedule, c.sleep_schedule)) {
        score += 10;
      }
    }
 
    // Cleanliness (20 points)
    if (myProfile.cleanliness && c.cleanliness) {
      if (myProfile.cleanliness === c.cleanliness) {
        score += 20;
        reasons.push('cleanliness');
      } else if (isAdjacentClean(myProfile.cleanliness, c.cleanliness)) {
        score += 10;
      }
    }
 
    // Suburb overlap (15 points)
    if (myProfile.suburb_preferences && c.suburb_preferences) {
      const mySuburbs = new Set(myProfile.suburb_preferences);
      const shared = (c.suburb_preferences || []).filter(s => mySuburbs.has(s));
      if (shared.length > 0) {
        score += Math.min(15, shared.length * 8);
        reasons.push('location');
      }
    }
 
    // Household type (10 points)
    if (myProfile.household_type && c.household_type) {
      if (
        myProfile.household_type === c.household_type ||
        myProfile.household_type === 'any' ||
        c.household_type === 'any'
      ) {
        score += 10;
      }
    }
 
    // Study location (5 points)
    if (myProfile.study_location && c.study_location &&
        myProfile.study_location === c.study_location) {
      score += 5;
    }
 
    // Guests preference (5 points)
    if (myProfile.guests && c.guests && myProfile.guests === c.guests) {
      score += 5;
      reasons.push('social');
    }
 
  } else {
    // No user profile — rank by profile completeness
    score = c.profile_complete || 50;
  }
 
  // Boost verified profiles
  if (c.email_verified)     score += 5;
  if (c.uni_email_verified) score += 5;
 
  // Cap at 100
  score = Math.min(100, score);
 
  return {
    id:                 c.id,
    display_name:       c.display_name || 'Student',
    university:         c.university || null,
    student_status:     c.student_status || null,
    year_of_study:      c.year_of_study || null,
    field_of_study:     c.field_of_study || null,
    city:               c.city || city,
    suburb_preferences: c.suburb_preferences || [],
    budget_min:         c.budget_min || null,
    budget_max:         c.budget_max || null,
    sleep_schedule:     c.sleep_schedule || null,
    cleanliness:        c.cleanliness || null,
    household_type:     c.household_type || null,
    seeking:            c.seeking || null,
    pets:               c.pets || null,
    dietary:            c.dietary || null,
    guests:             c.guests || null,
    substances:         c.substances || null,
    email_verified:     c.email_verified || false,
    uni_email_verified: c.uni_email_verified || false,
    profile_complete:   c.profile_complete || 0,
    match_score:        score,
    match_reasons:      reasons,
  };
}
 
// ── Near miss computation ────────────────────────────────────────────────────
// For each constraint, check how many additional matches would appear if relaxed.
// Only surface near_misses that would unlock >= 5 additional matches.
 
function computeNearMisses(myProfile, candidates, city) {
  const MIN_UNLOCK = 5;
  const results = [];
 
  // ── 1. Suburb relaxation ──────────────────────────────────────────────────
  // How many candidates score >= 50 overall if suburb constraint is removed?
  if (myProfile.suburb_preferences && myProfile.suburb_preferences.length > 0) {
    const relaxedProfile = { ...myProfile, suburb_preferences: [] };
    const relaxedMatches = candidates
      .map(c => scoreCandidate(c, relaxedProfile, city))
      .filter(c => c.match_score >= 50);
 
    const currentMatches = candidates
      .map(c => scoreCandidate(c, myProfile, city))
      .filter(c => c.match_score >= 50);
 
    const unlock = relaxedMatches.length - currentMatches.length;
 
    if (unlock >= MIN_UNLOCK) {
      // Find which suburbs appear most in the near-miss pool
      const nearMissCandidates = candidates.filter(c => {
        const relaxedScore = scoreCandidate(c, relaxedProfile, city).match_score;
        const currentScore = scoreCandidate(c, myProfile, city).match_score;
        return relaxedScore >= 50 && currentScore < 50;
      });
 
      const suburbCounts = {};
      nearMissCandidates.forEach(c => {
        (c.suburb_preferences || []).forEach(s => {
          suburbCounts[s] = (suburbCounts[s] || 0) + 1;
        });
      });
      const topSuburbs = Object.entries(suburbCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s);
 
      results.push({
        constraint:  'suburb',
        unlock,
        label:       'location',
        suggestion:  topSuburbs.length > 0
          ? `Adding ${topSuburbs.join(', ')} would unlock ${unlock} more matches`
          : `Widening your suburb preferences would unlock ${unlock} more matches`,
        suburbs:     topSuburbs,
      });
    }
  }
 
  // ── 2. Budget relaxation ──────────────────────────────────────────────────
  // How many more matches if budget_max increased by $30?
  if (myProfile.budget_max) {
    const relaxedProfile = { ...myProfile, budget_max: myProfile.budget_max + 30 };
    const relaxedMatches = candidates
      .map(c => scoreCandidate(c, relaxedProfile, city))
      .filter(c => c.match_score >= 50);
 
    const currentMatches = candidates
      .map(c => scoreCandidate(c, myProfile, city))
      .filter(c => c.match_score >= 50);
 
    const unlock = relaxedMatches.length - currentMatches.length;
 
    if (unlock >= MIN_UNLOCK) {
      results.push({
        constraint: 'budget',
        unlock,
        label:      'budget',
        suggestion: `Widening your budget by +$30/wk would unlock ${unlock} more matches`,
        amount:     30,
      });
    }
  }
 
  // ── 3. Accommodation type relaxation ─────────────────────────────────────
  // How many more if seeking is relaxed to include adjacent types?
  if (myProfile.seeking) {
    const seekingExpansion = {
      'Private room':   ['Private room', 'Share apartment'],
      'Share apartment':['Private room', 'Share apartment', 'Shared house'],
      'Shared house':   ['Share apartment', 'Shared house', 'Studio'],
      'Studio':         ['Studio', 'Private room'],
    };
    const expanded = seekingExpansion[myProfile.seeking] || [];
    if (expanded.length > 1) {
      const relaxedProfile = { ...myProfile, seeking: null }; // null = any
      const relaxedMatches = candidates
        .map(c => scoreCandidate(c, relaxedProfile, city))
        .filter(c => c.match_score >= 50);
 
      const currentMatches = candidates
        .map(c => scoreCandidate(c, myProfile, city))
        .filter(c => c.match_score >= 50);
 
      const unlock = relaxedMatches.length - currentMatches.length;
 
      if (unlock >= MIN_UNLOCK) {
        const alternatives = expanded.filter(s => s !== myProfile.seeking).slice(0, 2).join(' or ');
        results.push({
          constraint: 'accommodation_type',
          unlock,
          label:      'accommodation',
          suggestion: `Opening up to ${alternatives} would unlock ${unlock} more matches`,
          alternatives: expanded,
        });
      }
    }
  }
 
  // ── 4. Break lease listings ───────────────────────────────────────────────
  // Placeholder — will be meaningful once lease_listings table is populated
  // For now we skip this constraint; it will be wired in Session 23
 
  // ── Sort by unlock value descending — highest impact first ───────────────
  results.sort((a, b) => b.unlock - a.unlock);
 
  return results;
}
 
// ── Scoring helpers ──────────────────────────────────────────────────────────
 
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
