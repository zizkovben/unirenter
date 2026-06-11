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

  const { household_id, subject_email } = req.query || {};

  if (!household_id || !subject_email) {
    return res.status(400).json({ ok: false, error: 'household_id and subject_email required' });
  }

  // Verify subject is a member of the household
  const { data: membership } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household_id)
    .eq('email', subject_email)
    .limit(1)
    .single();

  if (!membership) {
    return res.status(403).json({ ok: false, error: 'Subject is not a member of this household' });
  }

  // Fetch all reviews for this subject in this household
  const { data: reviews, error: revErr } = await supabase
    .from('flatmate_reviews')
    .select('responses, created_at')
    .eq('household_id', household_id)
    .eq('subject_email', subject_email);

  if (revErr) {
    return res.status(500).json({ ok: false, error: 'Could not fetch reviews' });
  }

  const count = (reviews || []).length;

  // Minimum 2 reviews before revealing summary
  if (count < 2) {
    return res.status(200).json({
      ok: true,
      count: count,
      enough: false,
      message: count === 0
        ? 'No reviews yet — flatmates can review you once you\'ve all been in the household a while.'
        : 'One review so far — need at least 2 before Cob can show a summary. Ask another flatmate to leave one!'
    });
  }

  // Aggregate scale questions (Q1–Q4, 1–5 scale)
  var scaleKeys = ['q1_social', 'q2_shared_spaces', 'q3_sleep', 'q4_tension'];
  var scaleSums = { q1_social: 0, q2_shared_spaces: 0, q3_sleep: 0, q4_tension: 0 };
  var scaleLabels = {
    q1_social:        'How social at home',
    q2_shared_spaces: 'Shared space habits',
    q3_sleep:         'Sleep schedule',
    q4_tension:       'Handles tension'
  };

  // Aggregate choice questions (Q5–Q6)
  var choiceCounts = {
    q5_weeknight: {},
    q6_friday:    {}
  };

  // Collect free text (Q7–Q8) — only if ≥3 reviews
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
      if (v) {
        choiceCounts[k][v] = (choiceCounts[k][v] || 0) + 1;
      }
    });

    if (count >= 3) {
      if (resp.q7_best && resp.q7_best.trim()) freeTextQ7.push(resp.q7_best.trim());
      if (resp.q8_improve && resp.q8_improve.trim()) freeTextQ8.push(resp.q8_improve.trim());
    }
  });

  // Compute averages
  var scaleAverages = {};
  scaleKeys.forEach(function(k) {
    scaleAverages[k] = Math.round((scaleSums[k] / count) * 10) / 10;
  });

  // Top choice per question
  function topChoice(counts) {
    var best = null; var bestCount = 0;
    Object.keys(counts).forEach(function(k) {
      if (counts[k] > bestCount) { best = k; bestCount = counts[k]; }
    });
    return best;
  }

  var topWeeknight = topChoice(choiceCounts.q5_weeknight);
  var topFriday    = topChoice(choiceCounts.q6_friday);

  // Build Cob narrative summary
  var summary = buildCobSummary(scaleAverages, topWeeknight, topFriday, count);

  return res.status(200).json({
    ok: true,
    count: count,
    enough: true,
    scale_averages: scaleAverages,
    scale_labels: scaleLabels,
    top_weeknight: topWeeknight,
    top_friday: topFriday,
    free_text_q7: freeTextQ7,
    free_text_q8: freeTextQ8,
    cob_summary: summary
  });
};

function buildCobSummary(avgs, weeknight, friday, count) {
  var parts = [];

  // Social dimension (Q1: 1=very private, 5=very social)
  var social = avgs.q1_social;
  if (social >= 4) parts.push('your flatmates reckon you\'re social and love having people around');
  else if (social >= 3) parts.push('your flatmates see you as friendly but also know when to give everyone space');
  else parts.push('your flatmates say you\'re pretty private at home — the kind who keeps to yourself');

  // Shared spaces (Q2: 1=very relaxed, 5=very tidy)
  var tidy = avgs.q2_shared_spaces;
  if (tidy >= 4) parts.push('you take shared spaces seriously');
  else if (tidy >= 3) parts.push('you\'re reasonable about shared spaces');
  else parts.push('you\'re pretty relaxed about shared spaces');

  // Sleep (Q3: 1=very early riser, 5=very night owl)
  var sleep = avgs.q3_sleep;
  if (sleep >= 4) parts.push('they\'d call you a night owl');
  else if (sleep <= 2) parts.push('you\'re known as an early riser');

  // Weeknight vibe
  if (weeknight) {
    var wn = {
      studying: 'weeknights are for studying',
      socialising: 'weeknight nights you\'re up for socialising',
      gaming: 'weeknights you\'re usually gaming',
      cooking: 'you\'re often cooking on weeknights',
      quiet: 'weeknights are quiet time for you'
    }[weeknight];
    if (wn) parts.push(wn);
  }

  // Friday vibe
  if (friday) {
    var fr = {
      home: 'Fridays you\'re typically at home',
      out_sometimes: 'Fridays you\'re up for going out sometimes',
      always_out: 'Fridays you\'re almost always out'
    }[friday];
    if (fr) parts.push(fr);
  }

  if (parts.length === 0) return 'Not enough data for a summary yet.';

  // Capitalise first word
  var sentence = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  if (parts.length > 1) {
    sentence += ' — ' + parts.slice(1).join(', ');
  }
  sentence += '. 🤠';

  if (count >= 5) sentence = '(' + count + ' flatmates have weighed in) ' + sentence;

  return sentence;
}
