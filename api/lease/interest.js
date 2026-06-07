// api/lease/interest.js
// Incoming tenant expresses interest in a break lease listing.
// Flow: validate → look up listing → deduplicate → record → 
//   [STRIPE gate if enabled] create checkout session OR proceed directly → email outgoing tenant.
// Fully automatic — no human moderation required.
// S36: Stripe Checkout gate added — controlled by STRIPE_ENABLED env var.

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// Stripe is only initialised when STRIPE_ENABLED=true.
// During the free launch period (until Jan 2027) this env var is 'false'.
const STRIPE_ENABLED = (process.env.STRIPE_ENABLED || 'false').toLowerCase() === 'true';

let stripe = null;
if (STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listing_ref, incoming_email, incoming_name, incoming_uni } = req.body || {};

  if (!listing_ref || !incoming_email) {
    return res.status(400).json({ error: 'listing_ref and incoming_email are required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(incoming_email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // ── 1. Fetch the listing ──────────────────────────────────────────────────
    const { data: listing, error: listingErr } = await supabase
      .from('lease_listings')
      .select('id, email, city, suburb, property_type, weekly_rent, listing_ref, status, title')
      .eq('listing_ref', listing_ref)
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.status !== 'active') {
      return res.status(410).json({ error: 'This listing is no longer active' });
    }

    // ── 2. Prevent self-interest ──────────────────────────────────────────────
    if (listing.email.toLowerCase() === incoming_email.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot express interest in your own listing' });
    }

    // ── 3. Deduplicate — one event per (incoming_email + listing_ref) ─────────
    const { data: existing } = await supabase
      .from('lease_interest')
      .select('id')
      .eq('listing_ref', listing_ref)
      .eq('incoming_email', incoming_email.toLowerCase())
      .maybeSingle();

    if (existing) {
      // Idempotent — already registered, no duplicate email
      return res.status(200).json({ ok: true, already_registered: true });
    }

    // ── 4. Record the interest event ──────────────────────────────────────────
    const { error: insertErr } = await supabase
      .from('lease_interest')
      .insert({
        listing_ref,
        listing_id:     listing.id,
        incoming_email: incoming_email.toLowerCase(),
        incoming_name:  incoming_name || null,
        incoming_uni:   incoming_uni  || null,
        city:           listing.city,
        created_at:     new Date().toISOString(),
      });

    if (insertErr) {
      // Non-fatal — log and continue
      console.error('lease_interest insert error:', insertErr);
    }

    // ── 5. STRIPE GATE ────────────────────────────────────────────────────────
    // When STRIPE_ENABLED=true: create a Checkout session (~$15 AUD).
    // The handover row is only created after payment confirmation (webhook).
    // When STRIPE_ENABLED=false (free launch): skip payment, create row now.
    if (STRIPE_ENABLED && stripe) {
      const cityTitle  = listing.city.charAt(0).toUpperCase() + listing.city.slice(1);
      const listingTitle = listing.title || `${listing.suburb} listing`;

      const session = await stripe.checkout.sessions.create({
        mode:        'payment',
        currency:    'aud',
        line_items:  [
          {
            price_data: {
              currency:     'aud',
              unit_amount:  1500,   // $15.00 AUD in cents
              product_data: {
                name:        `Break Lease Connection — ${listingTitle}`,
                description: `Connect with the outgoing tenant for ${cityTitle} lease ${listing_ref}`,
              },
            },
            quantity: 1,
          },
        ],
        // Redirect back to the lease page after payment
        success_url: `https://unirenter.com.au/lease?handover=${listing_ref}&paid=1`,
        cancel_url:  `https://unirenter.com.au/lease`,
        metadata: {
          listing_ref,
          incoming_email: incoming_email.toLowerCase(),
          incoming_name:  incoming_name  || '',
          outgoing_email: listing.email,
          city:           listing.city,
          listing_id:     String(listing.id),
        },
        // Pre-fill customer email for convenience
        customer_email: incoming_email.toLowerCase(),
      });

      // Return the Stripe checkout URL — client will redirect there
      return res.status(200).json({ ok: true, stripe_checkout_url: session.url });
    }

    // ── 5a (free launch). Create handover row directly ────────────────────────
    await createHandoverAndNotify(listing, incoming_email, incoming_name, incoming_uni);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('lease/interest error:', err);
    return res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
};

// ── Shared helper: create handover row + email outgoing tenant ────────────────
// Called directly during free launch; called from stripe-webhook after payment.
async function createHandoverAndNotify(listing, incomingEmail, incomingName, incomingUni) {
  const listingRef = listing.listing_ref;

  // Ensure handover row exists
  const { data: existingHandover } = await supabase
    .from('lease_handover')
    .select('id')
    .eq('listing_ref', listingRef)
    .maybeSingle();

  if (!existingHandover) {
    await supabase
      .from('lease_handover')
      .insert({
        listing_ref,
        listing_id: listing.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .maybeSingle();
  }

  // Email the outgoing tenant
  const firstName    = incomingName ? incomingName.split(' ')[0] : 'A student';
  const uniLine      = incomingUni  ? ` studying at ${incomingUni}` : '';
  const cityTitle    = listing.city.charAt(0).toUpperCase() + listing.city.slice(1);
  const rentDisplay  = listing.weekly_rent ? `$${listing.weekly_rent}/wk` : '';
  const listingTitle = listing.title || `${listing.suburb} listing`;
  const handoverUrl  = `https://unirenter.com.au/lease?handover=${listingRef}`;

  await resend.emails.send({
    from:     'UniRenter <noreply@unirenter.com.au>',
    to:       listing.email,
    reply_to: 'noreply@unirenter.com.au',
    bcc:      'benjcarey75@gmail.com',
    subject:  `Someone's interested in your ${cityTitle} listing (${listingRef})`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#0d1f2d;padding:24px 32px;border-radius:12px 12px 0 0;">
          <div style="font-family:Epilogue,sans-serif;font-size:22px;font-weight:800;color:#F5B800;">UniRenter</div>
          <div style="font-size:13px;color:#7a96aa;margin-top:4px;">Break Lease Board &middot; ${cityTitle}</div>
        </div>
        <div style="background:#f9f9f9;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e8e8e8;border-top:none;">
          <h2 style="margin:0 0 8px;font-size:20px;color:#0d1f2d;">Someone is interested in your listing 🎉</h2>
          <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.7;">
            <strong>${firstName}</strong>${uniLine} has expressed interest in your break lease listing.
          </p>
          <div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
            <div style="font-weight:700;font-size:15px;color:#0d1f2d;margin-bottom:4px;">${listingTitle}</div>
            <div style="font-size:13px;color:#777;">${listingRef} &middot; ${cityTitle} &middot; ${rentDisplay}</div>
          </div>
          <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 20px;">
            UniRenter will facilitate the next step. <strong>Keep all contact through the platform</strong> &mdash;
            do not share your personal phone number or email directly until an in-person inspection is confirmed.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
            <tr>
              <td style="background:#F5B800;border-radius:8px;padding:13px 28px;">
                <a href="${handoverUrl}" style="font-family:Inter,sans-serif;font-size:14px;font-weight:700;color:#0d1f2d;text-decoration:none;">Open your handover checklist &rarr;</a>
              </td>
            </tr>
          </table>
          <p style="color:#999;font-size:12px;margin:0 0 20px;">
            Or copy: <a href="${handoverUrl}" style="color:#4BBFE0;">${handoverUrl}</a>
          </p>
          <div style="background:#fff8e6;border:1px solid #f0d080;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
            <div style="font-weight:700;font-size:13px;color:#8a6000;margin-bottom:8px;">🤠 Cob says &mdash; start your documents now</div>
            <p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.7;">
              Getting written landlord consent typically takes 5&ndash;7 business days &mdash; start this now, not after you have an interested tenant waiting. Upload your condition report and landlord consent through your handover checklist so they can confirm an inspection.
            </p>
            <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#555;line-height:1.9;">
              <li>Arrange an <strong>in-person inspection</strong> before agreeing to anything</li>
              <li>Get <strong>written landlord consent</strong> &mdash; verbal agreement is not enough</li>
              <li>Never accept a deposit, bond transfer, or any money before both parties have signed</li>
              <li>If anything feels off, contact your state tenancy authority</li>
            </ul>
          </div>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e8e8e8;font-size:11px;color:#aaa;">
            UniRenter &middot; unirenter.com.au &middot; Free for students, always.<br>
            You're receiving this because you posted a break lease listing on UniRenter.
          </div>
        </div>
      </div>
    `,
  });
}

// Export the helper so the Stripe webhook can call it
module.exports.createHandoverAndNotify = createHandoverAndNotify;
