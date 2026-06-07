// api/lease/relist.js
// Re-lists an expired break lease listing for another 60-day window.
// Always free — no Stripe gate on re-listing.
// Flow:
//   1. Validate caller owns the listing (email match)
//   2. Check listing is expired (status=active but expires_at < now,
//      OR status=filled — poster can re-list after a settled handover)
//   3. Reset expires_at to now + 60 days, status = 'active'
//   4. Send a Cob nudge email to the outgoing tenant encouraging document prep
// S36: new file.

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listing_ref, email } = req.body || {};

  if (!listing_ref || !email) {
    return res.status(400).json({ error: 'listing_ref and email are required' });
  }

  try {
    // ── 1. Fetch the listing and verify ownership ─────────────────────────────
    const { data: listing, error: listingErr } = await supabase
      .from('lease_listings')
      .select('id, email, city, suburb, weekly_rent, listing_ref, status, expires_at, title')
      .eq('listing_ref', listing_ref)
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }

    // ── 2. Only allow re-listing if expired or filled ─────────────────────────
    const now = new Date();
    const isExpired = listing.expires_at && new Date(listing.expires_at) < now;
    const isFilled  = listing.status === 'filled';

    if (!isExpired && !isFilled) {
      return res.status(409).json({ error: 'Listing is still active — re-listing not needed yet' });
    }

    // ── 3. Reset the listing: active, new 60-day window ───────────────────────
    const newExpiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // now + 60 days

    const { error: updateErr } = await supabase
      .from('lease_listings')
      .update({
        status:     'active',
        expires_at: newExpiresAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('listing_ref', listing_ref);

    if (updateErr) {
      console.error('relist update error:', updateErr);
      return res.status(500).json({ error: 'Could not re-list — please try again' });
    }

    // ── 4. Send Cob nudge email to outgoing tenant ────────────────────────────
    const cityTitle    = listing.city.charAt(0).toUpperCase() + listing.city.slice(1);
    const listingTitle = listing.title || `${listing.suburb} listing`;
    const handoverUrl  = `https://unirenter.com.au/lease?handover=${listing_ref}`;
    const expiryDate   = newExpiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    await resend.emails.send({
      from:     'UniRenter <noreply@unirenter.com.au>',
      to:       listing.email,
      reply_to: 'noreply@unirenter.com.au',
      bcc:      'benjcarey75@gmail.com',
      subject:  `Your listing has been re-listed — it's active until ${expiryDate} (${listing_ref})`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#0d1f2d;padding:24px 32px;border-radius:12px 12px 0 0;">
            <div style="font-family:Epilogue,sans-serif;font-size:22px;font-weight:800;color:#F5B800;">UniRenter</div>
            <div style="font-size:13px;color:#7a96aa;margin-top:4px;">Break Lease Board &middot; ${cityTitle}</div>
          </div>
          <div style="background:#f9f9f9;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e8e8e8;border-top:none;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#0d1f2d;">Your listing is active again 🎉</h2>
            <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.7;">
              Your break lease listing has been re-listed and is now live until <strong>${expiryDate}</strong>.
            </p>
            <div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
              <div style="font-weight:700;font-size:15px;color:#0d1f2d;margin-bottom:4px;">${listingTitle}</div>
              <div style="font-size:13px;color:#777;">${listing_ref} &middot; ${cityTitle}${listing.weekly_rent ? ` &middot; $${listing.weekly_rent}/wk` : ''}</div>
            </div>
            <div style="background:#fff8e6;border:1px solid #f0d080;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
              <div style="font-weight:700;font-size:13px;color:#8a6000;margin-bottom:8px;">🤠 Cob says — get your documents ready now</div>
              <p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.7;">
                The faster you get your documents in order, the faster you can connect with an incoming tenant. 
                Landlord consent typically takes 5–7 business days — don't wait until someone is interested.
              </p>
              <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#555;line-height:1.9;">
                <li>Start on <strong>written landlord consent</strong> today</li>
                <li>Locate your <strong>entry condition report</strong> and bond lodgement form</li>
                <li>Upload documents to your handover checklist in advance</li>
                <li>Keep all contact through UniRenter until an inspection is agreed</li>
              </ul>
            </div>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
              <tr>
                <td style="background:#F5B800;border-radius:8px;padding:13px 28px;">
                  <a href="${handoverUrl}" style="font-family:Inter,sans-serif;font-size:14px;font-weight:700;color:#0d1f2d;text-decoration:none;">Open your handover checklist &rarr;</a>
                </td>
              </tr>
            </table>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e8e8e8;font-size:11px;color:#aaa;">
              UniRenter &middot; unirenter.com.au &middot; Free for students, always.<br>
              Your listing expires on ${expiryDate}. Re-list any time after it expires.
            </div>
          </div>
        </div>
      `,
    });

    return res.status(200).json({
      ok:         true,
      expires_at: newExpiresAt.toISOString(),
      message:    `Listing re-activated until ${expiryDate}`,
    });

  } catch (err) {
    console.error('lease/relist error:', err);
    return res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
};
