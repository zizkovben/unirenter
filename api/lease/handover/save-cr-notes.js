// POST /api/lease/handover/save-cr-notes
// Saves Cob-guided condition report walkthrough notes to lease_handover.
// Appends to the cr_notes JSONB column — one entry per room/question answered.
//
// Body (JSON):
//   listing_ref   — e.g. "MEL-2847"
//   email         — incoming tenant email (verified via lease_interest table)
//   notes         — array of { room, question, answer } objects
//
// The column cr_notes is a JSONB array. This route APPENDS new notes to existing ones.
// Idempotent on exact {room, question} duplicates — replaces rather than double-appends.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listing_ref, email, notes } = req.body || {};

  if (!listing_ref || !email || !Array.isArray(notes) || notes.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: listing_ref, email, notes[]' });
  }

  const ref  = listing_ref.trim().toUpperCase();
  const addr = email.trim().toLowerCase();

  // Validate each note object
  for (const note of notes) {
    if (!note.room || !note.question || !note.answer) {
      return res.status(400).json({ error: 'Each note must have room, question, and answer' });
    }
    if (typeof note.room !== 'string' || typeof note.question !== 'string' || typeof note.answer !== 'string') {
      return res.status(400).json({ error: 'note fields must be strings' });
    }
    if (note.answer.length > 2000) {
      return res.status(400).json({ error: 'Answer too long (max 2000 chars)' });
    }
  }

  // Verify caller is an interested party (in lease_interest for this listing)
  const { data: interest } = await supabase
    .from('lease_interest')
    .select('id')
    .eq('listing_ref', ref)
    .eq('incoming_email', addr)
    .maybeSingle();

  // Also allow if they are the outgoing tenant (listing poster)
  const { data: listing } = await supabase
    .from('lease_listings')
    .select('id, email')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const isOutgoing = listing.email.toLowerCase() === addr;
  if (!interest && !isOutgoing) {
    return res.status(403).json({ error: 'Only an interested party can save condition report notes' });
  }

  // Fetch current handover row
  const { data: handover } = await supabase
    .from('lease_handover')
    .select('id, cr_notes')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (!handover) {
    return res.status(404).json({ error: 'Handover record not found. Express interest first.' });
  }

  // Merge notes — replace existing {room, question} pairs, append new ones
  const existing = Array.isArray(handover.cr_notes) ? handover.cr_notes : [];
  const merged = [...existing];

  for (const note of notes) {
    const idx = merged.findIndex(n => n.room === note.room && n.question === note.question);
    const entry = {
      room:       note.room.trim(),
      question:   note.question.trim(),
      answer:     note.answer.trim(),
      saved_at:   new Date().toISOString()
    };
    if (idx >= 0) {
      merged[idx] = entry;
    } else {
      merged.push(entry);
    }
  }

  const { error: updateErr } = await supabase
    .from('lease_handover')
    .update({ cr_notes: merged, updated_at: new Date().toISOString() })
    .eq('listing_ref', ref);

  if (updateErr) {
    console.error('save-cr-notes update error:', updateErr);
    return res.status(500).json({ error: 'Failed to save notes' });
  }

  return res.status(200).json({
    success:    true,
    listing_ref: ref,
    notes_saved: notes.length,
    total_notes: merged.length
  });
};
