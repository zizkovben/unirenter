// api/calendar/add.js
// Creates a calendar event for a student.
// Called via POST /api/calendar/add from dashboard Quick Add strip or Cob date detection.
// Spec locked in bible V127 — calendar_event schema.
// Auth: email from body — matched against profiles for basic ownership check.
// Uses SUPABASE_SERVICE_ROLE_KEY (server-side only).

const VALID_CATEGORIES = ['housing', 'uni', 'work', 'social', 'other'];
const VALID_SOURCES    = ['todo', 'lease_companion', 'matching', 'cob_chat', 'household', 'lease_transfer'];

// Sub-types per category — used for default title generation if title is omitted
const DEFAULT_SUBTYPES = {
  housing: ['Inspection', 'Lease renewal', 'Bond claim', 'Move-out notice', 'Other'],
  uni:     ['Assignment due', 'Exam', 'Enrolment deadline', 'Timetable change', 'Other'],
  work:    ['Shift start', 'Pay day', 'Meeting', 'Roster change', 'Other'],
  social:  ['Event', 'Moving with friends', 'Housemate meetup', 'Other'],
  other:   ['General reminder', 'Other'],
};

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

  try {
    const body = req.body || {};

    const {
      email,
      title,
      category,
      sub_type,
      date,
      reminder_date,
      source,
      notes,
      editable,
    } = body;

    // ── Validation ─────────────────────────────────────────────────────────────

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'category must be one of: ' + VALID_CATEGORIES.join(', ') });
    }

    if (!date || isNaN(new Date(date).getTime())) {
      return res.status(400).json({ error: 'Valid date is required (ISO format)' });
    }

    if (!source || !VALID_SOURCES.includes(source)) {
      return res.status(400).json({ error: 'source must be one of: ' + VALID_SOURCES.join(', ') });
    }

    if (reminder_date && isNaN(new Date(reminder_date).getTime())) {
      return res.status(400).json({ error: 'reminder_date must be a valid date if provided' });
    }

    if (notes && typeof notes === 'string' && notes.length > 500) {
      return res.status(400).json({ error: 'notes must be 500 characters or fewer' });
    }

    // ── Validate sub_type against category if provided ──────────────────────
    if (sub_type) {
      const validSubs = DEFAULT_SUBTYPES[category] || [];
      if (!validSubs.includes(sub_type)) {
        // Non-fatal: just clear it so we don't store garbage
        // (Cob may send free-form sub_types in future)
      }
    }

    // ── Build title — minimum viable: category + date if no title sent ───────
    let resolvedTitle = (title && typeof title === 'string') ? title.trim().slice(0, 200) : '';
    if (!resolvedTitle) {
      if (sub_type && sub_type !== 'Other') {
        resolvedTitle = sub_type;
      } else {
        const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
        const dateLabel = new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
        resolvedTitle = catLabel + ' reminder — ' + dateLabel;
      }
    }

    // ── Verify profile exists (lightweight ownership check) ────────────────
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email.toLowerCase().trim())}&select=email`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );
    const profileData = await profileRes.json();
    if (!Array.isArray(profileData) || profileData.length === 0) {
      return res.status(403).json({ error: 'No profile found for this email' });
    }

    // ── Insert calendar event ───────────────────────────────────────────────
    const eventPayload = {
      user_email:    email.toLowerCase().trim(),
      title:         resolvedTitle,
      category,
      date,
      source,
      status:        'pending',
      editable:      editable !== false, // default true unless explicitly false
      created_at:    new Date().toISOString(),
    };

    if (sub_type)      eventPayload.sub_type      = sub_type;
    if (reminder_date) eventPayload.reminder_date  = reminder_date;
    if (notes)         eventPayload.notes          = notes.trim().slice(0, 500);

    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/calendar_events`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=representation',
        },
        body: JSON.stringify(eventPayload),
      }
    );

    const inserted = await insertRes.json();

    if (!insertRes.ok) {
      console.error('[calendar/add] Supabase insert error:', inserted);
      // Surface a clean message if the table doesn't exist yet
      const detail = Array.isArray(inserted) ? inserted : inserted;
      const msg = (detail && detail.message) ? detail.message : JSON.stringify(detail);
      if (msg && msg.includes('does not exist')) {
        return res.status(500).json({
          error: 'calendar_events table not yet created in Supabase. Run the SQL from the bible first.',
          detail: msg,
        });
      }
      return res.status(500).json({ error: 'Could not save event', detail: msg });
    }

    const event = Array.isArray(inserted) ? inserted[0] : inserted;

    return res.status(200).json({ success: true, event });

  } catch (err) {
    console.error('[calendar/add] error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
