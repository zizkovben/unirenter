// api/household/agreement-lock.js
// POST — lock an agreement once all members have ticked all clauses
// Body: { email, agreement_id }
// Returns: { ok, share_token }

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Build clause categories label
function clauseCategory(category) {
  var icons = {
    rent:        '💰 Rent & Bills',
    quiet:       '🛏️ Quiet Hours',
    cleaning:    '🧹 Cleaning',
    kitchen:     '🍳 Kitchen',
    pets:        '🐾 Pets',
    guests:      '🎉 Guests',
    moving:      '📦 Moving Out',
    maintenance: '🔧 Maintenance',
    parking:     '🚗 Parking',
    comms:       '💬 House Comms',
    dispute:     '⚡ Dispute Process',
    head_tenant: '🔑 Head Tenant'
  };
  return icons[category] || category;
}

// Generate plain-text clause list for email
function buildClauseList(clauses) {
  var grouped = {};
  clauses.forEach(function(c) {
    var cat = c.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  var lines = [];
  Object.keys(grouped).forEach(function(cat) {
    lines.push('<tr><td colspan="2" style="padding:12px 0 6px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#888;">' + clauseCategory(cat) + '</td></tr>');
    grouped[cat].forEach(function(c) {
      lines.push(
        '<tr>' +
        '<td style="padding:6px 12px 6px 0;font-size:14px;color:#1a2e3d;vertical-align:top;">✓</td>' +
        '<td style="padding:6px 0;font-size:14px;color:#1a2e3d;line-height:1.5;">' +
          '<strong>' + escapeHtml(c.title) + '</strong>' +
          (c.value ? '<br><span style="color:#555;">' + escapeHtml(c.value) + '</span>' : '') +
        '</td>' +
        '</tr>'
      );
    });
  });
  return lines.join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { email, agreement_id } = req.body || {};

  if (!email || !agreement_id) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Fetch agreement
  const { data: agreement } = await supabase
    .from('household_agreement')
    .select('*')
    .eq('id', agreement_id)
    .maybeSingle();

  if (!agreement) return res.status(404).json({ ok: false, error: 'Agreement not found' });
  if (agreement.locked_at) return res.status(400).json({ ok: false, error: 'Already locked' });

  // Verify requester is a member
  const { data: memberRow } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', agreement.household_id)
    .eq('email', email)
    .maybeSingle();

  if (!memberRow) return res.status(403).json({ ok: false, error: 'Not a member of this household' });

  // Fetch all members
  const { data: membersRows } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', agreement.household_id);

  var memberEmails = (membersRows || []).map(function(m) { return m.email; });

  // Fetch all ticks
  const { data: ticks } = await supabase
    .from('household_agreement_ticks')
    .select('member_email, clause_id')
    .eq('agreement_id', agreement_id);

  var tickSet = {};
  (ticks || []).forEach(function(t) { tickSet[t.member_email + ':' + t.clause_id] = true; });

  var clauses = agreement.clauses || [];
  var clauseIds = clauses.map(function(c) { return c.id; });

  // Verify all members have ticked all clauses
  var allTicked = true;
  var missing = [];
  memberEmails.forEach(function(mem) {
    clauseIds.forEach(function(cid) {
      if (!tickSet[mem + ':' + cid]) {
        allTicked = false;
        missing.push(mem + ' → ' + cid);
      }
    });
  });

  if (!allTicked) {
    return res.status(400).json({
      ok: false,
      error: 'Not all members have ticked all clauses',
      missing: missing.slice(0, 10)
    });
  }

  // Lock the agreement
  var lockedVersion = (agreement.version || 1);
  var lockedAt = new Date().toISOString();

  const { error: lockErr } = await supabase
    .from('household_agreement')
    .update({ locked_at: lockedAt, locked_version: lockedVersion, updated_at: lockedAt })
    .eq('id', agreement_id);

  if (lockErr) {
    console.error('agreement-lock error:', lockErr);
    return res.status(500).json({ ok: false, error: 'Failed to lock agreement' });
  }

  // Send completion email to all members
  var publicUrl = 'https://unirenter.com.au/house-rules/' + agreement.share_token;
  var clauseRows = buildClauseList(clauses);
  var tierNames = { 1: 'Quick Rules', 2: 'House Rules', 3: 'Full House Manual' };
  var tierName = tierNames[agreement.tier] || 'House Rules';

  var emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background:#0d1f2d;padding:28px 32px;text-align:center;">
          <div style="font-family:'Epilogue',sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">UniRenter</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px;">Student Settlement Companion</div>
        </td>
      </tr>
      <!-- Hero -->
      <tr>
        <td style="padding:32px 32px 0;text-align:center;">
          <div style="font-size:40px;margin-bottom:12px;">🏠</div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0d1f2d;">Your household agreement is locked</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.6;">
            Everyone in your household has agreed to the <strong>${escapeHtml(tierName)}</strong>. It's now locked — here's your copy.
          </p>
          <p style="margin:0 0 24px;font-size:12px;color:#888;font-style:italic;line-height:1.5;background:#f9f9f9;padding:12px 16px;border-radius:8px;border-left:3px solid #ddd;">
            This is not a legally binding document. It works because you've all agreed to it — not because of anything written here. If something's not working, talk to each other first.
          </p>
        </td>
      </tr>
      <!-- Clauses -->
      <tr>
        <td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;margin-top:8px;">
            ${clauseRows}
          </table>
        </td>
      </tr>
      <!-- CTA buttons -->
      <tr>
        <td style="padding:0 32px 32px;text-align:center;">
          <a href="${publicUrl}" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-right:12px;">View agreement →</a>
          <a href="/dashboard?tab=household" style="display:inline-block;background:#f0f0f0;color:#333;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">Make changes</a>
        </td>
      </tr>
      <!-- Share with family -->
      <tr>
        <td style="padding:0 32px 20px;border-top:1px solid #f0f0f0;text-align:center;">
          <p style="font-size:12px;color:#999;margin:16px 0 8px;">Share the agreement with parents or family:</p>
          <a href="${publicUrl}" style="font-size:12px;color:#4BBFE0;word-break:break-all;">${publicUrl}</a>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f8f9fa;padding:20px 32px;text-align:center;border-top:1px solid #eee;">
          <p style="font-size:11px;color:#aaa;margin:0;">© UniRenter · Student Settlement Companion · <a href="/legal" style="color:#aaa;">Legal</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Send to all members (fire-and-forget, don't fail lock on email error)
  try {
    for (var i = 0; i < memberEmails.length; i++) {
      await resend.emails.send({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: memberEmails[i],
        bcc: 'benjcarey75@gmail.com',
        subject: 'Your household agreement is locked 🏠',
        html: emailHtml
      });
    }
  } catch (emailErr) {
    console.error('agreement-lock email error:', emailErr);
    // Don't fail — lock succeeded, email is best-effort
  }

  return res.status(200).json({ ok: true, share_token: agreement.share_token });
};
