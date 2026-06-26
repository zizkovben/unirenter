// api/lease/update.js
// Updates a lease listing's status or editable fields.
// POST body: { email, listing_ref, action, ...fields }
//
// Actions (state machine — locked bible V127):
//   'edit'             — lister updates listing details (active state only)
//   'proceed'          — lister marks a seeker as selected (active → proceeding)
//   'book_inspection'  — inspection date agreed (proceeding → inspection_booked)
//   'extend'           — lister extends expiry by 30 days (active, timed_out, or withdrawn)
//   'pause'            — lister temporarily withdraws (active → withdrawn)
//   'reactivate'       — lister reactivates paused listing (withdrawn → active)
//
// Auth: email must match listing owner. SUPABASE_SERVICE_ROLE_KEY server-side.

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const VALID_ACTIONS = ['edit', 'proceed', 'book_inspection', 'extend', 'pause', 'reactivate'];

// State machine — which actions are valid from which statuses
const ALLOWED_FROM = {
  edit:             ['active'],
  proceed:          ['active'],
  book_inspection:  ['proceeding'],
  extend:           ['active', 'timed_out', 'withdrawn'],
  pause:            ['active', 'proceeding'],
  reactivate:       ['withdrawn'],
};

const NEXT_STATUS = {
  proceed:         'proceeding',
  book_inspection: 'inspection_booked',
  pause:           'withdrawn',
  reactivate:      'active',
};

// Editable listing fields (for 'edit' action only)
const EDITABLE_FIELDS = [
  'suburb', 'property_type', 'bedrooms', 'weekly_rent',
  'available_from', 'lease_ends', 'furnished', 'pets_allowed',
  'title', 'description',
];

