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
 
// ── Gender preference (S167) ─────────────────────────────────────────────
// Hard filter, not a scoring factor — checked by the caller (api/matches.js)
// before scoreCandidate ever runs, so a mismatch means the candidate never
// appears at all rather than just scoring lower.
//
// `gender` = own identity, single value ('Woman' | 'Man' | 'Non-binary' |
// 'Prefer not to say' | null). `household_gender_pref` = comma-joined
// multi-select, e.g. "👩 Women only, 🏳️‍🌈 LGBTQ+ friendly important".
//
// Only the mutually-exclusive Women-only / Men-only signal is used here.
// "🤝 Mixed gender — no preference", "🏳️‍🌈 LGBTQ+ friendly important" and
// "📵 No couples" are separate dimensions and don't affect this filter.
//
// Unspecified/missing gender on either side is NEVER used to exclude —
// a mismatch is only ever a hard filter when both the stated household
// preference and the other person's stated identity are known and conflict.
// This mirrors the "never used to exclude you" treatment already applied
// to age_bracket elsewhere in this file.
const HH_WOMEN_ONLY = '👩 Women only';
const HH_MEN_ONLY   = '👨 Men only';

function isGenderCompatible(myProfile, candidate) {
  if (!myProfile) return true;

  const myPrefTokens = (myProfile.household_gender_pref || '').split(', ').filter(Boolean);
  const cPrefTokens  = (candidate.household_gender_pref || '').split(', ').filter(Boolean);
  const myGender = myProfile.gender || null;
  const cGender  = candidate.gender || null;

  if (myPrefTokens.includes(HH_WOMEN_ONLY) && cGender && cGender !== 'Woman') return false;
  if (myPrefTokens.includes(HH_MEN_ONLY)   && cGender && cGender !== 'Man')   return false;
  if (cPrefTokens.includes(HH_WOMEN_ONLY)  && myGender && myGender !== 'Woman') return false;
  if (cPrefTokens.includes(HH_MEN_ONLY)    && myGender && myGender !== 'Man')   return false;

  return true;
}

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
 
    // Pets (S166) — parsed from the onboarding pets chips (e.g. "🐱 I have
    // a cat, 🐾 Love all pets"). See scorePets() below for the conflict-
    const petsScore = scorePets(myProfile.pets, c.pets, WEIGHTS.pets);
    if (petsScore >= WEIGHTS.pets * 0.9) reasons.push('pets');
    score += petsScore;
 
    // Kitchen habits (S165) — chip-based multi-select from onboarding (e.g.
    // "🍳 Cook most nights — clean as I go, 🍱 Happy with leftovers"). See
    // scoreKitchen() below for the overlap/tension logic.
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

  // ── 0. Gender-compatible subset (S167) ─────────────────────────────────
  // `candidates` here is the completeness-filtered pool BEFORE the gender
  // hard-filter (api/matches.js passes it in that way deliberately, so the
  // gender-relaxation block below can measure the unlock). Every other
  // near-miss type (suburb/budget/accommodation) should only ever count
  // gender-compatible candidates as "current" or "relaxed" — those
  // relaxations aren't meant to also relax gender.
  const genderCandidates = candidates.filter(c => isGenderCompatible(myProfile, c));
 
  // ── 1. Suburb relaxation ──────────────────────────────────────────────────
  if (myProfile.suburb_preferences && myProfile.suburb_preferences.length > 0) {
    const relaxedProfile = { ...myProfile, suburb_preferences: [] };
    const relaxedMatches = genderCandidates
      .map(c => scoreCandidate(c, relaxedProfile, city))
      .filter(c => c.match_score >= 50);
 
    const currentMatches = genderCandidates
      .map(c => scoreCandidate(c, myProfile, city))
      .filter(c => c.match_score >= 50);
 
    const unlock = relaxedMatches.length - currentMatches.length;
 
    if (unlock >= MIN_UNLOCK) {
      const nearMissCandidates = genderCandidates.filter(c => {
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
    const relaxedMatches = genderCandidates
      .map(c => scoreCandidate(c, relaxedProfile, city))
      .filter(c => c.match_score >= 50);
 
    const currentMatches = genderCandidates
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
      const relaxedMatches = genderCandidates
        .map(c => scoreCandidate(c, relaxedProfile, city))
        .filter(c => c.match_score >= 50);
 
      const currentMatches = genderCandidates
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
 
  // ── 4. Gender preference relaxation (S167) ────────────────────────────────
  // Uses the full pre-gender-filter `candidates` pool (not genderCandidates)
  // for the relaxed side, since this is specifically measuring what the
  // gender filter itself is excluding.
  const myHhPrefTokens = (myProfile.household_gender_pref || '').split(', ').filter(Boolean);
  const hasGenderRestriction = myHhPrefTokens.includes(HH_WOMEN_ONLY) || myHhPrefTokens.includes(HH_MEN_ONLY);
  if (hasGenderRestriction) {
    const currentMatches = genderCandidates
      .map(c => scoreCandidate(c, myProfile, city))
      .filter(c => c.match_score >= 50);

    const relaxedMatches = candidates
      .map(c => scoreCandidate(c, myProfile, city))
      .filter(c => c.match_score >= 50);

    const unlock = relaxedMatches.length - currentMatches.length;

    if (unlock >= MIN_UNLOCK) {
      const genderLabel = myHhPrefTokens.includes(HH_WOMEN_ONLY) ? 'women-only' : 'men-only';
      results.push({
        constraint: 'gender',
        unlock,
        label:      'gender preference',
        suggestion: `Found ${currentMatches.length} ${genderLabel} matches — but ${unlock} more if you'd consider mixed households`,
        current_count: currentMatches.length,
      });
    }
  }

  // ── 5. Break lease listings ───────────────────────────────────────────────
  // Placeholder — will be meaningful once lease_listings table is populated
 
  results.sort((a, b) => b.unlock - a.unlock);
 
  // ── 6. Profile completeness (S81) ─────────────────────────────────────────
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
 
// ── Pets (S166) ───────────────────────────────────────────────────────────
// pets is stored as a space-joined string of fixed emoji tokens from the
// vibe quiz multi-emoji question — e.g. "🐱 🐾" or "🚫🐶" or "No preference".
// This is a closed vocabulary (unlike kitchen_habits), so real conflict
// detection is possible: a dealbreaker against a pet (or general aversion)
// the other person actually has is scored as a hard conflict.
//
// S166: rewritten for the consolidated 9-option chip set (moved from the
// vibe quiz to onboarding — see index.html "Pets" step). Matching is done
// on exact full chip-label strings (after splitting on ', '), not emoji
// substrings — several labels share an emoji as a prefix (e.g. "🚫🐱
// Allergic to cats" contains the bare 🐱 glyph as a substring), so a plain
// .includes() check on emoji alone would misfire. Exact array membership
// on the full label avoids that entirely.
const PET_CAT          = '🐱 I have a cat';
const PET_DOG          = '🐶 I have a dog';
const PET_BIRD         = '🐦 I have a bird';
const PET_FISH         = '🐠 I have fish';
const PET_LOVE_ALL     = '🐾 Love all pets';
const PET_ALLERGIC_CAT = '🚫🐱 Allergic to cats';
const PET_NO_DOG       = '🚫🐶 No dogs please';
const PET_NONE         = '🙅 No pets at all';
const PET_HAPPY_ANY    = '✅ Happy with any pet';
 
const PET_HAS_TOKENS = [PET_CAT, PET_DOG, PET_BIRD, PET_FISH, PET_LOVE_ALL];
 
function scorePets(myPets, candPets, weight) {
  if (!myPets || !candPets) return weight * 0.6;
 
  const myTokens = myPets.split(', ').filter(Boolean);
  const cTokens  = candPets.split(', ').filter(Boolean);
 
  const myHasAnyPet = myTokens.some(t => PET_HAS_TOKENS.includes(t));
  const cHasAnyPet  = cTokens.some(t => PET_HAS_TOKENS.includes(t));
 
  // Hard conflicts — general aversion or a specific-animal dealbreaker
  // against a pet (or "loves all pets") the other person actually has.
  if ((myTokens.includes(PET_NONE) && cHasAnyPet) ||
      (cTokens.includes(PET_NONE) && myHasAnyPet)) {
    return 0;
  }
  if ((myTokens.includes(PET_ALLERGIC_CAT) && (cTokens.includes(PET_CAT) || cTokens.includes(PET_LOVE_ALL))) ||
      (cTokens.includes(PET_ALLERGIC_CAT) && (myTokens.includes(PET_CAT) || myTokens.includes(PET_LOVE_ALL)))) {
    return 0;
  }
  if ((myTokens.includes(PET_NO_DOG) && (cTokens.includes(PET_DOG) || cTokens.includes(PET_LOVE_ALL))) ||
      (cTokens.includes(PET_NO_DOG) && (myTokens.includes(PET_DOG) || myTokens.includes(PET_LOVE_ALL)))) {
    return 0;
  }
 
  // Shared specific pet or shared "loves all pets" — strong match.
  const sharedPositive = myTokens.some(t => PET_HAS_TOKENS.includes(t) && cTokens.includes(t));
  if (sharedPositive) return weight;
 
  // Either side is genuinely flexible about it, and no conflict was found
  // above — high compatibility even without an exact shared pet type.
  if (myTokens.includes(PET_HAPPY_ANY) || cTokens.includes(PET_HAPPY_ANY)) {
    return weight * 0.9;
  }
 
  if (!myHasAnyPet && !cHasAnyPet) return weight * 0.8; // both pet-free — low friction
  return weight * 0.6; // one has pets, other has no stated objection — moderate, neutral credit
}
 
// ── Kitchen habits (S165) ──────────────────────────────────────────────────
// kitchen_habits is now a fixed chip vocabulary, comma-joined from the
// onboarding "Kitchen habits" multi-select — e.g. "🍳 Cook most nights —
// clean as I go, 🍱 Happy with leftovers". Same closed-vocabulary treatment
// as pets: real overlap scoring instead of the old free-text heuristic
// (which is now retired — kitchen_habits stopped being written from vibe-quiz
// free text as of S165, see dashboard vibeSave()).
const KITCHEN_TENSION_PAIRS = [
  ['🍳 Cook most nights — clean as I go', '🥡 Mostly takeaway / meal prep'],
];
 
function scoreKitchen(myKitchen, candKitchen, weight) {
  if (!myKitchen || !candKitchen) return weight * 0.6;
 
  const myTokens = myKitchen.split(', ').filter(Boolean);
  const cTokens  = candKitchen.split(', ').filter(Boolean);
 
  const shared = myTokens.some(t => cTokens.includes(t));
  if (shared) return weight;
 
  // Mild tension (different cooking rhythms) rather than a hard conflict —
  // this isn't a dealbreaker the way an allergy is, just a lower-confidence
  // pairing worth scoring a bit below the neutral "no data either way" case.
  const tense = KITCHEN_TENSION_PAIRS.some(([a, b]) =>
    (myTokens.includes(a) && cTokens.includes(b)) ||
    (myTokens.includes(b) && cTokens.includes(a))
  );
  if (tense) return weight * 0.4;
 
  return weight * 0.6; // both answered, no overlap, no known tension — neutral
}
 
module.exports = {
  scoreCandidate,
  computeNearMisses,
  isAdjacentSleep,
  isAdjacentClean,
  activityBoost,
  scorePets,
  scoreKitchen,
  isGenderCompatible,
  WEIGHTS,
};
 
