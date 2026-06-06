// POST /api/lease/handover/request-docs
// Incoming tenant sends a document request nudge to the outgoing tenant.
// One per listing (enforced by doc_request_sent flag).
// Body: { listing_ref, incoming_email }

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listing_ref, incoming_email } = req.body || {};
  if (!listing_ref || !incoming_email) {
    return res.status(400).json({ error: 'Missing required fields: listing_ref, incoming_email' });
  }

  const ref          = listing_ref.trim().toUpperCase();
  const incomingAddr = incoming_email.trim().toLowerCase();

  const { data: listing, error: listingErr } = await supabase
    .from('lease_listings')
    .select('id, email, title, city, suburb, weekly_rent')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (listingErr || !listing) return res.status(404).json({ error: 'Listing not found' });

  const { data: existing, error: fetchErr } = await supabase
    .from('lease_handover')
    .select('id, doc_request_sent')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: 'Database error' });

  let handover = existing;
  if (!handover) {
    const { data: newRow, error: insertErr } = await supabase
      .from('lease_handover')
      .insert({
        listing_ref: ref,
        listing_id: listing.id,
        doc_request_sent: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('id, doc_request_sent')
      .single();
    if (insertErr) return res.status(500).json({ error: 'Could not create handover record' });
    handover = newRow;
  }

  if (handover.doc_request_sent === true) {
    return res.status(409).json({ error: 'Document request already sent for this listing' });
  }

  const now = new Date().toISOString();
  await supabase
    .from('lease_handover')
    .update({ doc_request_sent: true, doc_request_sent_at: now, updated_at: now })
    .eq('listing_ref', ref);

  const handoverUrl = 'https://unirenter.com.au/lease?handover=' + ref;
  const listingTitle = listing.title || (listing.suburb + ' listing');

  const emailHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Inter,Helvetica,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px;"><tr><td align="center">' +
    '<table width="580" cellpadding="0" cellspacing="0" style="background:#0d1f2d;border-radius:12px;overflow:hidden;max-width:580px;width:100%;">' +
    '<tr><td style="padding:28px 32px 20px;border-bottom:1px solid #1e3548;">' +
    '<p style="margin:0;font-size:22px;font-weight:700;color:#F5B800;">UniRenter</p>' +
    '<p style="margin:4px 0 0;font-size:13px;color:#7a96aa;">Break lease handover</p></td></tr>' +
    '<tr><td style="padding:28px 32px;">' +
    '<p style="margin:0 0 16px;font-size:16px;color:#e8f0f5;line-height:1.5;">Someone is waiting to see your documents for listing <strong style="color:#F5B800;">' + ref + '</strong> &mdash; ' + listingTitle + ' &mdash; before confirming an inspection.</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#162535;border-radius:8px;margin:20px 0;"><tr><td style="padding:18px 20px;">' +
    '<p style="margin:0 0 8px;font-size:14px;color:#F5B800;font-weight:600;">&#x1F920; Cob says</p>' +
    '<p style="margin:0;font-size:14px;color:#e8f0f5;line-height:1.6;">They can\'t commit to inspecting without seeing your condition report and landlord consent first &mdash; and honestly, that\'s the right call. Upload them now and keep this handover moving.</p>' +
    '</td></tr></table>' +
    '<table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;"><tr>' +
    '<td style="background:#F5B800;border-radius:8px;padding:14px 32px;text-align:center;">' +
    '<a href="' + handoverUrl + '" style="font-size:15px;font-weight:700;color:#0d1f2d;text-decoration:none;">Upload documents &rarr;</a>' +
    '</td></tr></table>' +
    '<p style="margin:0;font-size:12px;color:#4a6070;line-height:1.5;">Documents are stored securely for this transaction only and deleted permanently 48 hours after handover is complete.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 32px;border-top:1px solid #1e3548;">' +
    '<p style="margin:0;font-size:12px;color:#4a6070;">UniRenter &middot; unirenter.com.au &middot; Free for students, always.</p>' +
    '</td></tr></table></td></tr></table></body></html>';

  try {
    await resend.emails.send({
      from: 'UniRenter <noreply@unirenter.com.au>',
      to: listing.email,
      reply_to: 'noreply@unirenter.com.au',
      bcc: 'benjcarey75@gmail.com',
      subject: 'Document request for your listing ' + ref,
      html: emailHtml
    });
  } catch (emailErr) {
    console.error('Resend error in request-docs:', emailErr);
    return res.status(200).json({ success: true, email_sent: false });
  }

  return res.status(200).json({ success: true, email_sent: true, listing_ref: ref });
};
