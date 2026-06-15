// api/email/test.js
// POST /api/email/test
// Fires sample post-match emails directly to benjcarey75@gmail.com for review.
// Protected by ADMIN_TOKEN_SECRET header — never callable by students.
// Body: { email_number: 1 | 2 | 3 }  — send all three by omitting email_number.
// Does NOT write to Supabase — purely for copy/formatting review.
// CommonJS — no ES module syntax.

const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);
const TEST_TO = 'benjcarey75@gmail.com';

// ── Auth ──────────────────────────────────────────────────────────────────────
function isAuthorised(req) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  const provided = req.headers['x-audit-secret'] || req.headers['x-admin-secret'];
  return secret && provided && provided === secret;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeHmacToken(email) {
  const secret = process.env.RESEND_API_KEY || 'ur-secret';
  return crypto.createHmac('sha256', secret).update(email).digest('hex');
}

// ── Sample data ───────────────────────────────────────────────────────────────
const SAMPLE = {
  name:       'Alex',
  email:      TEST_TO,
  matchName:  'Priya',
  matchUni:   'University of Melbourne',
  score:      94,
  suburb:     'Fitzroy',
  userEmoji:  '🌙',
  matchEmoji: '📚',
  unsubToken: makeHmacToken(TEST_TO),
  city:       'melbourne',
};

// ── Zone 2 blocks (inline — mirrors post-match logic) ─────────────────────────
function buildZone2Blocks(skipIndices = []) {
  const all = [
    {
      index: 1,
      html: `
        <div style="background:#1a3347;border-radius:10px;padding:16px 20px;margin:12px 0">
          <div style="font-size:13px;font-weight:700;color:#F5B800;margin-bottom:6px">🎓 Verify your uni email</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px">Verify your uni email and earn your 🎓 badge — it shows other students you're the real deal.</div>
          <a href="https://unirenter.com.au/dashboard?action=verify-uni" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none">Verify my uni email →</a>
        </div>`
    },
    {
      index: 2,
      html: `
        <div style="background:#1a3347;border-radius:10px;padding:16px 20px;margin:12px 0">
          <div style="font-size:13px;font-weight:700;color:#F5B800;margin-bottom:6px">📋 Set up your tenancy timeline</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px">Moving in soon? Snap a photo of your lease and Cob sets up your full tenancy timeline — condition report deadline, inspection schedule, notice period, bond claim window.</div>
          <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none">Set up my timeline →</a>
        </div>`
    },
    {
      index: 3,
      html: `
        <div style="background:#1a3347;border-radius:10px;padding:16px 20px;margin:12px 0">
          <div style="font-size:13px;font-weight:700;color:#F5B800;margin-bottom:6px">🏠 Post a Flatmate Wanted listing</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px">Found a place? Post a Flatmate Wanted listing and let UniRenter find your third housemate — same matching, same vibe check.</div>
          <a href="https://unirenter.com.au/dashboard?tab=matches&action=listing" style="display:inline-block;background:#3DAA5C;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none">Create my listing →</a>
        </div>`
    },
  ];
  return all.filter(b => !skipIndices.includes(b.index));
}

// ── Email 1 HTML ──────────────────────────────────────────────────────────────
function buildEmail1Html(d) {
  const zone2Html = buildZone2Blocks([]).slice(0, 2).map(b => b.html).join('');
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${d.unsubToken}&email=${encodeURIComponent(d.email)}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${d.name}! Looks like you found your person 🤠</title></head>
<body style="margin:0;padding:0;background:#0a1929;font-family:Inter,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:24px">
    <span style="font-size:28px;font-weight:800;color:#F5B800;font-family:Epilogue,sans-serif">UniRenter</span>
  </div>
  <div style="background:#0d1f2d;border-radius:16px;padding:28px 24px;margin-bottom:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:16px;color:#e8f0f5">Ay ${d.name}!</div>
    <div style="font-size:15px;color:#c0d4e0;line-height:1.7;margin-bottom:20px">
      You matched with <strong style="color:#F5B800">${d.matchName}</strong> from ${d.matchUni} — <strong>${d.score}%</strong> compatibility.
      Two ${d.userEmoji === d.matchEmoji ? 'similar' : 'complementary'} types in ${d.suburb}. Cob reckons you'll get along.
    </div>
    <div style="background:#1a3347;border-radius:10px;padding:16px 20px;margin-bottom:20px;text-align:center">
      <div style="font-size:32px;margin-bottom:4px">${d.userEmoji} + ${d.matchEmoji} = 🤝</div>
      <div style="font-size:13px;color:#8aa8be">Vibe compatibility</div>
    </div>
    <a href="https://unirenter.com.au/dashboard?tab=messages" style="display:block;text-align:center;background:#F5B800;color:#0d1f2d;font-size:15px;font-weight:700;padding:14px 24px;border-radius:8px;text-decoration:none;margin-bottom:20px">
      Message ${d.matchName} →
    </a>
    ${zone2Html}
  </div>
  <div style="text-align:center;font-size:11px;color:#4a6275;margin-top:16px">
    UniRenter · Student housing, sorted · <a href="${unsubUrl}" style="color:#4a6275">Unsubscribe</a>
  </div>
  <div style="text-align:center;font-size:10px;color:#2a4255;margin-top:4px">⚠️ TEST EMAIL — Email 1 of 3</div>
</div>
</body></html>`;
}

// ── Email 2 HTML ──────────────────────────────────────────────────────────────
function buildEmail2Html(d) {
  const zone2Html = buildZone2Blocks([1]).slice(0, 1).map(b => b.html).join('');
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${d.unsubToken}&email=${encodeURIComponent(d.email)}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${d.name}! One week in — how's it going? 🤠</title></head>
<body style="margin:0;padding:0;background:#0a1929;font-family:Inter,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:24px">
    <span style="font-size:28px;font-weight:800;color:#F5B800;font-family:Epilogue,sans-serif">UniRenter</span>
  </div>
  <div style="background:#0d1f2d;border-radius:16px;padding:28px 24px;margin-bottom:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:16px;color:#e8f0f5">Ay ${d.name}! One week in 🤠</div>
    <div style="font-size:15px;color:#c0d4e0;line-height:1.7;margin-bottom:20px">
      Just checking in — how's it going with <strong style="color:#F5B800">${d.matchName}</strong>?
      If you've sorted a place, nice work. If you're still looking, no stress — your profile is still active and matches are still coming in.
    </div>
    <a href="https://unirenter.com.au/dashboard?tab=messages" style="display:block;text-align:center;background:#F5B800;color:#0d1f2d;font-size:15px;font-weight:700;padding:14px 24px;border-radius:8px;text-decoration:none;margin-bottom:20px">
      Check your messages →
    </a>
    ${zone2Html}
  </div>
  <div style="text-align:center;font-size:11px;color:#4a6275;margin-top:16px">
    UniRenter · Student housing, sorted · <a href="${unsubUrl}" style="color:#4a6275">Unsubscribe</a>
  </div>
  <div style="text-align:center;font-size:10px;color:#2a4255;margin-top:4px">⚠️ TEST EMAIL — Email 2 of 3</div>
</div>
</body></html>`;
}

