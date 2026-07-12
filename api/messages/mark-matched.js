// api/messages/mark-matched.js — POST /api/messages/mark-matched
// S180-ish: self-reported "Mark as matched" confirmation, triggered from a
// button in the conversation header. Either participant can confirm — first
// click wins (idempotent), the button then shows as confirmed to both.
//
// On first confirmation for a pair:
//   1. Writes matched_confirmed_at to message_threads (read by
//      api/admin/stats.js for the "Successful matches" count, and by
//      api/messages/get.js so the dashboard shows correct button state).
//   2. Computes a compatibility score via the same scoreCandidate() used
//      for real matches, so the email content is consistent with what the
//      student actually saw on their match card.
//   3. Caches matched_partner_email/name/uni/score on each participant's
//      own profile row — the day-7 / day-14 follow-up emails fire later,
//      with no session context, and need this without re-looking it up.
//   4. Fires Email 1 (api/email/post-match.js, previously built but never
//      triggered anywhere) for BOTH participants, each personalised from
//      their own side.
//
// POST body: { email, partner_email }
const { createClient } = require('@supabase/supabase-js');
const { scoreCandidate } = require('../_lib/match-score');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SITE_URL = 'https://www.unirenter.com.au';

function firstName(profile) {
  const raw = (profile && (profile.display_name || profile.first_name)) || '';
  return (raw.split(' ')[0] || '').trim();
}

async function sendEmail1(recipientEmail, matchName, matchUni, score, suburb) {
  try {
    await fetch(SITE_URL + '/api/email/post-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: recipientEmail,
        match_name: matchName,
        match_uni: matchUni,
        score: score,
        suburb: suburb,
        email_number: 1,
      }),
    });
  } catch (err) {
    // Non-fatal — email is a nice-to-have on top of the confirmation itself,
    // the confirmation (and stats count) should still succeed either way.
    console.warn('[mark-matched] Email 1 send failed for', recipientEmail, err.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    const partnerEmail = (body.partner_email || '').trim().toLowerCase();

    if (!email || !partnerEmail || email === partnerEmail) {
      return res.status(400).json({ ok: false, error: 'email and partner_email required' });
    }

    const [participant_a, participant_b] = [email, partnerEmail].sort();

    // Idempotent — if already confirmed, just report back the existing state
    // rather than re-triggering emails on every click.
    const { data: existing } = await supabase
      .from('message_threads')
      .select('matched_confirmed_at')
      .eq('participant_a', participant_a)
      .eq('participant_b', participant_b)
      .maybeSingle();

    if (existing && existing.matched_confirmed_at) {
      return res.status(200).json({ ok: true, already_matched: true, matched_confirmed_at: existing.matched_confirmed_at });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
      .from('message_threads')
      .update({ matched_confirmed_at: nowIso, matched_confirmed_by: email })
      .eq('participant_a', participant_a)
      .eq('participant_b', participant_b)
      .select('participant_a');

    if (updateErr) {
      console.error('[mark-matched] Supabase update error:', updateErr);
      return res.status(500).json({ ok: false, error: 'Could not save' });
    }
    if (!updated || updated.length === 0) {
      // No message_threads row yet (rare race — pair hasn't synced via
      // messages/get.js's write-through yet). Don't fail the click; just
      // ask the client to retry shortly rather than silently no-op.
      return res.status(409).json({ ok: false, error: 'Conversation not ready yet — try again in a moment' });
    }

    // Fetch both profiles for scoring + email personalisation.
    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('*')
      .in('email', [email, partnerEmail]);

    if (profilesErr || !profiles || profiles.length < 2) {
      // Confirmation is already saved — degrade gracefully rather than
      // erroring the whole request over the email/scoring nice-to-have.
      return res.status(200).json({ ok: true, already_matched: false, matched_confirmed_at: nowIso, emails_sent: false });
    }

    const myProfile = profiles.find(p => (p.email || '').toLowerCase() === email);
    const theirProfile = profiles.find(p => (p.email || '').toLowerCase() === partnerEmail);
    const city = (myProfile && myProfile.city) || (theirProfile && theirProfile.city) || 'melbourne';

    let score = null;
    try {
      const result = scoreCandidate(theirProfile, myProfile, city);
      score = result && typeof result.match_score === 'number' ? result.match_score : null;
    } catch (scoreErr) {
      console.warn('[mark-matched] scoreCandidate failed (non-fatal):', scoreErr.message);
    }

    const mySuburb = (myProfile && myProfile.suburb_preferences && myProfile.suburb_preferences[0]) || '';
    const theirSuburb = (theirProfile && theirProfile.suburb_preferences && theirProfile.suburb_preferences[0]) || '';

    // Cache each side's view of the match on their own profile row —
    // Email 2/3's lazy-check needs this later without re-fetching.
    // (match_email_2_due_at itself is set by post-match.js's own Email 1
    // success branch, triggered just below — not duplicated here.)
    await Promise.all([
      supabase.from('profiles').update({
        matched_partner_email: partnerEmail,
        matched_partner_name:  firstName(theirProfile) || 'your match',
        matched_partner_uni:   theirProfile.university || null,
        matched_score:         score,
      }).eq('email', email),
      supabase.from('profiles').update({
        matched_partner_email: email,
        matched_partner_name:  firstName(myProfile) || 'your match',
        matched_partner_uni:   myProfile.university || null,
        matched_score:         score,
      }).eq('email', partnerEmail),
    ]).catch(err => console.warn('[mark-matched] partner-cache update failed (non-fatal):', err.message));

    // Fire Email 1 for both sides in parallel — each personalised from
    // their own perspective. Non-fatal if either fails (logged, not thrown).
    await Promise.all([
      sendEmail1(email, firstName(theirProfile) || 'your match', theirProfile.university || 'their uni', score != null ? score : '—', mySuburb),
      sendEmail1(partnerEmail, firstName(myProfile) || 'your match', myProfile.university || 'their uni', score != null ? score : '—', theirSuburb),
    ]);

    return res.status(200).json({ ok: true, already_matched: false, matched_confirmed_at: nowIso, score, emails_sent: true });

  } catch (err) {
    console.error('[mark-matched] Unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
