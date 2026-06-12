// api/email/post-match.js
// Triggered when a student confirms a match connection.
// Sends Email 1 immediately (or after 24hr delay — controlled by `send_after` param).
// Schedules Email 2 by storing a `match_email_2_due_at` timestamp in Supabase.
// CommonJS — no ES module syntax.

const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── HMAC helper for unsubscribe tokens ───────────────────────────────────────
function makeHmacToken(email) {
  const secret = process.env.RESEND_API_KEY || 'ur-secret';
  return crypto.createHmac('sha256', secret).update(email).digest('hex');
}

// ── Emoji pairing one-liners (subset of locked 18×18 matrix) ────────────────
const EMOJI_PAIRS = {
  '🌙+🌙': { result: '😴😴', line: "Two night owls. Nobody's getting woken up at 6am." },
  '🌙+🐦': { result: '🎧', line: "Night owl meets early riser — headphones after 10pm is the classic fix." },
  '🧹+🤷': { result: '🗓️', line: "One neat freak, one relaxed — a Sunday reset roster goes a long way." },
  '🤷+🧹': { result: '🗓️', line: "One relaxed, one neat freak — a Sunday reset roster goes a long way." },
  '🍳+🍳': { result: '🛒', line: "Two home cooks. Agree on grocery sharing early." },
  '📚+📚': { result: '🤫', line: "Both study-focused. The house will be quiet. Good quiet." },
  '🗣️+🚪': { result: '🚦', line: "Social meets private — a heads-up before guests is worth a conversation." },
  '🚪+🗣️': { result: '🚦', line: "Private meets social — a heads-up before guests is worth a conversation." },
  '🏋️+🌙': { result: '⏰🔇', line: "Gym at 6am, still up at midnight — you'll barely overlap." },
  '🌙+🏋️': { result: '⏰🔇', line: "Night owl and a gym regular — you'll barely overlap." },
  '🌍+🌍': { result: '🍜🤝', line: "Two internationals. Cob loves this combination." },
  '🌙+🍳': { result: '🏠✨', line: "Night owl and a home cook — the kitchen's going to be well used." },
  '🍳+🌙': { result: '🏠✨', line: "Home cook and a night owl — the kitchen's going to be well used." },
  '🧹+🧹': { result: '✨✨', line: "Two neat freaks. The place will be immaculate." },
  '🎮+📚': { result: '🎧📖', line: "Gamer meets studier — headphones will be both of your best friends." },
  '📚+🎮': { result: '🎧📖', line: "Studier meets gamer — headphones will be both of your best friends." },
  '🗣️+🗣️': { result: '🎉', line: "Two social ones. The place will never be quiet — that's a good thing." },
  '🏠+🏠': { result: '☕', line: "Two homebodies. Expect a very cosy, low-key house." },
  '🌿+🌿': { result: '🧘', line: "Two chill ones. No drama. Just good vibes." },
};

function getEmojiEquation(userEmoji, matchEmoji) {
  if (!userEmoji || !matchEmoji) return null;
  const key = `${userEmoji}+${matchEmoji}`;
  const pair = EMOJI_PAIRS[key];
  if (pair) return { userEmoji, matchEmoji, result: pair.result, line: pair.line };
  // Fallback generic line using emoji descriptions
  return { userEmoji, matchEmoji, result: '🤠', line: "Cob reckons you two have potential — say hi and find out." };
}

// ── Vibe label lookup (18 palette) ───────────────────────────────────────────
const VIBE_LABELS = {
  '🌙': 'Night owl', '🐦': 'Early riser', '📚': 'Study-focused', '🎓': 'Postgrad',
  '💼': 'Young professional', '🗣️': 'Social & outgoing', '🚪': 'Keeps to themselves',
  '🧹': 'Neat freak', '🤷': 'Relaxed about mess', '🍳': 'Home cook', '🎮': 'Gamer',
  '🎵': 'Music person', '🏋️': 'Gym regular', '🌈': 'LGBTQ+ friendly',
  '🌍': 'International', '👥': 'Loves guests', '🏠': 'Homebody', '🌿': 'Chill / zen',
};

