// api/matches.js
// Returns scored, ranked housemate matches for a given user.
// Called via POST /api/matches from index.html (and future sydney/brisbane pages)
// Body: { email, city } — returns top 10 compatible profiles

export default async function handler(req, res) {
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
    // Same city, active, exclude the requesting user, limit 100 for scoring
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
      return res.status(200).json({ matches: [], total: 0, note: 'No profiles found yet' });
    }

    // ── Score each candidate ─────────────────────────────────────────────────
    const scored = candidates.map(c => {
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

        // Household type compatibility (10 points)
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
        // No user profile — return candidates with base scores (profile completeness)
        score = c.profile_complete || 50;
      }

      // Boost verified profiles
      if (c.email_verified) score += 5;
      if (c.uni_email_verified) score += 5;

      // Cap at 100
      score = Math.min(100, score);

      return {
        id:              c.id,
        display_name:    c.display_name || 'Student',
        university:      c.university || null,
        student_status:  c.student_status || null,
        year_of_study:   c.year_of_study || null,
        field_of_study:  c.field_of_study || null,
        city:            c.city || city,
        suburb_preferences: c.suburb_preferences || [],
        budget_min:      c.budget_min || null,
        budget_max:      c.budget_max || null,
        sleep_schedule:  c.sleep_schedule || null,
        cleanliness:     c.cleanliness || null,
        household_type:  c.household_type || null,
        seeking:         c.seeking || null,
        pets:            c.pets || null,
        dietary:         c.dietary || null,
        guests:          c.guests || null,
        substances:      c.substances || null,
        email_verified:  c.email_verified || false,
        uni_email_verified: c.uni_email_verified || false,
        profile_complete: c.profile_complete || 0,
        match_score:     score,
        match_reasons:   reasons,
      };
    });

    // ── Sort by score descending, return top 10 ──────────────────────────────
    const top = scored
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 10);

    return res.status(200).json({
      matches: top,
      total:   candidates.length,
      city,
    });

  } catch (err) {
    console.error('api/matches error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
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
