// api/messages/notify.js — internal helper, called by send.js
// Sends a Resend email to the message recipient.
// S181: split into two variants — a brand-new/reopened connection request
// ("X wants to connect") vs an accepted thread's first real reply
// ("X sent you a message"). Both fire at most once per thread, matching
// pre-S181 behaviour (ongoing replies rely on in-app polling, not email).
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

function cityLabelFor(city) {
  return city ? city.charAt(0).toUpperCase() + city.slice(1) : 'Australia';
}

function previewFor(messagePreview) {
  return messagePreview
    ? messagePreview.slice(0, 120) + (messagePreview.length > 120 ? '…' : '')
    : 'Open UniRenter to read and reply.';
}

function baseEmailHtml({ cityLabel, headline, bodyHtml, ctaText, ctaUrl, footerLine }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1f2d;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
        <!-- Header -->
        <tr><td style="padding:28px 32px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#4BBFE0;">UniRenter</span>
          <span style="font-size:13px;color:rgba(255,255,255,0.4);margin-left:8px;">${cityLabel}</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          ${bodyHtml}
          <a href="${ctaUrl}" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:4px;">${ctaText} →</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);line-height:1.6;">
            ${footerLine}
            Never pay a deposit or share your home address before inspecting a property in person.<br>
            <a href="https://unirenter.com.au/legal" style="color:rgba(255,255,255,0.3);">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Accepted-thread reply notification (pre-S181 behaviour, unchanged copy) ──
async function notifyRecipient({ recipientEmail, senderName, messagePreview, city }) {
  const cityLabel = cityLabelFor(city);
  const preview = previewFor(messagePreview);
  const subject = senderName
    ? senderName + ' sent you a message on UniRenter'
    : 'You have a new message on UniRenter';

  const bodyHtml = `
    <div style="font-size:22px;margin-bottom:6px;">💬</div>
    <h2 style="margin:0 0 10px;font-size:18px;color:#fff;font-family:Georgia,serif;">${senderName ? senderName + ' sent you a message' : 'New message'}</h2>
    <div style="background:rgba(255,255,255,0.05);border-left:3px solid #4BBFE0;padding:14px 16px;border-radius:0 8px 8px 0;margin:16px 0;">
      <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.6;">"${preview}"</p>
    </div>
    <p style="font-size:13px;color:rgba(255,255,255,0.5);margin:16px 0 24px;">Head to your dashboard to reply — conversations are only available inside UniRenter.</p>`;

  try {
    await resend.emails.send({
      from: 'UniRenter <noreply@unirenter.com.au>',
      to: recipientEmail,
      bcc: 'benjcarey75@gmail.com',
      subject,
      html: baseEmailHtml({
        cityLabel,
        bodyHtml,
        ctaText: 'Open Messages',
        ctaUrl: 'https://unirenter.com.au/dashboard#messages',
        footerLine: "You're receiving this because someone matched with you on UniRenter. ",
      }),
    });
    return true;
  } catch (err) {
    console.error('notify email error:', err.message);
    return false;
  }
}

// ── New connection request notification (S181) ───────────────────────────
async function notifyConnectionRequest({ recipientEmail, senderName, messagePreview, city }) {
  const cityLabel = cityLabelFor(city);
  const preview = previewFor(messagePreview);
  const subject = senderName
    ? senderName + ' wants to connect on UniRenter'
    : 'Someone wants to connect on UniRenter';

  const bodyHtml = `
    <div style="font-size:22px;margin-bottom:6px;">🤝</div>
    <h2 style="margin:0 0 10px;font-size:18px;color:#fff;font-family:Georgia,serif;">${senderName ? senderName + ' wants to connect' : 'New connection request'}</h2>
    <div style="background:rgba(245,184,0,0.06);border-left:3px solid #F5B800;padding:14px 16px;border-radius:0 8px 8px 0;margin:16px 0;">
      <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.6;">"${preview}"</p>
    </div>
    <p style="font-size:13px;color:rgba(255,255,255,0.5);margin:16px 0 24px;">Accept to start the conversation, or decline — they won't be told either way.</p>`;

  try {
    await resend.emails.send({
      from: 'UniRenter <noreply@unirenter.com.au>',
      to: recipientEmail,
      bcc: 'benjcarey75@gmail.com',
      subject,
      html: baseEmailHtml({
        cityLabel,
        bodyHtml,
        ctaText: 'View Request',
        ctaUrl: 'https://unirenter.com.au/dashboard#messages',
        footerLine: "You're receiving this because a fellow student found your profile on UniRenter. ",
      }),
    });
    return true;
  } catch (err) {
    console.error('notify (request) email error:', err.message);
    return false;
  }
}

module.exports = { notifyRecipient, notifyConnectionRequest };