// ── Adaptive Zone 2 blocks ───────────────────────────────────────────────────
function buildZone2Blocks(profile, matchProfile, cityRoot, skipIndices = []) {
  // Priority 1–5 blocks. Returns HTML for the first two that apply and aren't skipped.
  const blocks = [];

  // 1 — Uni email not verified
  if (!profile.uni_email_verified) {
    blocks.push({
      index: 1,
      html: `
        <div style="background:rgba(75,191,224,0.08);border:1px solid rgba(75,191,224,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;color:#4BBFE0;margin-bottom:6px;">🎓 Get your uni verified badge</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Verify your uni email and get your 🎓 badge — it shows other students you're the real deal.</div>
          <a href="https://unirenter.com.au/dashboard?action=verify-uni" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Verify my uni email →</a>
        </div>`
    });
  }

  // 2 — No household set up
  const matchName = matchProfile ? matchProfile.name || 'your match' : 'your match';
  if (true) { // always offer household — it's new
    blocks.push({
      index: 2,
      html: `
        <div style="background:rgba(245,184,0,0.06);border:1px solid rgba(245,184,0,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;color:#F5B800;margin-bottom:6px;">🏠 Build your household profile</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Ready to build your household profile with ${matchName}? You can set up your household first, or jump straight to generating an invite link — either way Cob will walk you through it.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Set up my household →</a>
            <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:transparent;color:#F5B800;font-size:13px;font-weight:600;padding:8px 16px;border-radius:6px;text-decoration:none;border:1px solid rgba(245,184,0,0.3);">Generate invite link for ${matchName} →</a>
          </div>
          <div style="font-size:20px;margin-top:10px;opacity:0.8;">🏠 + 👥 = 🤠</div>
        </div>`
    });
  }

  // 3 — Lease companion not set up
  blocks.push({
    index: 3,
    html: `
      <div style="background:rgba(61,170,92,0.06);border:1px solid rgba(61,170,92,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#3DAA5C;margin-bottom:6px;">📋 Set up your lease timeline</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Moving in soon? Let Cob handle your tenancy timeline — condition report deadline, inspection schedule, notice period, lease end date. Takes 30 seconds.</div>
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#3DAA5C;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Set up your lease with Cob →</a>
      </div>`
  });

  // 4 — Vibe not complete
  if (!profile.vibe_emoji_primary) {
    blocks.push({
      index: 4,
      html: `
        <div style="background:rgba(232,98,58,0.06);border:1px solid rgba(232,98,58,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;color:#E8623A;margin-bottom:6px;">✨ Finish your vibe</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">You haven't finished your vibe yet. Let Cob write your personality portrait.</div>
          <a href="https://unirenter.com.au/dashboard?tab=profile&action=vibe" style="display:inline-block;background:#E8623A;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Let Cob write your vibe →</a>
        </div>`
    });
  }

  // 5 — Calendar empty
  blocks.push({
    index: 5,
    html: `
      <div style="background:rgba(75,191,224,0.05);border:1px solid rgba(75,191,224,0.1);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#4BBFE0;margin-bottom:6px;">📅 Add your move-in date</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Add your move-in date and Cob will remind you about all the key moments.</div>
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Open my calendar →</a>
      </div>`
    });

  // Filter out skipped indices, return first two
  return blocks.filter(b => !skipIndices.includes(b.index)).slice(0, 2);
}

// ── Email HTML builder ───────────────────────────────────────────────────────
function buildEmail1Html({ name, matchName, matchUni, score, suburb, userEmoji, matchEmoji, zone2Blocks, unsubToken }) {
  const equation = getEmojiEquation(userEmoji, matchEmoji);
  const vibeLabel = userEmoji ? VIBE_LABELS[userEmoji] || '' : '';
  const matchVibeLabel = matchEmoji ? VIBE_LABELS[matchEmoji] || '' : '';

  const equationBlock = equation ? `
    <div style="margin:16px 0;padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:2px solid rgba(245,184,0,0.3);">
      <div style="font-size:22px;letter-spacing:4px;margin-bottom:6px;">${equation.userEmoji} + ${equation.matchEmoji} = ${equation.result}</div>
      <div style="font-size:13px;color:#a0bccf;font-style:italic;">${equation.line}</div>
    </div>` : '';

  const descLine = (vibeLabel && matchVibeLabel)
    ? `Two ${vibeLabel.toLowerCase()} types in ${suburb || 'the same city'}.`
    : `in ${suburb || 'the same city'}.`;

  const zone2Html = zone2Blocks.map(b => b.html).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${name}! Looks like you found your person 🤠</title>
</head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;color:#e8f0f5;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="text-align:center;padding:24px 0 8px;">
      <div style="font-size:28px;font-weight:800;color:#e8f0f5;letter-spacing:-0.5px;">UniRenter</div>
      <div style="font-size:12px;color:#7a96aa;margin-top:4px;">Free for students in Australia</div>
    </div>

    <!-- Main card -->
    <div style="background:#162535;border-radius:16px;padding:28px 24px;margin:16px 0;">
      <div style="font-size:24px;margin-bottom:4px;">🤠</div>
      <div style="font-size:22px;font-weight:700;margin-bottom:16px;color:#e8f0f5;">Ay ${name}!</div>

      <div style="font-size:15px;line-height:1.7;margin-bottom:8px;color:#c8dde8;">
        You matched with <strong style="color:#F5B800;">${matchName}</strong> from ${matchUni} — <strong>${score}%</strong> compatibility. ${descLine} Cob reckons you'll get along.
      </div>

      ${equationBlock}

      <a href="https://unirenter.com.au/dashboard?tab=matches" style="display:block;text-align:center;background:#F5B800;color:#0d1f2d;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:20px;">View your match →</a>
    </div>

    <!-- Zone 2: Adaptive nudges -->
    ${zone2Html ? `<div style="margin:8px 0;">${zone2Html}</div>` : ''}

    <!-- Dashboard CTA -->
    <div style="text-align:center;margin:20px 0 8px;">
      <a href="https://unirenter.com.au/dashboard" style="display:inline-block;background:transparent;color:#4BBFE0;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;border:1px solid rgba(75,191,224,0.25);">Go to my dashboard →</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0 8px;border-top:1px solid rgba(255,255,255,0.07);margin-top:20px;">
      <div style="font-size:11px;color:#4a6272;line-height:1.8;">
        Cob 🤠 · UniRenter · Free for students in Australia<br>
        <a href="https://unirenter.com.au/unsubscribe?token=${unsubToken}&email=${encodeURIComponent('')}" style="color:#4a6272;">Want to opt out? Click here and Cob will take care of it.</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}

