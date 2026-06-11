'use strict';
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { reviewer_email, subject_email, household_id, responses } = req.body || {};

  if (!reviewer_email || !subject_email || !household_id || !responses) {
    return res.status(400).json({ ok: false, error: 'reviewer_email, subject_email, household_id and responses required' });
  }

  if (reviewer_email === subject_email) {
    return res.status(400).json({ ok: false, error: 'Cannot review yourself' });
  }

  // Verify both parties are verified profiles and members of the household
  const { data: members, error: membErr } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household_id);

  if (membErr || !members) {
    return res.status(404).json({ ok: false, error: 'Household not found' });
  }

  const memberEmails = members.map(function(m) { return m.email; });

  if (!memberEmails.includes(reviewer_email)) {
    return res.status(403).json({ ok: false, error: 'Reviewer is not a member of this household' });
  }
  if (!memberEmails.includes(subject_email)) {
    return res.status(403).json({ ok: false, error: 'Subject is not a member of this household' });
  }

  // Hash reviewer identity — one-way, never recoverable
  const reviewerHash = crypto
    .createHmac('sha256', household_id)
    .update(reviewer_email)
    .digest('hex');

  // Check for existing review from this reviewer hash for this subject in this household
  const { data: existingReview } = await supabase
    .from('flatmate_reviews')
    .select('id')
    .eq('household_id', household_id)
    .eq('reviewer_hash', reviewerHash)
    .eq('subject_email', subject_email)
    .limit(1)
    .single();

  if (existingReview) {
    // Update existing review (allow one re-review per cycle)
    const { error: updateErr } = await supabase
      .from('flatmate_reviews')
      .update({ responses: responses })
      .eq('id', existingReview.id);

    if (updateErr) return res.status(500).json({ ok: false, error: 'Could not update review' });
    return res.status(200).json({ ok: true, updated: true });
  }

  // Insert new review
  const { error: insertErr } = await supabase
    .from('flatmate_reviews')
    .insert({
      household_id: household_id,
      reviewer_hash: reviewerHash,
      subject_email: subject_email,
      responses: responses
    });

  if (insertErr) {
    return res.status(500).json({ ok: false, error: 'Could not save review' });
  }

  return res.status(200).json({ ok: true, updated: false });
};
