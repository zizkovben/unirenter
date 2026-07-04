// api/household/feed-add.js — S147, Household Ecosystem Expansion step 4
// POST /api/household/feed-add
// Body: { household_id, email, type ('chat'|'note'|'todo'|'reminder'), text, event_date? }
// Adds one item to the unified household feed. Also used by the personal
// to-do list's "Share to household" button — a one-way snapshot, not a live
// sync (see project bible, Household Ecosystem Expansion §3).
// CommonJS

const { createClient } = require('@supabase/supabase-js');

const VALID_TYPES = ['chat', 'note', 'todo', 'reminder'];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { household_id, email, type, text, event_date } = req.body || {};

    if (!household_id || !email || !type || !text) {
      return res.status(400).json({ ok: false, error: 'household_id, email, type and text are required' });
    }

    if (VALID_TYPES.indexOf(type) === -1) {
      return res.status(400).json({ ok: false, error: 'type must be one of: ' + VALID_TYPES.join(', ') });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanText = String(text).trim().slice(0, 500);
    if (!cleanText) return res.status(400).json({ ok: false, error: 'text cannot be empty' });

    let cleanDate = null;
    if (event_date) {
      const d = new Date(event_date);
      if (!isNaN(d.getTime())) cleanDate = event_date;
    }

    // Verify membership
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('household_id', household_id)
      .eq('email', cleanEmail)
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ ok: false, error: 'Not a member of this household.' });
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('household_feed')
      .insert({
        household_id: household_id,
        author_email: cleanEmail,
        type: type,
        text: cleanText,
        event_date: cleanDate
      })
      .select()
      .single();

    if (insertErr) {
      console.error('household_feed insert error:', insertErr);
      const msg = insertErr.message || '';
      if (msg.includes('does not exist')) {
        return res.status(500).json({ ok: false, error: 'household_feed table not yet created in Supabase. Run migration_household_ecosystem.sql first.' });
      }
      return res.status(500).json({ ok: false, error: 'Could not post to feed.' });
    }

    return res.status(200).json({ ok: true, item: inserted });

  } catch (err) {
    console.error('household/feed-add unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};
