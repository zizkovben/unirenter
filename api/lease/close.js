// api/lease/close.js
// Closes or withdraws a lease transfer listing.
// POST body: { email, listing_ref, reason }
//
// reason values:
//   'found_through_unirenter'  — successful handover via platform
//   'found_another_way'        — found someone outside UniRenter
//   'no_longer_needed'         — situation changed
//   'other'                    — catch-all
//
// Closes the listing (status → 'withdrawn') and fires the closing question
// Cob asks per the locked spec: "Did you find a replacement through UniRenter, or another way?"
//
// Auth: email must match listing owner. SUPABASE_SERVICE_ROLE_KEY server-side.

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const VALID_REASONS = [
  'found_through_unirenter',
  'found_another_way',
  'no_longer_needed',
  'other',
];

// Statuses that can be manually closed
const CLOSEABLE_STATUSES = ['active', 'proceeding', 'inspection_booked', 'withdrawn', 'timed_out'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { email, listing_ref, reason } = body;

    // ── Validation ─────────────────────────────────────────────────────────
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!listing_ref || typeof listing_ref !== 'string') {
      return res.status(400).json({ error: 'listing_ref is required' });
    }
    if (!reason || !VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'reason must be one of: ' + VALID_REASONS.join(', ') });
    }

    // ── Fetch listing and verify ownership ──────────────────────────────────
    const { data: listing, error: fetchErr } = await supabase
      .from('lease_listings')
      .select('id, listing_ref, email, status, city, title, weekly_rent')
      .eq('listing_ref', listing_ref.trim().toUpperCase())
      .maybeSingle();

    if (fetchErr) {
      console.error('[lease/close] fetch error:', fetchErr);
      return res.status(500).json({ error: 'Could not fetch listing' });
    }
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.email !== email.toLowerCase().trim()) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }
    if (listing.status === 'complete') {
      return res.status(409).json({ error: 'This listing is already complete and cannot be modified' });
    }
    if (!CLOSEABLE_STATUSES.includes(listing.status)) {
      return res.status(409).json({
        error:          'Listing cannot be closed from status "' + listing.status + '"',
        current_status: listing.status,
      });
    }

    // ── Determine final status ─────────────────────────────────────────────
    // 'found_through_unirenter' marks as complete (successful handover recorded)
    // Everything else marks as withdrawn
    const finalStatus = reason === 'found_through_unirenter' ? 'complete' : 'withdrawn';

    const { data: updated, error: updateErr } = await supabase
      .from('lease_listings')
      .update({
        status:       finalStatus,
        close_reason: reason,
        updated_at:   new Date().toISOString(),
        closed_at:    new Date().toISOString(),
      })
      .eq('id', listing.id)
      .select('id, listing_ref, status, closed_at')
      .single();

    if (updateErr) {
      console.error('[lease/close] update error:', updateErr);
      return res.status(500).json({ error: 'Could not close listing' });
    }

    // ── Confirmation email ─────────────────────────────────────────────────
    const cityTitle = listing.city.charAt(0).toUpperCase() + listing.city.slice(1);

    const reasonLabels = {
      found_through_unirenter: 'Found through UniRenter 🎉',
      found_another_way:       'Found another way',
      no_longer_needed:        'No longer needed',
      other:                   'Other',
    };

    const isSuccess = reason === 'found_through_unirenter';
    const subject   = isSuccess
      ? 'Congrats on the lease transfer! — ' + listing.listing_ref
      : 'Your listing has closed — ' + listing.listing_ref;

    const successMsg = '<h2 style="margin:0 0 8px;font-size:20px;color:#0d1f2d;">Congrats on the transfer! 🎉</h2>'
      + '<p style="color:#555;font-size:14px;line-height:1.7;">Your lease transfer in <strong>' + cityTitle + '</strong> has wrapped up. '
      + 'Good luck with the move, and hope the new place is great.</p>'
      + '<p style="color:#555;font-size:14px;line-height:1.7;">If your new household joins UniRenter, you can use the Housemate Agreement feature to get everyone aligned from day one. 🤠</p>';

    const closeMsg = '<h2 style="margin:0 0 8px;font-size:20px;color:#0d1f2d;">Your listing is now closed</h2>'
      + '<p style="color:#555;font-size:14px;line-height:1.7;">Your listing <strong>' + listing.title + '</strong> has been closed. '
      + 'Reason: ' + reasonLabels[reason] + '.</p>'
      + '<p style="color:#555;font-size:14px;line-height:1.7;">You can relist anytime — extensions and new listings are always free.</p>'
      + '<a href="https://unirenter.com.au/lease" style="display:inline-block;background:#4BBFE0;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;">Relist anytime →</a>';

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
            + (isSuccess ? successMsg : closeMsg)
            + '<p style="color:#999;font-size:12px;margin-top:24px;">UniRenter facilitates lease transfers between students — we are not a real estate agent and do not provide legal advice.</p>'
            + '</div></div>',
      });
    } catch (emailErr) {
      console.error('[lease/close] email send failed:', emailErr);
      // Non-fatal
    }

    return res.status(200).json({
      success:     true,
      listing_ref: updated.listing_ref,
      status:      updated.status,
      reason,
      closed_at:   updated.closed_at,
    });

  } catch (err) {
    console.error('[lease/close] unexpected error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