const VALID_PROPERTY_TYPES = ['room', 'studio', 'apartment', 'house', 'other'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { email, listing_ref, action } = body;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!listing_ref || typeof listing_ref !== 'string') {
      return res.status(400).json({ error: 'listing_ref is required' });
    }
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'action must be one of: ' + VALID_ACTIONS.join(', ') });
    }

    // ── Fetch listing and verify ownership ───────────────────────────────────
    const { data: listing, error: fetchErr } = await supabase
      .from('lease_listings')
      .select('id, listing_ref, email, status, city, suburb, title, weekly_rent, expires_at')
      .eq('listing_ref', listing_ref.trim().toUpperCase())
      .maybeSingle();

    if (fetchErr) {
      console.error('[lease/update] fetch error:', fetchErr);
      return res.status(500).json({ error: 'Could not fetch listing' });
    }
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.email !== email.toLowerCase().trim()) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }

    // ── Check state machine ───────────────────────────────────────────────────
    const allowedStatuses = ALLOWED_FROM[action] || [];
    if (!allowedStatuses.includes(listing.status)) {
      return res.status(409).json({
        error: 'Action "' + action + '" is not valid when listing is in status "' + listing.status + '"',
        current_status: listing.status,
        allowed_from:   allowedStatuses,
      });
    }

    // ── Build update payload ──────────────────────────────────────────────────
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (NEXT_STATUS[action]) {
      updatePayload.status = NEXT_STATUS[action];
    }

    // ── Action-specific logic ─────────────────────────────────────────────────

    if (action === 'edit') {
      // Apply whitelisted editable fields from body
      for (const field of EDITABLE_FIELDS) {
        if (body[field] === undefined || body[field] === null) continue;

        if (field === 'property_type' && !VALID_PROPERTY_TYPES.includes(body[field])) {
          return res.status(400).json({ error: 'Invalid property type' });
        }
        if (field === 'weekly_rent') {
          const rent = parseInt(body[field], 10);
          if (isNaN(rent) || rent < 50 || rent > 5000) {
            return res.status(400).json({ error: 'Weekly rent must be between $50 and $5000' });
          }
          updatePayload.weekly_rent = rent;
          continue;
        }
        if (field === 'bedrooms') {
          const beds = parseInt(body[field], 10);
          if (!isNaN(beds)) updatePayload.bedrooms = beds;
          continue;
        }
        if (field === 'furnished' || field === 'pets_allowed') {
          updatePayload[field] = body[field] === true || body[field] === 'true';
          continue;
        }
        if (field === 'title') {
          const t = String(body[field]).trim();
          if (t.length < 5) return res.status(400).json({ error: 'Title must be at least 5 characters' });
          updatePayload.title = t.slice(0, 120);
          continue;
        }
        if (field === 'description') {
          updatePayload.description = String(body[field]).trim().slice(0, 1000) || null;
          continue;
        }
        updatePayload[field] = body[field];
      }
    }

    if (action === 'extend') {
      // Extend expiry by 30 days from today (or from current expiry if still in future)
      const currentExpiry = listing.expires_at ? new Date(listing.expires_at) : new Date();
      const baseDate      = currentExpiry > new Date() ? currentExpiry : new Date();
      const newExpiry     = new Date(baseDate);
      newExpiry.setDate(newExpiry.getDate() + 30);
      updatePayload.expires_at = newExpiry.toISOString();
      // If listing was timed_out or withdrawn, reactivate it
      if (listing.status === 'timed_out' || listing.status === 'withdrawn') {
        updatePayload.status = 'active';
      }
    }

    if (action === 'book_inspection') {
      // Requires inspection_date in body
      if (!body.inspection_date || isNaN(new Date(body.inspection_date).getTime())) {
        return res.status(400).json({ error: 'inspection_date is required (ISO date string)' });
      }
      updatePayload.inspection_date = body.inspection_date;
    }

    // ── Apply update ──────────────────────────────────────────────────────────
    const { data: updated, error: updateErr } = await supabase
      .from('lease_listings')
      .update(updatePayload)
      .eq('id', listing.id)
      .select('id, listing_ref, status, updated_at, expires_at')
      .single();

    if (updateErr) {
      console.error('[lease/update] update error:', updateErr);
      return res.status(500).json({ error: 'Could not update listing' });
    }

    // ── Confirmation email for status-changing actions ────────────────────────
    const emailActions = { proceed: true, book_inspection: true, extend: true, reactivate: true };
    if (emailActions[action]) {
      const cityTitle = listing.city.charAt(0).toUpperCase() + listing.city.slice(1);
      let subject = '';
      let bodyHtml = '';

      if (action === 'proceed') {
        subject  = 'Listing update: you\'ve marked a seeker as selected — ' + listing.listing_ref;
        bodyHtml = '<p>You\'ve moved your listing <strong>' + listing.title + '</strong> to <em>Proceeding</em>. Time to sort the documents and get the inspection booked.</p>';
      } else if (action === 'book_inspection') {
        subject  = 'Inspection booked — ' + listing.listing_ref;
        bodyHtml = '<p>Inspection date set for your listing <strong>' + listing.title + '</strong>. Cob will check in with you after it\'s done.</p>';
      } else if (action === 'extend') {
        const expiryLabel = new Date(updated.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
        subject  = 'Listing extended to ' + expiryLabel + ' — ' + listing.listing_ref;
        bodyHtml = '<p>Your listing <strong>' + listing.title + '</strong> is now active until <strong>' + expiryLabel + '</strong>. Extensions are always free.</p>';
      } else if (action === 'reactivate') {
        subject  = 'Listing reactivated — ' + listing.listing_ref;
        bodyHtml = '<p>Your listing <strong>' + listing.title + '</strong> is live again in ' + cityTitle + '.</p>';
      }

      try {
        await resend.emails.send({
          from:    'UniRenter <noreply@unirenter.com.au>',
          to:      email.toLowerCase().trim(),
          bcc:     'benjcarey75@gmail.com',
          subject,
          html: '<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">'
              + '<div style="background:#0d1f2d;padding:20px 28px;border-radius:12px 12px 0 0;">'
              + '<div style="font-family:Epilogue,sans-serif;font-size:20px;font-weight:800;color:#F5B800;">UniRenter</div>'
              + '<div style="font-size:12px;color:#7a96aa;margin-top:4px;">Lease Transfer &middot; ' + cityTitle + '</div>'
              + '</div>'
              + '<div style="background:#f9f9f9;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e8e8e8;border-top:none;">'
              + bodyHtml
              + '<p style="color:#999;font-size:12px;margin-top:24px;">UniRenter facilitates lease transfers between students — we are not a real estate agent and do not provide legal advice.</p>'
              + '</div></div>',
        });
      } catch (emailErr) {
        console.error('[lease/update] email send failed:', emailErr);
        // Non-fatal
      }
    }

    return res.status(200).json({
      success:    true,
      action,
      listing_ref: updated.listing_ref,
      status:     updated.status,
      updated_at: updated.updated_at,
      expires_at: updated.expires_at || null,
    });

  } catch (err) {
    console.error('[lease/update] unexpected error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