// ── Email 3 HTML ──────────────────────────────────────────────────────────────
function buildEmail3Html(d) {
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${d.unsubToken}&email=${encodeURIComponent(d.email)}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${d.name}! Two weeks in — Cob checking in 🤠</title></head>
<body style="margin:0;padding:0;background:#0a1929;font-family:Inter,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:24px">
    <span style="font-size:28px;font-weight:800;color:#F5B800;font-family:Epilogue,sans-serif">UniRenter</span>
  </div>
  <div style="background:#0d1f2d;border-radius:16px;padding:28px 24px;margin-bottom:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:16px;color:#e8f0f5">Ay ${d.name}! Two weeks in 🤠</div>
    <div style="font-size:15px;color:#c0d4e0;line-height:1.7;margin-bottom:20px">
      Two weeks since you matched with <strong style="color:#F5B800">${d.matchName}</strong>. Cob's just checking in.
      If you've moved in together — ripper. Here's a few things worth setting up now you're in the door.
    </div>
    <div style="margin-bottom:20px">
      <div style="background:#1a3347;border-radius:10px;padding:16px 20px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:#F5B800;margin-bottom:6px">📋 Set up your household agreement</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:10px">Bills, chores, guests, quiet hours — get it in writing early and you'll avoid 90% of share house arguments.</div>
        <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none">Set up household →</a>
      </div>
      <div style="background:#1a3347;border-radius:10px;padding:16px 20px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:#F5B800;margin-bottom:6px">🔑 Know your tenancy rights</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:10px">Bond, condition reports, repairs, inspections — Cob can walk you through all of it. Ask anything in the dashboard.</div>
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none">View my tenancy →</a>
      </div>
      <div style="background:#1a3347;border-radius:10px;padding:16px 20px">
        <div style="font-size:13px;font-weight:700;color:#F5B800;margin-bottom:6px">⭐ How was your experience?</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:10px">Leave a quick review — it helps other students find UniRenter and takes 30 seconds.</div>
        <a href="https://unirenter.com.au/review?rating=5" style="display:inline-block;background:#3DAA5C;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none">Leave a review →</a>
      </div>
    </div>
  </div>
  <div style="text-align:center;font-size:11px;color:#4a6275;margin-top:16px">
    UniRenter · Student housing, sorted · <a href="${unsubUrl}" style="color:#4a6275">Unsubscribe</a>
  </div>
  <div style="text-align:center;font-size:10px;color:#2a4255;margin-top:4px">⚠️ TEST EMAIL — Email 3 of 3</div>
</div>
</body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-audit-secret, x-admin-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!isAuthorised(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorised' });
  }

  const { email_number } = req.body || {};
  const toSend = email_number ? [Number(email_number)] : [1, 2, 3];
  const results = [];

  for (const n of toSend) {
    let html, subject;
    if (n === 1) {
      html    = buildEmail1Html(SAMPLE);
      subject = `⚠️ TEST — Email 1: Ay ${SAMPLE.name}! Looks like you found your person 🤠`;
    } else if (n === 2) {
      html    = buildEmail2Html(SAMPLE);
      subject = `⚠️ TEST — Email 2: Ay ${SAMPLE.name}! One week in — how's it going? 🤠`;
    } else if (n === 3) {
      html    = buildEmail3Html(SAMPLE);
      subject = `⚠️ TEST — Email 3: Ay ${SAMPLE.name}! Two weeks in — Cob checking in 🤠`;
    } else {
      results.push({ email_number: n, ok: false, error: 'Invalid email_number' });
      continue;
    }

    try {
      await resend.emails.send({
        from:    'Cob from UniRenter <noreply@unirenter.com.au>',
        to:      TEST_TO,
        subject,
        html,
      });
      results.push({ email_number: n, ok: true, to: TEST_TO });
    } catch (err) {
      console.error(`Test email ${n} error:`, err);
      results.push({ email_number: n, ok: false, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, results });
};
