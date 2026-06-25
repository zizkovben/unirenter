// api/matches.js
// Returns scored, ranked housemate matches for a given user.
// Called via POST /api/matches from city pages
// Body: { email, city } — returns top 10 compatible profiles + near_misses for Cob Phase 2
//
// near_misses: array of { constraint, unlock, suggestion, label }
// - constraint: which field is blocking more matches ('suburb' | 'accommodation_type' | 'budget' | 'break_lease' | 'profile_completeness')
// - unlock: how many additional matches would appear if this constraint were relaxed (not present on 'profile_completeness' — see below)
// - suggestion: human-readable suggestion string for Cob to surface
// - label: short label for the constraint (e.g. 'location', 'budget')
// - 'profile_completeness' is computed differently from the other types (see computeNearMisses) and is
//   always placed first in the array when present, ahead of the unlock-sorted constraint-relaxation entries.
// Only included when matches.length < 4
//
// Scoring (S81): real match scores (myProfile present) are compatibility-based, then scaled by the
// candidate's own profile_complete (thinner profiles score lower, not zero), then boosted for
// email/uni-email verification and recent activity (last_seen). Candidates below COMPLETENESS_FLOOR
// (35%) are excluded from candidate pools entirely before scoring — see the handler below.
 
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
 
    // ── Completeness floor (S81) — candidates below this threshold aren't
    // shown as real matches at all; there isn't enough profile data to compute
    // a meaningful compatibility score against them yet. Only applied when
    // matching against a real myProfile — leaves the (legacy, effectively
    // unreachable since the S80 fix) anonymous fallback path untouched.
    const COMPLETENESS_FLOOR = 35;
    const eligibleCandidates = myProfile
      ? candidates.filter(c => (typeof c.profile_complete === 'number' ? c.profile_complete : 50) >= COMPLETENESS_FLOOR)
      : candidates;
 
    // ── Score each candidate ─────────────────────────────────────────────────
    const scored = eligibleCandidates.map(c => scoreCandidate(c, myProfile, city));
 
    // ── Sort by score, return top 10 ─────────────────────────────────────────
    const sorted = scored.sort((a, b) => b.match_score - a.match_score);
    const top = sorted.slice(0, 10);
 
    // ── Near misses — only compute when < 4 real matches ─────────────────────
    let near_misses = [];
    if (myProfile && top.length < 4) {
      near_misses = computeNearMisses(myProfile, eligibleCandidates, city);
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
 
  // ── Completeness scaling (S81) — only applied to the compatibility-derived
  // score above, only when matching against a real myProfile. A fully complete
  // candidate keeps 100% of their compatibility score; a 40%-complete one is
  // discounted, not zeroed — reflects genuinely thinner match data without
  // being a cliff. Candidates below COMPLETENESS_FLOOR never reach this
  // function at all — they're filtered out by the caller before scoring.
  if (myProfile) {
    const completeness = typeof c.profile_complete === 'number' ? c.profile_complete : 50;
    score = score * (0.7 + 0.3 * completeness / 100);
  }
 
  // Boost verified profiles
  if (c.email_verified)     score += 5;
  if (c.uni_email_verified) score += 5;
 
  // ── Recent activity boost (S81) — rewards candidates who've actually been
  // using the platform recently, separate from is_active (which only gates
  // dormant/sleeping profiles out of the candidate pool entirely). Tiered,
  // flat, same mechanism as the verification boosts above.
  if (myProfile) {
    score += activityBoost(c.last_seen);
  }
 
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
    stay_duration:        c.stay_duration        || null,
    vibe_emoji_primary:   c.vibe_emoji_primary   || null,
    vibe_emoji_secondary: c.vibe_emoji_secondary || null,
    cob_summary:          c.cob_summary          || null,
    profile_complete:     c.profile_complete     || 0,
    last_seen:          c.last_seen || null,
    match_score:        Math.round(score),
    match_reasons:      reasons,
  };
}
 
// ── Recent activity boost (S81) ───────────────────────────────────────────────
// Tiered flat bonus based on last_seen recency. Separate from is_active (a hard
// gate already enforced by the sleep-mode system at 30/60 days) — this rewards
// genuinely recent use among already-active profiles, not just "not asleep yet."
function activityBoost(lastSeen) {
  if (!lastSeen) return 0;
  const daysAgo = (Date.now() - new Date(lastSeen).getTime()) / 86400000;
  if (daysAgo <= 7)  return 10;
  if (daysAgo <= 14) return 5;
  return 0;
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
 
  // ── 5. Profile completeness (S81) — checked separately from the constraint-
  // relaxation checks above, since it can't be measured the same way (we can't
  // simulate what a student would enter if they filled in more fields, so
  // there's no precise "unlock N matches" count to compute). When it applies,
  // it's unshifted to the front of the queue rather than competing on a guessed
  // number against the other types' precisely-computed counts — finishing a
  // sparse profile is a more foundational fix than any single constraint
  // relaxation, so it takes priority when both apply. This priority order also
  // doubles as the intended display queue once progressive (show-next-on-
  // dismiss) nudges are built — see roadmap.
  const COMPLETENESS_NUDGE_THRESHOLD = 70;
  if (typeof myProfile.profile_complete === 'number' && myProfile.profile_complete < COMPLETENESS_NUDGE_THRESHOLD) {
    results.unshift({
      constraint:   'profile_completeness',
      label:        'profile completeness',
      completeness: myProfile.profile_complete,
      suggestion:   `Your profile is ${myProfile.profile_complete}% complete — finishing it helps Cob match you more accurately`,
    });
  }
 
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