function buildEmail2Html({ name, matchName, matchUni, score, zone2Block, unsubToken, email }) {
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(email)}`;
  const zone2Html = zone2Block ? zone2Block.html : '';

  const starLinks = [1,2,3,4,5].map(n =>
    `<a href="https://unirenter.com.au/review?rating=${n}&email=${encodeURIComponent(email)}&token=${makeHmacToken(email+':review')}" style="display:inline-block;margin:0 3px;font-size:24px;text-decoration:none;" title="${n} star${n>1?'s':''}">${'⭐'.repeat(n)}</a>`
  ).join('<br style="display:none;">');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${name}! One week in — how's it going? 🤠</title>
</head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;color:#e8f0f5;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">

    <div style="text-align:center;padding:24px 0 8px;">
      <div style="font-size:28px;font-weight:800;color:#e8f0f5;letter-spacing:-0.5px;">UniRenter</div>
      <div style="font-size:12px;color:#7a96aa;margin-top:4px;">Free for students in Australia</div>
    </div>

    <div style="background:#162535;border-radius:16px;padding:28px 24px;margin:16px 0;">
      <div style="font-size:24px;margin-bottom:4px;">🤠</div>
      <div style="font-size:22px;font-weight:700;margin-bottom:16px;color:#e8f0f5;">Ay ${name}!</div>
      <div style="font-size:15px;line-height:1.7;margin-bottom:8px;color:#c8dde8;">
        It's been a week since you matched with <strong style="color:#F5B800;">${matchName}</strong>. Hope the move is coming together.
      </div>
      <div style="font-size:20px;margin:14px 0 6px;opacity:0.8;">📅 + 7 = 🏠</div>
    </div>

    <!-- Zone 2: one remaining nudge -->
    ${zone2Html ? `<div style="margin:8px 0;">${zone2Html}</div>` : ''}

    <!-- Review ask -->
    <div style="background:#162535;border-radius:16px;padding:24px;margin:8px 0;text-align:center;">
      <div style="font-size:15px;font-weight:600;margin-bottom:16px;color:#e8f0f5;">Quick one — how would you rate UniRenter so far?</div>
      <div style="display:flex;justify-content:center;gap:4px;font-size:28px;flex-wrap:wrap;">
        <a href="https://unirenter.com.au/review?rating=1&email=${encodeURIComponent(email)}&token=${makeHmacToken(email+':review')}" style="text-decoration:none;font-size:28px;" title="1 star">⭐</a>
        <a href="https://unirenter.com.au/review?rating=2&email=${encodeURIComponent(email)}&token=${makeHmacToken(email+':review')}" style="text-decoration:none;font-size:28px;" title="2 stars">⭐⭐</a>
        <a href="https://unirenter.com.au/review?rating=3&email=${encodeURIComponent(email)}&token=${makeHmacToken(email+':review')}" style="text-decoration:none;font-size:28px;" title="3 stars">⭐⭐⭐</a>
        <a href="https://unirenter.com.au/review?rating=4&email=${encodeURIComponent(email)}&token=${makeHmacToken(email+':review')}" style="text-decoration:none;font-size:28px;" title="4 stars">⭐⭐⭐⭐</a>
        <a href="https://unirenter.com.au/review?rating=5&email=${encodeURIComponent(email)}&token=${makeHmacToken(email+':review')}" style="text-decoration:none;font-size:28px;" title="5 stars">⭐⭐⭐⭐⭐</a>
      </div>
    </div>

    <!-- Share -->
    <div style="background:#162535;border-radius:16px;padding:20px 24px;margin:8px 0;text-align:center;">
      <div style="font-size:14px;color:#c8dde8;margin-bottom:12px;">Know another student looking for a place? The more students who join, the better everyone's matches get.</div>
      <a href="https://unirenter.com.au" style="display:inline-block;background:transparent;color:#4BBFE0;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none;border:1px solid rgba(75,191,224,0.25);margin-right:8px;">Share UniRenter →</a>
      <div style="font-size:20px;margin-top:10px;opacity:0.8;">🤠 + 📢 = 🏠🏠🏠</div>
    </div>

    <div style="text-align:center;margin:16px 0 8px;">
      <a href="https://unirenter.com.au/dashboard" style="display:inline-block;background:transparent;color:#4BBFE0;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;border:1px solid rgba(75,191,224,0.25);">Go to my dashboard →</a>
    </div>

    <div style="text-align:center;padding:20px 0 8px;border-top:1px solid rgba(255,255,255,0.07);margin-top:20px;">
      <div style="font-size:11px;color:#4a6272;line-height:1.8;">
        Cob 🤠 · UniRenter · Free for students in Australia<br>
        <a href="${unsubUrl}" style="color:#4a6272;">Want to opt out? Click here and Cob will take care of it.</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, match_email, match_name, match_uni, score, suburb, email_number } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  // ── Fetch sender profile ──────────────────────────────────────────────────
  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (profileErr || !profileRow) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  // ── Suppression checks ────────────────────────────────────────────────────
  if (profileRow.email_unsubscribed) {
    return res.status(200).json({ suppressed: true, reason: 'unsubscribed' });
  }
  if (!profileRow.email_verified) {
    return res.status(200).json({ suppressed: true, reason: 'email_not_verified' });
  }

  const firstName = (profileRow.name || email.split('@')[0] || 'hey').split(' ')[0];
  const unsubToken = makeHmacToken(email);
  const emailNum = email_number || 1;

  // ── Email 1 ───────────────────────────────────────────────────────────────
  if (emailNum === 1) {
    // Check not already sent
    if (profileRow.match_email_1_sent_at) {
      return res.status(200).json({ suppressed: true, reason: 'email_1_already_sent' });
    }

    const zone2Blocks = buildZone2Blocks(profileRow, { name: match_name }, '', []);
    const html = buildEmail1Html({
      name: firstName,
      matchName: match_name || 'your match',
      matchUni: match_uni || 'your match\'s uni',
      score: score || '—',
      suburb: suburb || '',
      userEmoji: profileRow.vibe_emoji_primary || null,
      matchEmoji: null, // match emoji passed if available
      zone2Blocks,
      unsubToken,
    });

    try {
      await resend.emails.send({
        from: 'Cob from UniRenter <noreply@unirenter.com.au>',
        to: email,
        bcc: 'benjcarey75@gmail.com',
        subject: `Ay ${firstName}! Looks like you found your person 🤠`,
        html,
      });

      // Mark sent + store which zone2 indices were used
      const usedIndices = zone2Blocks.map(b => b.index);
      await supabase.from('profiles').update({
        match_email_1_sent_at: new Date().toISOString(),
        match_email_2_due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        match_email_1_zone2_indices: usedIndices,
      }).eq('email', email);

      return res.status(200).json({ sent: true, email_number: 1 });
    } catch (err) {
      console.error('Email 1 send error:', err);
      return res.status(500).json({ error: 'Failed to send email', detail: err.message });
    }
  }

  // ── Email 2 (7 days) ──────────────────────────────────────────────────────
  if (emailNum === 2) {
    if (profileRow.match_email_2_sent_at) {
      return res.status(200).json({ suppressed: true, reason: 'email_2_already_sent' });
    }

    // Show whichever zone2 block was NOT shown in Email 1
    const usedInEmail1 = profileRow.match_email_1_zone2_indices || [];
    const allZone2 = buildZone2Blocks(profileRow, { name: match_name }, '', []);
    const remainingBlock = allZone2.find(b => !usedInEmail1.includes(b.index)) || null;

    const html = buildEmail2Html({
      name: firstName,
      matchName: match_name || 'your match',
      matchUni: match_uni || '',
      score: score || '',
      zone2Block: remainingBlock,
      unsubToken,
      email,
    });

    try {
      await resend.emails.send({
        from: 'Cob from UniRenter <noreply@unirenter.com.au>',
        to: email,
        bcc: 'benjcarey75@gmail.com',
        subject: `Ay ${firstName}! One week in — how's it going? 🤠`,
        html,
      });

      await supabase.from('profiles').update({
        match_email_2_sent_at: new Date().toISOString(),
      }).eq('email', email);

      return res.status(200).json({ sent: true, email_number: 2 });
    } catch (err) {
      console.error('Email 2 send error:', err);
      return res.status(500).json({ error: 'Failed to send email', detail: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid email_number — must be 1 or 2' });
};
