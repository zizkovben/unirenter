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
//
// S163: scoring logic (scoreCandidate/computeNearMisses/etc.) extracted to api/_lib/match-score.js.
// This file is now handler-only — it fetches profiles from Supabase and delegates scoring.

const { scoreCandidate, computeNearMisses } = require('./_lib/match-score');

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
    // S128: also exclude by id in case email lookup differs
    if (myProfile && myProfile.id) {
      url += `&id=neq.${encodeURIComponent(myProfile.id)}`;
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

    // S128: safety filter — never return requester's own profile
    const safeTop = top.filter(p => {
      if (email && p.email === email) return false;
      if (myProfile && myProfile.id && p.id === myProfile.id) return false;
      return true;
    });

    // ── S152: household membership flag — best-effort, non-fatal ────────────
    // Only checked for the emails actually being returned (not the full candidate
    // pool) to keep this cheap. Exposes only a boolean — never which household
    // or any of its private details (lease dates, calendar, etc.) to a viewer
    // who isn't a member of it.
    try {
      const topEmails = safeTop.map(p => p.email).filter(Boolean);
      if (topEmails.length > 0) {
        const emailList = topEmails.map(e => encodeURIComponent(e)).join(',');
        const hmRes = await fetch(
          `${supabaseUrl}/rest/v1/household_members?select=email&email=in.(${emailList})`,
          { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const hmRows = await hmRes.json();
        if (Array.isArray(hmRows)) {
          const inHouseholdSet = new Set(hmRows.map(r => (r.email || '').toLowerCase()));
          safeTop.forEach(p => {
            p.in_household = !!(p.email && inHouseholdSet.has(p.email.toLowerCase()));
          });
        }
      }
    } catch (hmErr) {
      console.warn('household membership check failed (non-fatal):', hmErr.message);
    }
    safeTop.forEach(p => { if (p.in_household === undefined) p.in_household = false; });

    return res.status(200).json({
      matches:     safeTop,
      near_misses,
      total:       candidates.length,
      city,
    });

  } catch (err) {
    console.error('api/matches error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
