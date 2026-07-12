// api/_lib/match-score.js
// Extracted from api/matches.js (S163) — this was previously 100% inline in
// the handler, despite prior bible sessions claiming this module existed.
// Ground-truth checked against GitHub before writing this file (S163).
//
// Exposes the pure scoring functions so api/matches.js can require() them
// instead of duplicating logic. No Supabase/network calls live here —
// everything below is pure data-in, data-out.
 
// ── Score weights (out of 100) ────────────────────────────────────────────
// S163: rebalanced to make room for pets + kitchen_habits, which were
// previously returned to the client but never factored into match_score.
const WEIGHTS = {
  budget:          22,
  sleep:           18,
  cleanliness:     18,
  suburb:          13,
  pets:            10,
  kitchen_habits:   8,
  household_type:   6,
  study_location:   3,
  guests:           2,
};
// 22+18+18+13+10+8+6+3+2 = 100
 
// ── Score a single candidate against the user's profile ─────────────────────
function scoreCandidate(c, myProfile, city) {
  let score = 0;
  const reasons = [];
 
  if (myProfile) {
    // Budget overlap
    if (myProfile.budget_min && myProfile.budget_max && c.budget_min && c.budget_max) {
      const overlapMin = Math.max(myProfile.budget_min, c.budget_min);
      const overlapMax = Math.min(myProfile.budget_max, c.budget_max);
      if (overlapMax >= overlapMin) {
        score += WEIGHTS.budget;
        reasons.push('budget');
      }
    }
 
    // Sleep schedule
    if (myProfile.sleep_schedule && c.sleep_schedule) {
      if (myProfile.sleep_schedule === c.sleep_schedule) {
        score += WEIGHTS.sleep;
        reasons.push('sleep');
      } else if (isAdjacentSleep(myProfile.sleep_schedule, c.sleep_schedule)) {
        score += WEIGHTS.sleep / 2;
      }
    }
 
    // Cleanliness
    if (myProfile.cleanliness && c.cleanliness) {
      if (myProfile.cleanliness === c.cleanliness) {
        score += WEIGHTS.cleanliness;
        reasons.push('cleanliness');
      } else if (isAdjacentClean(myProfile.cleanliness, c.cleanliness)) {
        score += WEIGHTS.cleanliness / 2;
      }
    }
 
    // Suburb overlap
    if (myProfile.suburb_preferences && c.suburb_preferences) {
      const mySuburbs = new Set(myProfile.suburb_preferences);
      const shared = (c.suburb_preferences || []).filter(s => mySuburbs.has(s));
      if (shared.length > 0) {
        score += Math.min(WEIGHTS.suburb, shared.length * (WEIGHTS.suburb / 2));
        reasons.push('location');
      }
    }
 
    // Pets (S163) — parsed from the vibe-quiz emoji tokens (e.g. "🐱 🐾" or
    // "🚫🐶"). See scorePets() below for the conflict-detection logic.
    const petsScore = scorePets(myProfile.pets, c.pets, WEIGHTS.pets);
    if (petsScore >= WEIGHTS.pets * 0.9) reasons.push('pets');
    score += petsScore;
 
    // Kitchen habits (S163) — free-text field (vibe quiz Q3), scored with a
    // conservative keyword-overlap heuristic. This is a v1: it's a genuine
    // free-text field today, not a structured chip set, so treat this as a
    // soft signal rather than a precise match. Will get more accurate once
    // the pets/vibe-quiz consolidation work gives it real structured values.
    const kitchenScore = scoreKitchen(myProfile.kitchen_habits, c.kitchen_habits, WEIGHTS.kitchen_habits);
    if (kitchenScore >= WEIGHTS.kitchen_habits * 0.9) reasons.push('kitchen');
    score += kitchenScore;
 
    // Household type
    if (myProfile.household_type && c.household_type) {
      if (
        myProfile.household_type === c.household_type ||
        myProfile.household_type === 'any' ||
        c.household_type === 'any'
      ) {
        score += WEIGHTS.household_type;
      }
    }
 
    // Study location
    if (myProfile.study_location && c.study_location &&
        myProfile.study_location === c.study_location) {
      score += WEIGHTS.study_location;
    }
 
    // Guests preference
    if (myProfile.guests && c.guests && myProfile.guests === c.guests) {
      score += WEIGHTS.guests;
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
    email:              c.email || null,
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
    kitchen_habits:     c.kitchen_habits || null,
    dietary:            c.dietary || null,
    guests:             c.guests || null,
    substances:         c.substances || null,
    email_verified:     c.email_verified || false,
    uni_email_verified: c.uni_email_verified || false,
    stay_duration:        c.stay_duration        || null,
    vibe_emoji_primary:   c.vibe_emoji_primary   || null,
    vibe_emoji_secondary: c.vibe_emoji_secondary || null,
    cob_summary:          c.cob_summary          || null,
    cob_narrative:        c.cob_narrative        || null,
    profile_complete:     c.profile_complete     || 0,
    last_seen:          c.last_seen || null,
    // S156: optional profile badges — display-only, deliberately excluded
    // from the scoring function above. Not a match factor, just surfaced
    // on the card the same way vibe_emoji already is.
    star_sign:          c.star_sign || null,
    generation:         c.generation || null,
    chinese_zodiac:     c.chinese_zodiac || null,
    match_score:        Math.round(score),
    match_reasons:      reasons,
  };
}
 
// ── Recent activity boost (S81) ───────────────────────────────────────────────
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
 
  results.sort((a, b) => b.unlock - a.unlock);
 
  // ── 5. Profile completeness (S81) ─────────────────────────────────────────
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
 
// ── Pets (S163) ───────────────────────────────────────────────────────────
// pets is stored as a space-joined string of fixed emoji tokens from the
// vibe quiz multi-emoji question — e.g. "🐱 🐾" or "🚫🐶" or "No preference".
// This is a closed vocabulary (unlike kitchen_habits), so real conflict
// detection is possible: a dealbreaker token ("🚫🐱") against a candidate who
// has that pet, or who loves all pets ("🐾"), is scored as a hard conflict.
const PET_POSITIVE   = ['🐱', '🐶', '🐦', '🐠', '🐾'];
const PET_DEALBREAKERS = { '🚫🐱': '🐱', '🚫🐶': '🐶' };
 
function scorePets(myPets, candPets, weight) {
  if (!myPets || !candPets) return weight * 0.6;
 
  const myTokens = myPets.split(/\s+/).filter(Boolean);
  const cTokens  = candPets.split(/\s+/).filter(Boolean);
 
  // Hard conflict: a stated dealbreaker against a pet (or "loves all pets")
  // the other person actually has.
  for (const neg of Object.keys(PET_DEALBREAKERS)) {
    const pos = PET_DEALBREAKERS[neg];
    if ((myTokens.includes(neg) && (cTokens.includes(pos) || cTokens.includes('🐾'))) ||
        (cTokens.includes(neg) && (myTokens.includes(pos) || myTokens.includes('🐾')))) {
      return 0;
    }
  }
 
  // Shared specific pet or shared "loves all pets" — strong match.
  const sharedPositive = myTokens.some(t => PET_POSITIVE.includes(t) && cTokens.includes(t));
  if (sharedPositive) return weight;
 
  const myHasPet = myTokens.some(t => PET_POSITIVE.includes(t));
  const cHasPet  = cTokens.some(t => PET_POSITIVE.includes(t));
  if (!myHasPet && !cHasPet) return weight * 0.8; // both pet-free / no preference — low friction
  return weight * 0.5; // one has pets, other has no stated objection — moderate credit
}
 
// ── Kitchen habits (S163) ──────────────────────────────────────────────────
// kitchen_habits is free text (vibe quiz Q3) — not a structured field yet.
// This is a v1 heuristic: keyword overlap between the two free-text answers,
// capped and scaled. It's a soft signal, not a precise match, and is
// expected to be superseded once the pets/vibe-quiz consolidation work
// gives this field real structured values to score against.
const KITCHEN_STOPWORDS = new Set([
  'that', 'this', 'with', 'have', 'from', 'they', 'just', 'really',
  'pretty', 'also', 'then', 'usually', 'sometimes', 'often', 'about',
]);
 
function scoreKitchen(myText, candText, weight) {
  if (!myText || !candText) return weight * 0.5;
 
  const tokenize = (s) => s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !KITCHEN_STOPWORDS.has(w));
 
  const a = new Set(tokenize(myText));
  const b = new Set(tokenize(candText));
  if (a.size === 0 || b.size === 0) return weight * 0.5;
 
  let shared = 0;
  a.forEach(w => { if (b.has(w)) shared += 1; });
 
  const denom = Math.min(a.size, b.size, 6); // cap so short answers don't get inflated ratios
  const ratio = denom > 0 ? shared / denom : 0;
  return Math.min(weight, Math.round(weight * Math.min(1, ratio)));
}
 
module.exports = {
  scoreCandidate,
  computeNearMisses,
  isAdjacentSleep,
  isAdjacentClean,
  activityBoost,
  scorePets,
  scoreKitchen,
  WEIGHTS,
};
 
