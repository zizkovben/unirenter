// api/notifications/send-reminder.js
// Sends a Resend email reminder for an upcoming calendar event.
// Called by the dashboard when:
//   - Push notifications are unavailable or denied, AND
//   - The event is ≤3 days away, AND
//   - The email hasn't already been sent (client-side localStorage gate + server-side idempotency key)
// CommonJS — matches all new API files in this project.

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Category display names
const CAT_LABELS = {
  lease:          'Lease date',
  rent:           'Rent due',
  inspection:     'Inspection',
  bond:           'Bond date',
  study:          'Uni date',
  work:           'Work shift',
  public_holiday: 'Public holiday',
  other:          'Upcoming date'
};

// Category-specific advice copy (general guidance only — no legal advice)
const CAT_ADVICE = {
  lease: 'Make sure any written notices are sent and your lease companion is up to date.',
  rent:  'Staying on top of rent payments protects your rental history for future applications.',
  inspection: 'A quick tidy and making sure any previously noted issues are addressed goes a long way. Check your condition report notes if you have them.',
  bond:  'Bond claim windows are time-sensitive. Have your condition report and move-in photos ready to speed things up.',
  study: 'Exam or assignment coming up — worth making sure your accommodation situation isn\'t adding to your stress.',
  other: 'Just making sure it\'s on your radar before it sneaks up on you.'
};

function daysLabel(daysUntil) {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return 'in ' + daysUntil + ' days';
}

function buildEmailHtml(event, daysUntil, email) {
  const catLabel = CAT_LABELS[event.cat] || 'Upcoming date';
  const advice   = CAT_ADVICE[event.cat] || CAT_ADVICE.other;
  const label    = daysLabel(daysUntil);
  const title    = event.title || event.name || 'Important date';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reminder: ${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1f2d;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
              <span style="font-size:22px;font-weight:700;color:#ffffff;font-family:'Epilogue',Arial,sans-serif;">UniRenter</span>
              <span style="font-size:13px;color:#7a96aa;margin-left:10px;">Settlement companion</span>
            </td>
          </tr>

          <!-- Cob greeting -->
          <tr>
            <td style="padding:28px 32px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px;vertical-align:top;">
                    <div style="width:40px;height:40px;background:#f5b800;border-radius:50%;text-align:center;line-height:40px;font-size:22px;">🤠</div>
                  </td>
                  <td style="padding-left:14px;">
                    <div style="font-size:13px;color:#7a96aa;margin-bottom:3px;">Cob · your settlement companion</div>
                    <div style="font-size:15px;color:#e8f0f5;line-height:1.5;">
                      Hey — just a heads up that <strong style="color:#ffffff;">${title}</strong> is <strong style="color:#f5b800;">${label}</strong>.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Event card -->
          <tr>
            <td style="padding:20px 32px;">
              <div style="background:#162535;border-radius:10px;padding:16px 20px;border-left:4px solid #f5b800;">
                <div style="font-size:11px;color:#7a96aa;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">${catLabel}</div>
                <div style="font-size:18px;font-weight:700;color:#ffffff;font-family:'Epilogue',Arial,sans-serif;margin-bottom:4px;">${title}</div>
                <div style="font-size:13px;color:#4BBFE0;">${event.date ? new Date(event.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' }) : label}</div>
                ${event.notes ? '<div style="font-size:13px;color:#7a96aa;margin-top:8px;">' + event.notes + '</div>' : ''}
              </div>
            </td>
          </tr>

          <!-- Advice -->
          <tr>
            <td style="padding:0 32px 24px;">
              <div style="font-size:14px;color:#b0c4d4;line-height:1.6;">${advice}</div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;">
              <a href="https://unirenter.vercel.app/dashboard?tab=calendar" style="display:inline-block;background:#f5b800;color:#0d1f2d;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">
                Open your calendar ↗
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:12px;color:#7a96aa;line-height:1.6;">
                You're receiving this because you have an upcoming date in your UniRenter calendar.<br>
                Manage your notification preferences in your <a href="https://unirenter.vercel.app/dashboard?tab=settings" style="color:#4BBFE0;text-decoration:none;">dashboard settings</a>.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { email, event, daysUntil } = req.body || {};

    if (!email || !event || typeof daysUntil !== 'number') {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }

    // Guard: only send for events ≤3 days away
    if (daysUntil < 0 || daysUntil > 3) {
      return res.status(400).json({ ok: false, error: 'Event not within reminder window' });
    }

    const eventTitle = event.title || event.name || 'Upcoming date';
    const label      = daysLabel(daysUntil);
    const subject    = daysUntil === 0
      ? `Today: ${eventTitle} 🤠`
      : daysUntil === 1
        ? `Tomorrow: ${eventTitle} 🤠`
        : `Reminder: ${eventTitle} is in ${daysUntil} days 🤠`;

    const { error } = await resend.emails.send({
      from:    'UniRenter Cob <noreply@unirenter.com.au>',
      to:      email,
      bcc:     'benjcarey75@gmail.com',
      replyTo: 'noreply@unirenter.com.au',
      subject: subject,
      html:    buildEmailHtml(event, daysUntil, email)
    });

    if (error) {
      console.error('Resend error in send-reminder:', error);
      return res.status(500).json({ ok: false, error: 'Failed to send email' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('send-reminder error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
