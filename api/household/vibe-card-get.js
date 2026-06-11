'use strict';
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ ok: false, error: 'token required' });

  // Fetch the listing card
  const { data: card, error: cardErr } = await supabase
    .from('listing_cards')
    .select('token, card_type, data, created_by, expires_at')
    .eq('token', token)
    .eq('card_type', 'vibe_individual')
    .single();

  if (cardErr || !card) {
    return res.status(404).json({ ok: false, error: 'Card not found' });
  }

  // Check expiry
  if (card.expires_at && new Date(card.expires_at) < new Date()) {
    return res.status(410).json({ ok: false, error: 'Card has expired' });
  }

  // Optionally fetch review summary for this user if they have a household
  // Find household membership for card owner
  let reviewSummary = null;
  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('email', card.created_by)
    .limit(1)
    .single();

  if (membership) {
    // Try to get review summary — if not enough reviews, return partial
    const { data: reviews } = await supabase
      .from('flatmate_reviews')
      .select('responses')
      .eq('household_id', membership.household_id)
      .eq('subject_email', card.created_by);

    const count = (reviews || []).length;

    if (count >= 2) {
      // Build summary inline (same logic as review-summary.js)
      reviewSummary = buildReviewSummary(reviews, count);
    }
  }

  return res.status(200).json({
    ok: true,
    card: card.data,
    review_summary: reviewSummary
  });
};

function buildReviewSummary(reviews, count) {
  var scaleKeys = ['q1_social', 'q2_shared_spaces', 'q3_sleep', 'q4_tension'];
  var scaleSums = { q1_social: 0, q2_shared_spaces: 0, q3_sleep: 0, q4_tension: 0 };
  var choiceCounts = { q5_weeknight: {}, q6_friday: {} };
  var freeTextQ7 = [];
  var freeTextQ8 = [];

  reviews.forEach(function(r) {
    var resp = r.responses || {};
    scaleKeys.forEach(function(k) {
      var v = parseFloat(resp[k]);
      if (!isNaN(v)) scaleSums[k] += v;
    });
    ['q5_weeknight', 'q6_friday'].forEach(function(k) {
      var v = resp[k];
      if (v) choiceCounts[k][v] = (choiceCounts[k][v] || 0) + 1;
    });
    if (count >= 3) {
      if (resp.q7_best && resp.q7_best.trim()) freeTextQ7.push(resp.q7_best.trim());
      if (resp.q8_improve && resp.q8_improve.trim()) freeTextQ8.push(resp.q8_improve.trim());
    }
  });

  var scaleAverages = {};
  scaleKeys.forEach(function(k) {
    scaleAverages[k] = Math.round((scaleSums[k] / count) * 10) / 10;
  });

  function topChoice(counts) {
    var best = null; var bestCount = 0;
    Object.keys(counts).forEach(function(k) {
      if (counts[k] > bestCount) { best = k; bestCount = counts[k]; }
    });
    return best;
  }

  var topWeeknight = topChoice(choiceCounts.q5_weeknight);
  var topFriday = topChoice(choiceCounts.q6_friday);

  var parts = [];
  var social = scaleAverages.q1_social;
  if (social >= 4) parts.push('your flatmates reckon you\'re social and love having people around');
  else if (social >= 3) parts.push('your flatmates see you as friendly but also know when to give everyone space');
  else parts.push('your flatmates say you\'re pretty private at home');

  var tidy = scaleAverages.q2_shared_spaces;
  if (tidy >= 4) parts.push('you take shared spaces seriously');
  else if (tidy >= 3) parts.push('you\'re reasonable about shared spaces');
  else parts.push('you\'re pretty relaxed about shared spaces');

  var sleep = scaleAverages.q3_sleep;
  if (sleep >= 4) parts.push('they\'d call you a night owl');
  else if (sleep <= 2) parts.push('you\'re known as an early riser');

  if (topWeeknight) {
    var wn = { studying: 'weeknights are for studying', socialising: 'weeknight nights you\'re up for socialising', gaming: 'weeknights you\'re usually gaming', cooking: 'you\'re often cooking on weeknights', quiet: 'weeknights are quiet time for you' }[topWeeknight];
    if (wn) parts.push(wn);
  }
  if (topFriday) {
    var fr = { home: 'Fridays you\'re typically at home', out_sometimes: 'Fridays you\'re up for going out sometimes', always_out: 'Fridays you\'re almost always out' }[topFriday];
    if (fr) parts.push(fr);
  }

  var sentence = parts.length > 0
    ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? ' — ' + parts.slice(1).join(', ') : '') + '. 🤠'
    : 'Good feedback from flatmates. 🤠';

  return {
    enough: true,
    count: count,
    scale_averages: scaleAverages,
    top_weeknight: topWeeknight,
    top_friday: topFriday,
    free_text_q7: freeTextQ7,
    free_text_q8: freeTextQ8,
    cob_summary: sentence
  };
}
