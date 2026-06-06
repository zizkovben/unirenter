// POST /api/lease/handover/complete
// Called when step 6 is ticked by both parties (or by the final party to tick).
// Marks handover completed_at, sets files_delete_at = completed_at + 48hr,
// sends completion confirmation emails to both outgoing and incoming tenant,
// and updates lease_listings status to 'filled'.
//
// Body (JSON):
//   listing_ref    — e.g. "MEL-2847"
//   email          — the email of the party completing (outgoing or incoming)

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const FILE_DELETION_DELAY_MS = 48 * 60 * 60 * 1000; // 48 hours

// The 10 boolean step flags
const STEP_FLAGS = [
  's1_outgoing', 's1_incoming',
  's2_outgoing',
  's3_outgoing', 's3_incoming',
  's4_outgoing', 's4_incoming',
  's5_incoming',
  's6_outgoing', 's6_incoming'
];

function calcPercent(row) {
  const done = STEP_FLAGS.filter(f => row[f] === true).length;
  return Math.round((done / STEP_FLAGS.length) * 100);
}

function buildCompletionEmailHtml({ ref, role, listingTitle, deleteAt }) {
  const deleteAtStr = new Date(deleteAt).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const roleLabel = role === 'outgoing' ? 'outgoing tenant' : 'incoming tenant';
  const nextStep  = role === 'outgoing'
    ? 'Your lease liability ends when the new tenant signs with the landlord. Keep a copy of the landlord\'s written consent — it\'s your proof the transfer was authorised.'
    : 'Lodge your bond with your state\'s rental authority (RTBA in VIC, NSW Fair Trading, RTA in QLD, etc.) as soon as possible. Keep copies of all documents you received.';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Handover complete — UniRenter</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Inter,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#0d1f2d;border-radius:12px;overflow:hidden;max-width:580px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:1px solid #1e3548;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#F5B800;letter-spacing:-0.5px;">UniRenter</p>
              <p style="margin:4px 0 0;font-size:13px;color:#7a96aa;">Break lease handover — complete</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">

              <!-- Success badge -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f3d20;border:1px solid #3DAA5C;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;text-align:center;">
                    <p style="margin:0;font-size:20px;">✅</p>
                    <p style="margin:8px 0 0;font-size:15px;font-weight:700;color:#3DAA5C;">Handover complete for ${ref}</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#7a96aa;">${listingTitle}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:15px;color:#e8f0f5;line-height:1.6;">
                All six handover steps are complete. As the <strong style="color:#e8f0f5;">${roleLabel}</strong>, here's what to do next:
              </p>

              <!-- Cob block -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#162535;border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 8px;font-size:14px;color:#F5B800;font-weight:600;">🤠 Cob says</p>
                    <p style="margin:0;font-size:14px;color:#e8f0f5;line-height:1.6;">${nextStep}</p>
                  </td>
                </tr>
              </table>

              <!-- Document deletion notice -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#2a1a0e;border:1px solid #8B4513;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#E8623A;">⚠️ Document deletion notice</p>
                    <p style="margin:0;font-size:13px;color:#e8f0f5;line-height:1.6;">
                      All documents uploaded for this handover will be <strong>permanently deleted on ${deleteAtStr} AEST</strong>.
                      UniRenter does not provide document storage — please save your own copies before then.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:14px;color:#7a96aa;">
                Questions? Contact us at <a href="mailto:hello@unirenter.com.au" style="color:#4BBFE0;text-decoration:none;">hello@unirenter.com.au</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #1e3548;">
              <p style="margin:0;font-size:12px;color:#4a6070;">UniRenter · unirenter.com.au · Free for students, always.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { listing_ref, email } = req.body || {};

  if (!listing_ref || !email) {
    return res.status(400).json({ error: 'Missing required fields: listing_ref, email' });
  }

  const ref           = listing_ref.trim().toUpperCase();
  const callerEmail   = email.trim().toLowerCase();

  // Fetch listing
  const { data: listing, error: listingErr } = await supabase
    .from('lease_listings')
    .select('id, email, title, city, suburb, weekly_rent')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (listingErr || !listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  // Fetch handover row
  const { data: handover, error: handoverErr } = await supabase
    .from('lease_handover')
    .select('*')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (handoverErr || !handover) {
    return res.status(404).json({ error: 'Handover record not found' });
  }

  // Already completed — idempotent response
  if (handover.completed_at) {
    return res.status(200).json({
      success: true,
      already_complete: true,
      completed_at: handover.completed_at,
      files_delete_at: handover.files_delete_at
    });
  }

  // Determine caller role
  const outgoingEmail = listing.email.toLowerCase();
  const isOutgoing    = callerEmail === outgoingEmail;

  // Update the appropriate s6 flag
  const s6Field = isOutgoing ? 's6_outgoing' : 's6_incoming';
  const updatedRow = { ...handover, [s6Field]: true };

  // Check if both s6 flags are now true → mark complete
  const bothDone = updatedRow.s6_outgoing === true && updatedRow.s6_incoming === true;
  const now      = new Date();
  const deleteAt = new Date(now.getTime() + FILE_DELETION_DELAY_MS);

  const updatePayload = {
    [s6Field]: true,
    updated_at: now.toISOString()
  };

  if (bothDone) {
    updatePayload.completed_at   = now.toISOString();
    updatePayload.files_delete_at = deleteAt.toISOString();
  }

  const { error: updateErr } = await supabase
    .from('lease_handover')
    .update(updatePayload)
    .eq('listing_ref', ref);

  if (updateErr) {
    console.error('Handover complete update error:', updateErr);
    return res.status(500).json({ error: 'Failed to update handover record' });
  }

  // If fully complete — update listing to 'filled' + send emails
  if (bothDone) {
    // Mark listing as filled
    await supabase
      .from('lease_listings')
      .update({ status: 'filled', updated_at: now.toISOString() })
      .eq('listing_ref', ref);

    // Fetch incoming tenant email from lease_interest
    const { data: interestRow } = await supabase
      .from('lease_interest')
      .select('incoming_email, incoming_name')
      .eq('listing_ref', ref)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const incomingEmail = interestRow?.incoming_email || null;
    const listingTitle  = listing.title || `${listing.suburb} listing`;

    // Send completion emails to both parties
    const emailPromises = [];

    emailPromises.push(
      resend.emails.send({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: outgoingEmail,
        reply_to: 'noreply@unirenter.com.au',
        bcc: 'benjcarey75@gmail.com',
        subject: `✅ Handover complete — ${ref}`,
        html: buildCompletionEmailHtml({
          ref,
          role: 'outgoing',
          listingTitle,
          deleteAt: deleteAt.toISOString()
        })
      }).catch(err => console.error('Completion email to outgoing failed:', err))
    );

    if (incomingEmail) {
      emailPromises.push(
        resend.emails.send({
          from: 'UniRenter <noreply@unirenter.com.au>',
          to: incomingEmail,
          reply_to: 'noreply@unirenter.com.au',
          subject: `✅ Handover complete — ${ref}`,
          html: buildCompletionEmailHtml({
            ref,
            role: 'incoming',
            listingTitle,
            deleteAt: deleteAt.toISOString()
          })
        }).catch(err => console.error('Completion email to incoming failed:', err))
      );
    }

    await Promise.all(emailPromises);

    return res.status(200).json({
      success: true,
      fully_complete: true,
      completed_at: now.toISOString(),
      files_delete_at: deleteAt.toISOString()
    });
  }

  // Only one party has ticked s6 — waiting on the other
  return res.status(200).json({
    success: true,
    fully_complete: false,
    s6_outgoing: updatedRow.s6_outgoing === true,
    s6_incoming: updatedRow.s6_incoming === true,
    message: 'Waiting for the other party to complete step 6'
  });
}
