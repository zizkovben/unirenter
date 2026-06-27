// api/lease/submit.js
// Creates a new lease transfer listing.
// POST body: { email, city, suburb, property_type, bedrooms, weekly_rent,
//              available_from, lease_ends, furnished, pets_allowed, title, description }
// Returns: { success: true, listing_ref, status } on success.
// Status is 'active' (auto-approved) — no moderation queue for now.

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const ALLOWED_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];

const CITY_PREFIX = {
  melbourne: 'MEL',
  sydney:    'SYD',
  brisbane:  'BRI',
  adelaide:  'ADE',
  perth:     'PER',
  canberra:  'CAN',
};

const VALID_PROPERTY_TYPES = [
  // Legacy short slugs (keep for backwards compat)
  'room', 'studio', 'apartment', 'house', 'other',
  // Frontend descriptive values (used by lease form select)
  'private_room_share_house', 'private_room_share_apartment',
  'share_room', '1br_apartment', '2br_apartment', '3br_plus',
  'whole_property',
];

function generateRef(city) {
  const prefix = CITY_PREFIX[city] || 'UNI';
  const num    = Math.floor(1000 + Math.random() * 9000); // 4-digit
  return prefix + '-' + num;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      email,
      city,
      suburb,
      property_type,
      bedrooms,
      weekly_rent,
      available_from,
      lease_ends,
      furnished,
      pets_allowed,
      title,
      description,
    } = req.body || {};

    // ── Validation ────────────────────────────────────────────────────────────
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!city || !ALLOWED_CITIES.includes(city.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid or missing city' });
    }
    if (!suburb || typeof suburb !== 'string' || suburb.trim().length < 2) {
      return res.status(400).json({ error: 'Suburb is required' });
    }
    if (!property_type || !VALID_PROPERTY_TYPES.includes(property_type)) {
      return res.status(400).json({ error: 'Invalid property type' });
    }
    if (!weekly_rent || isNaN(parseInt(weekly_rent, 10)) || parseInt(weekly_rent, 10) < 50 || parseInt(weekly_rent, 10) > 5000) {
      return res.status(400).json({ error: 'Weekly rent must be between $50 and $5000' });
    }
    if (!available_from) {
      return res.status(400).json({ error: 'Available from date is required' });
    }
    if (!lease_ends) {
      return res.status(400).json({ error: 'Lease end date is required' });
    }
    if (!title || typeof title !== 'string' || title.trim().length < 5) {
      return res.status(400).json({ error: 'Listing title must be at least 5 characters' });
    }
    if (title.trim().length > 120) {
      return res.status(400).json({ error: 'Listing title must be 120 characters or fewer' });
    }
    if (description && description.trim().length > 1000) {
      return res.status(400).json({ error: 'Description must be 1000 characters or fewer' });
    }

    // ── Date sanity check ─────────────────────────────────────────────────────
    const fromDate  = new Date(available_from);
    const endDate   = new Date(lease_ends);
    const now       = new Date();
    const maxFuture = new Date(now);
    maxFuture.setFullYear(maxFuture.getFullYear() + 3);

    if (isNaN(fromDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    if (endDate <= fromDate) {
      return res.status(400).json({ error: 'Lease end date must be after available from date' });
    }
    if (fromDate > maxFuture) {
      return res.status(400).json({ error: 'Available from date is too far in the future' });
    }

    // ── Duplicate guard — one active listing per email per city ──────────────
    const { data: existing } = await supabase
      .from('lease_listings')
      .select('id, listing_ref')
      .eq('email', email.toLowerCase().trim())
      .eq('city', city.toLowerCase())
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: 'You already have an active listing in this city.',
        existing_ref: existing.listing_ref,
      });
    }

    // ── Generate unique listing_ref ───────────────────────────────────────────
    let listing_ref = generateRef(city.toLowerCase());
    // Collision check (extremely unlikely but safe)
    const { data: collision } = await supabase
      .from('lease_listings')
      .select('id')
      .eq('listing_ref', listing_ref)
      .maybeSingle();
    if (collision) {
      listing_ref = generateRef(city.toLowerCase()) + Math.floor(Math.random() * 10);
    }

    // ── Insert ────────────────────────────────────────────────────────────────
    const cityNorm = city.toLowerCase().trim();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day listing per locked spec

    const { data: inserted, error: insertErr } = await supabase
      .from('lease_listings')
      .insert([{
        listing_ref,
        email:          email.toLowerCase().trim(),
        city:           cityNorm,
        suburb:         suburb.trim().slice(0, 100),
        property_type,
        bedrooms:       bedrooms ? parseInt(bedrooms, 10) : null,
        weekly_rent:    parseInt(weekly_rent, 10),
        available_from: available_from,
        lease_ends:     lease_ends,
        furnished:      furnished === true || furnished === 'true',
        pets_allowed:   pets_allowed === true || pets_allowed === 'true',
        title:          title.trim().slice(0, 120),
        description:    description ? description.trim().slice(0, 1000) : null,
        status:         'active',
        report_count:   0,
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
        expires_at:     expiresAt.toISOString(),
      }])
      .select('id, listing_ref, status')
      .single();

    if (insertErr) {
      console.error('[lease/submit] Supabase insert error:', insertErr);
      return res.status(500).json({ error: 'Could not save listing. Please try again.', detail: insertErr.message || insertErr.code || null });
    }

    // ── Confirmation email ────────────────────────────────────────────────────
    const cityTitle   = cityNorm.charAt(0).toUpperCase() + cityNorm.slice(1);
    const expiryLabel = expiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    const handoverUrl = 'https://unirenter.com.au/lease?handover=' + listing_ref;

    try {
      await resend.emails.send({
        from:     'UniRenter <noreply@unirenter.com.au>',
        to:       email.toLowerCase().trim(),
        bcc:      'benjcarey75@gmail.com',
        subject:  'Your lease transfer listing is live — ' + listing_ref,
        html: `
          <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0d1f2d;padding:24px 32px;border-radius:12px 12px 0 0;">
              <div style="font-family:Epilogue,sans-serif;font-size:22px;font-weight:800;color:#F5B800;">UniRenter</div>
              <div style="font-size:13px;color:#7a96aa;margin-top:4px;">Lease Transfer &middot; ${cityTitle}</div>
            </div>
            <div style="background:#f9f9f9;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e8e8e8;border-top:none;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#0d1f2d;">Your listing is live 🎉</h2>
              <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.7;">
                Your lease transfer listing in <strong>${suburb.trim()}, ${cityTitle}</strong> is now live on UniRenter.
                We'll email you as soon as someone expresses interest.
              </p>
              <div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
                <div style="font-weight:700;font-size:15px;color:#0d1f2d;margin-bottom:4px;">${title.trim()}</div>
                <div style="font-size:13px;color:#777;">${listing_ref} &middot; ${cityTitle} &middot; $${parseInt(weekly_rent, 10)}/wk</div>
              </div>
              <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 20px;">
                Your listing expires on <strong>${expiryLabel}</strong>. Extensions are always free — 
                Cob will nudge you if things go quiet.
              </p>
              <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 20px;">
                <strong>Tip from Cob 🤠</strong> — If you haven't already, start the landlord approval 
                conversation now. It can take 14–28 days depending on your property manager, and delays cost you rent.
              </p>
              <a href="${handoverUrl}" style="display:inline-block;background:#3DAA5C;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:15px;">
                View my listing →
              </a>
              <p style="margin-top:28px;color:#999;font-size:12px;line-height:1.6;">
                UniRenter facilitates lease transfers between students — we are not a real estate agent and do not provide legal advice.
                For tenancy rights, contact Consumer Affairs in your state.
              </p>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      // Non-fatal — listing was saved, just log the email failure
      console.error('[lease/submit] Email send failed:', emailErr);
    }

    return res.status(200).json({
      success:     true,
      listing_ref: inserted.listing_ref,
      status:      inserted.status,
    });

  } catch (err) {
    console.error('[lease/submit] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
