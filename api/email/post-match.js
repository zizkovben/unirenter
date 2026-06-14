// api/email/post-match.js
// Triggered when a student confirms a match connection.
// Sends Email 1 immediately (or after 24hr delay — controlled by `send_after` param).
// Schedules Email 2 by storing a `match_email_2_due_at` timestamp in Supabase.
// CommonJS — no ES module syntax.
// Updated S55: /lease-companion → /dashboard?tab=tenancy, fresher copy,
//   Flatmate Wanted added as Priority 3, household agreement nudge in Email 3.

const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── HMAC helper ───────────────────────────────────────────────────────────────
function makeHmacToken(email) {
  const secret = process.env.RESEND_API_KEY || 'ur-secret';
  return crypto.createHmac('sha256', secret).update(email).digest('hex');
}

// ── Emoji pairing one-liners ──────────────────────────────────────────────────
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

// ── Secondary vibe pairs (S60) ─────────────────────────────────────────────
const SECONDARY_PAIRS = {
  // Identical pairs
  '☕+☕': { eq:'☕☕', line:'Two coffee people. The kitchen kettle is going to work hard.' },
  '💻+💻': { eq:'💻💻', line:'Both work-from-home types. Call time boundaries will matter.' },
  '🌱+🌱': { eq:'🥗', line:'Two plant-based housemates. The fridge is sorted.' },
  '🐶+🐶': { eq:'🐾🐾', line:'Two dog owners. The walk roster writes itself.' },
  '🐱+🐱': { eq:'🐱🐱', line:'Two cat people. The apartment will be very well supervised.' },
  '🎨+🎨': { eq:'🎨✨', line:'Two creative types. The place will feel alive.' },
  '🧘+🧘': { eq:'🧘✨', line:'Two into wellness. Very zen household.' },
  '🍺+🍺': { eq:'🍻', line:'Both like a beer. Social dynamic sorted.' },
  '✈️+✈️': { eq:'🗺️', line:'Two travellers. You will understand each other\'s disappearing acts.' },
  '💑+💑': { eq:'💑💑', line:'Both in relationships. Partners will be around — good to know.' },
  // Complementary pairs
  '🌱+🍖': { eq:'🍽️', line:'Plant-based and meat-eater — the kitchen handles both.' },
  '🍖+🌱': { eq:'🍽️', line:'Meat-eater and plant-based — the kitchen handles both.' },
  '💻+🌿': { eq:'💻🌿', line:'Work-from-home meets chill vibes. Good energy.' },
  '🌿+💻': { eq:'🌿💻', line:'Chill energy meets work-from-home. Good energy.' },
  '☕+🌿': { eq:'☕🌿', line:'Coffee person meets chill one. Slow mornings ahead.' },
  '🌿+☕': { eq:'🌿☕', line:'Chill one meets coffee person. Slow mornings ahead.' },
  '🐶+🐱': { eq:'🐾🐱', line:'Dog and cat owner. The house will be lively.' },
  '🐱+🐶': { eq:'🐱🐾', line:'Cat and dog owner. The house will be lively.' },
  '🍺+💻': { eq:'🍺💻', line:'One switches off with a beer, one with work. Compatible enough.' },
  '💻+🍺': { eq:'💻🍺', line:'Work-from-home type meets the after-work beer. Fine balance.' },
  '✈️+💻': { eq:'✈️💻', line:'Traveller meets remote worker. Both understand flexibility.' },
  '💻+✈️': { eq:'💻✈️', line:'Remote worker meets traveller. Both understand flexibility.' },
  '🧘+💑': { eq:'🧘💑', line:'Wellness-focused and couple life. Calm household.' },
  '💑+🧘': { eq:'💑🧘', line:'Couple life meets wellness-focused. Calm household.' },
  // Honest tension pairs
  '🍺+🧘': { eq:'⚖️', line:'Beer and wellness — two very different definitions of unwinding.' },
  '🧘+🍺': { eq:'⚖️', line:'Wellness and beer — worth a conversation about noise levels.' },
  '👶+✈️': { eq:'⏳', line:'Baby and a traveller — lifestyles are very different, but workable.' },
  '✈️+👶': { eq:'⏳', line:'Traveller and a new parent — very different rhythms, but workable.' },
  '🍺+👶': { eq:'💬', line:'Party mode and baby mode — definitely have the conversation.' },
  '👶+🍺': { eq:'💬', line:'Baby mode and party mode — definitely have the conversation.' },
};

function getSecondaryEquation(userSec, matchSec) {
  if (!userSec || !matchSec) return null;
  const key = `${userSec}+${matchSec}`;
  if (SECONDARY_PAIRS[key]) return { result: SECONDARY_PAIRS[key].eq, line: SECONDARY_PAIRS[key].line };
  if (userSec === matchSec) return { result: userSec + userSec, line: 'You\'ve both got the same secondary vibe.' };
  return null;
}

function getEmojiEquation(userEmoji, matchEmoji) {
  if (!userEmoji || !matchEmoji) return null;
  const key = `${userEmoji}+${matchEmoji}`;
  const pair = EMOJI_PAIRS[key];
  if (pair) return { userEmoji, matchEmoji, result: pair.result, line: pair.line };
  return { userEmoji, matchEmoji, result: '🤠', line: "Cob reckons you two have potential — say hi and find out." };
}

// ── Vibe label lookup ─────────────────────────────────────────────────────────
const VIBE_LABELS = {
  '🌙': 'Night owl', '🐦': 'Early riser', '📚': 'Study-focused', '🎓': 'Postgrad',
  '💼': 'Young professional', '🗣️': 'Social & outgoing', '🚪': 'Keeps to themselves',
  '🧹': 'Neat freak', '🤷': 'Relaxed about mess', '🍳': 'Home cook', '🎮': 'Gamer',
  '🎵': 'Music person', '🏋️': 'Gym regular', '🌈': 'LGBTQ+ friendly',
  '🌍': 'International', '👥': 'Loves guests', '🏠': 'Homebody', '🌿': 'Chill / zen',
};

// ── Adaptive Zone 2 blocks ────────────────────────────────────────────────────
// Priority order (S55 updated):
//   1 — Uni email not verified
//   2 — No household set up (always offered — core feature post-match)
//   3 — No Flatmate Wanted listing posted (new — good post-match action)
//   4 — Lease Companion / tenancy calendar not set up (now in dashboard Tenancy tab)
//   5 — Vibe quiz not complete (freshened copy — Cob writes your profile)
//   6 — Calendar empty / move-in date not added
//
function buildZone2Blocks(profile, matchProfile, cityRoot, skipIndices = []) {
  const blocks = [];
  const matchName = matchProfile ? matchProfile.name || 'your match' : 'your match';

  // 1 — Uni email verify
  if (!profile.uni_email_verified) {
    blocks.push({
      index: 1,
      html: `
        <div style="background:rgba(75,191,224,0.08);border:1px solid rgba(75,191,224,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;color:#4BBFE0;margin-bottom:6px;">🎓 Get your uni verified badge</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Verify your uni email and earn your 🎓 badge — it shows other students you're the real deal and builds trust on the break lease board too.</div>
          <a href="https://unirenter.com.au/dashboard?action=verify-uni" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Verify my uni email →</a>
        </div>`
    });
  }

  // 2 — Household setup (always offered post-match — core feature)
  blocks.push({
    index: 2,
    html: `
      <div style="background:rgba(245,184,0,0.06);border:1px solid rgba(245,184,0,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#F5B800;margin-bottom:6px;">🏠 Set up your household with ${matchName}</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Cob can build your compatibility profile, generate an invite link for ${matchName}, and help you set up house rules before anyone moves in. Takes about 2 minutes.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Set up my household →</a>
          <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:transparent;color:#F5B800;font-size:13px;font-weight:600;padding:8px 16px;border-radius:6px;text-decoration:none;border:1px solid rgba(245,184,0,0.3);">Invite ${matchName} →</a>
        </div>
        <div style="font-size:20px;margin-top:10px;opacity:0.8;">🏠 + 👥 = 🤠</div>
      </div>`
  });

  // 3 — Flatmate Wanted listing (new in S55 priority list)
  blocks.push({
    index: 3,
    html: `
      <div style="background:rgba(61,170,92,0.06);border:1px solid rgba(61,170,92,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#3DAA5C;margin-bottom:6px;">📢 Post a Flatmate Wanted listing</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Got a room or a place sorted? Post a free Flatmate Wanted listing and let other students find you — Cob generates a shareable link you can post anywhere.</div>
        <a href="https://unirenter.com.au/dashboard?tab=matches&action=listing" style="display:inline-block;background:#3DAA5C;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Create my listing →</a>
        <div style="font-size:20px;margin-top:10px;opacity:0.8;">📢 + 🏠 = ✅</div>
      </div>`
  });

  // 4 — Lease Companion / tenancy calendar (updated: now in dashboard Tenancy tab)
  blocks.push({
    index: 4,
    html: `
      <div style="background:rgba(75,191,224,0.05);border:1px solid rgba(75,191,224,0.1);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#4BBFE0;margin-bottom:6px;">📋 Set up your tenancy calendar</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Moving in soon? Snap a photo of your lease and Cob sets up your full tenancy timeline — condition report deadline, inspection schedule, notice period, bond claim window. Takes 30 seconds.</div>
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Set up my tenancy calendar →</a>
        <div style="font-size:20px;margin-top:10px;opacity:0.8;">📋 + ⏰ = ✅</div>
      </div>`
  });

  // 5 — Vibe quiz not complete (freshened: positions as Cob writing your profile)
  if (!profile.vibe_emoji_primary) {
    blocks.push({
      index: 5,
      html: `
        <div style="background:rgba(232,98,58,0.06);border:1px solid rgba(232,98,58,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;color:#E8623A;margin-bottom:6px;">✨ Let Cob write your housemate profile</div>
          <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Answer 6 quick questions about your home life and Cob writes a short personality portrait — shown to potential housemates so they get a real sense of you beyond checkboxes. It also unlocks your emoji equation on match cards.</div>
          <a href="https://unirenter.com.au/dashboard?tab=profile&action=vibe" style="display:inline-block;background:#E8623A;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Let Cob write my vibe →</a>
          <div style="font-size:20px;margin-top:10px;opacity:0.8;">🤠 + ✍️ = 🌟</div>
        </div>`
    });
  }

  // 6 — Calendar / move-in date empty
  blocks.push({
    index: 6,
    html: `
      <div style="background:rgba(245,184,0,0.04);border:1px solid rgba(245,184,0,0.1);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#F5B800;margin-bottom:6px;">📅 Add your move-in date</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Add your move-in date and Cob will remind you about lease deadlines, inspections, and bond claim windows — the dates that actually cost you money if you miss them.</div>
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Open my calendar →</a>
      </div>`
  });

  return blocks.filter(b => !skipIndices.includes(b.index)).slice(0, 2);
}

// ── Email 1 HTML builder ──────────────────────────────────────────────────────
function buildEmail1Html({ name, matchName, matchUni, score, suburb, userEmoji, matchEmoji, userSecondary, matchSecondary, zone2Blocks, unsubToken, email }) {
  const equation = getEmojiEquation(userEmoji, matchEmoji);
  const vibeLabel = userEmoji ? VIBE_LABELS[userEmoji] || '' : '';
  const matchVibeLabel = matchEmoji ? VIBE_LABELS[matchEmoji] || '' : '';

  const equationBlock = equation ? `
    <div style="margin:16px 0;padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:2px solid rgba(245,184,0,0.3);">
      <div style="font-size:22px;letter-spacing:4px;margin-bottom:6px;">${equation.userEmoji} + ${equation.matchEmoji} = ${equation.result}</div>
      <div style="font-size:13px;color:#a0bccf;font-style:italic;">${equation.line}</div>
    </div>` : '';

  const secEq = getSecondaryEquation(userSecondary || null, matchSecondary || null);
  const secondaryEquationBlock = (secEq && equation) ? `
    <div style="margin:-8px 0 16px;padding:10px 16px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:2px solid rgba(255,255,255,0.08);">
      <span style="font-size:10px;color:rgba(255,255,255,0.3);margin-right:4px;">also:</span>
      <span style="font-size:16px;letter-spacing:3px;">${userSecondary} + ${matchSecondary} = ${secEq.result}</span>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);font-style:italic;margin-top:3px;">${secEq.line}</div>
    </div>` : '';

  const descLine = (vibeLabel && matchVibeLabel)
    ? `Two ${vibeLabel.toLowerCase()} types in ${suburb || 'the same city'}.`
    : `in ${suburb || 'the same city'}.`;

  const zone2Html = zone2Blocks.map(b => b.html).join('');
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(email || '')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${name}! Looks like you found your person 🤠</title>
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
        You matched with <strong style="color:#F5B800;">${matchName}</strong> from ${matchUni} — <strong>${score}%</strong> compatibility. ${descLine} Cob reckons you'll get along.
      </div>
      ${equationBlock}
      ${secondaryEquationBlock}
      <a href="https://unirenter.com.au/dashboard?tab=matches" style="display:block;text-align:center;background:#F5B800;color:#0d1f2d;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:20px;">View my match →</a>
    </div>

    ${zone2Html ? `<div style="margin:8px 0;">${zone2Html}</div>` : ''}

    <div style="text-align:center;margin:20px 0 8px;">
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

// ── Email 2 HTML builder (7 days) ─────────────────────────────────────────────
function buildEmail2Html({ name, matchName, matchUni, score, zone2Block, unsubToken, email }) {
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(email)}`;
  const zone2Html = zone2Block ? zone2Block.html : '';
  const reviewBase = `https://unirenter.com.au/review?email=${encodeURIComponent(email)}&token=${makeHmacToken(email + ':review')}&rating=`;

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
        It's been a week since you matched with <strong style="color:#F5B800;">${matchName}</strong>. Hope the move is coming together — Cob's keeping an eye on your key dates.
      </div>
      <div style="font-size:20px;margin:14px 0 6px;opacity:0.8;">📅 + 7 = 🏠</div>
    </div>

    ${zone2Html ? `<div style="margin:8px 0;">${zone2Html}</div>` : ''}

    <!-- Review ask -->
    <div style="background:#162535;border-radius:16px;padding:24px;margin:8px 0;text-align:center;">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px;color:#e8f0f5;">Quick one — how would you rate UniRenter so far?</div>
      <div style="font-size:12px;color:#7a96aa;margin-bottom:16px;">Your honest feedback helps other students find us.</div>
      <div style="display:flex;justify-content:center;gap:6px;font-size:26px;flex-wrap:wrap;">
        <a href="${reviewBase}1" style="text-decoration:none;" title="1 star">⭐</a>
        <a href="${reviewBase}2" style="text-decoration:none;" title="2 stars">⭐⭐</a>
        <a href="${reviewBase}3" style="text-decoration:none;" title="3 stars">⭐⭐⭐</a>
        <a href="${reviewBase}4" style="text-decoration:none;" title="4 stars">⭐⭐⭐⭐</a>
        <a href="${reviewBase}5" style="text-decoration:none;" title="5 stars">⭐⭐⭐⭐⭐</a>
      </div>
    </div>

    <!-- Share -->
    <div style="background:#162535;border-radius:16px;padding:20px 24px;margin:8px 0;text-align:center;">
      <div style="font-size:14px;color:#c8dde8;margin-bottom:12px;">Know another student looking for a place? The more students who join, the better everyone's matches get.</div>
      <a href="https://unirenter.com.au" style="display:inline-block;background:transparent;color:#4BBFE0;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none;border:1px solid rgba(75,191,224,0.25);">Share UniRenter →</a>
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

// ── Email 3 HTML builder (14 days, conditional) ───────────────────────────────
function buildEmail3Html({ name, matchName, completedFeatures, unsubToken, email, profile }) {
  const unsubUrl = `https://unirenter.com.au/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(email)}`;
  const reviewBase = `https://unirenter.com.au/review?email=${encodeURIComponent(email)}&token=${makeHmacToken(email + ':review')}&rating=`;

  // Pick one re-engagement hook based on what hasn't been done
  let hookHtml = '';
  const hasHousehold   = completedFeatures.includes('household');
  const hasAgreement   = completedFeatures.includes('agreement');
  const hasVibe        = profile.vibe_emoji_primary;
  const hasListing     = completedFeatures.includes('listing');
  const hasTenancy     = completedFeatures.includes('tenancy');

  if (hasHousehold && !hasAgreement) {
    // They set up a household but haven't done the agreement — strong hook
    hookHtml = `
      <div style="background:rgba(245,184,0,0.06);border:1px solid rgba(245,184,0,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#F5B800;margin-bottom:6px;">📋 Sort the house rules before someone leaves a passive-aggressive note</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">You've set up your household — now lock in how things are going to work. Cob will help you build house rules everyone can actually agree on. Takes about 8 minutes, saves a lot of awkward conversations.</div>
        <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Build our house rules →</a>
        <div style="font-size:20px;margin-top:10px;opacity:0.8;">🤠 + 📋 = 🏡</div>
      </div>`;
  } else if (!hasHousehold) {
    hookHtml = `
      <div style="background:rgba(245,184,0,0.06);border:1px solid rgba(245,184,0,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#F5B800;margin-bottom:6px;">🏠 Set up your household with ${matchName}</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Two weeks in — if you and ${matchName} are moving in together, Cob can set up your household profile, map your compatibility, and help you sort the house rules before anyone signs anything.</div>
        <a href="https://unirenter.com.au/dashboard?tab=household" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Set up my household →</a>
      </div>`;
  } else if (!hasVibe) {
    hookHtml = `
      <div style="background:rgba(232,98,58,0.06);border:1px solid rgba(232,98,58,0.15);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#E8623A;margin-bottom:6px;">✨ Let Cob write your housemate profile</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">Haven't finished your vibe yet? It takes about 3 minutes — answer 6 questions about your home life and Cob writes a short personality portrait that shows on your match cards. It's what makes you stand out.</div>
        <a href="https://unirenter.com.au/dashboard?tab=profile&action=vibe" style="display:inline-block;background:#E8623A;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Let Cob write my vibe →</a>
      </div>`;
  } else if (!hasTenancy) {
    hookHtml = `
      <div style="background:rgba(75,191,224,0.05);border:1px solid rgba(75,191,224,0.1);border-radius:10px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#4BBFE0;margin-bottom:6px;">📋 Set up your tenancy calendar</div>
        <div style="font-size:13px;color:#c0d4e0;line-height:1.6;margin-bottom:12px;">If you're moving in soon, this is the one to do. Snap a photo of your lease and Cob sets up your full tenancy timeline — the dates that actually cost you money if you miss them.</div>
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:inline-block;background:#4BBFE0;color:#0d1f2d;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;">Set up my tenancy calendar →</a>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ay ${name}! Two weeks in — Cob checking in 🤠</title>
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
      <div style="font-size:15px;line-height:1.7;color:#c8dde8;">
        Two weeks since you matched with <strong style="color:#F5B800;">${matchName}</strong>. Cob's just checking the move is going smoothly — and there's one more thing that might actually help.
      </div>
      <div style="font-size:20px;margin:14px 0 0;opacity:0.8;">📅 + 14 = 🏡</div>
    </div>

    ${hookHtml ? `<div style="margin:8px 0;">${hookHtml}</div>` : ''}

    <!-- Other things Cob can help with -->
    <div style="background:#162535;border-radius:16px;padding:20px 24px;margin:8px 0;">
      <div style="font-size:13px;font-weight:600;color:#7a96aa;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">Cob can also help with</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <a href="https://unirenter.com.au/dashboard?tab=tenancy" style="display:flex;align-items:center;gap:10px;color:#c8dde8;text-decoration:none;font-size:13px;">
          <span>📋</span><span>Lease questions, tenancy rights, notice periods</span>
        </a>
        <a href="https://unirenter.com.au/lease" style="display:flex;align-items:center;gap:10px;color:#c8dde8;text-decoration:none;font-size:13px;">
          <span>🔄</span><span>Break lease board — free to list, Cob guides both sides</span>
        </a>
        <a href="https://unirenter.com.au/guide" style="display:flex;align-items:center;gap:10px;color:#c8dde8;text-decoration:none;font-size:13px;">
          <span>📖</span><span>Renter's guide — know your rights in your state</span>
        </a>
      </div>
    </div>

    <!-- Subtle review + share -->
    <div style="background:#162535;border-radius:16px;padding:20px 24px;margin:8px 0;text-align:center;">
      <div style="font-size:13px;color:#7a96aa;margin-bottom:10px;">If UniRenter's been useful, a quick rating helps other students find us.</div>
      <div style="display:flex;justify-content:center;gap:6px;font-size:22px;margin-bottom:12px;">
        <a href="${reviewBase}1" style="text-decoration:none;" title="1 star">⭐</a>
        <a href="${reviewBase}2" style="text-decoration:none;" title="2 stars">⭐⭐</a>
        <a href="${reviewBase}3" style="text-decoration:none;" title="3 stars">⭐⭐⭐</a>
        <a href="${reviewBase}4" style="text-decoration:none;" title="4 stars">⭐⭐⭐⭐</a>
        <a href="${reviewBase}5" style="text-decoration:none;" title="5 stars">⭐⭐⭐⭐⭐</a>
      </div>
      <a href="https://unirenter.com.au" style="display:inline-block;background:transparent;color:#4BBFE0;font-size:12px;padding:6px 14px;border-radius:6px;text-decoration:none;border:1px solid rgba(75,191,224,0.2);">Share UniRenter →</a>
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

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    email, match_email, match_name, match_uni, score, suburb,
    email_number, completed_features
  } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (profileErr || !profileRow) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  if (profileRow.email_unsubscribed) {
    return res.status(200).json({ suppressed: true, reason: 'unsubscribed' });
  }
  if (!profileRow.email_verified) {
    return res.status(200).json({ suppressed: true, reason: 'email_not_verified' });
  }

  const firstName   = (profileRow.name || email.split('@')[0] || 'hey').split(' ')[0];
  const unsubToken  = makeHmacToken(email);
  const emailNum    = email_number || 1;
  const completedFeatures = completed_features || [];

  // ── Email 1 ────────────────────────────────────────────────────────────────
  if (emailNum === 1) {
    if (profileRow.match_email_1_sent_at) {
      return res.status(200).json({ suppressed: true, reason: 'email_1_already_sent' });
    }

    const zone2Blocks = buildZone2Blocks(profileRow, { name: match_name }, '', []);
    const html = buildEmail1Html({
      name: firstName,
      matchName:    match_name  || 'your match',
      matchUni:     match_uni   || 'their uni',
      score:        score       || '—',
      suburb:       suburb      || '',
      userEmoji:    profileRow.vibe_emoji_primary    || null,
      matchEmoji:   null,
      userSecondary:  profileRow.vibe_emoji_secondary || null,
      matchSecondary: null,
      zone2Blocks,
      unsubToken,
      email,
    });

    try {
      await resend.emails.send({
        from:    'Cob from UniRenter <noreply@unirenter.com.au>',
        to:      email,
        bcc:     'benjcarey75@gmail.com',
        subject: `Ay ${firstName}! Looks like you found your person 🤠`,
        html,
      });

      const usedIndices = zone2Blocks.map(b => b.index);
      await supabase.from('profiles').update({
        match_email_1_sent_at:       new Date().toISOString(),
        match_email_2_due_at:        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        match_email_1_zone2_indices: usedIndices,
      }).eq('email', email);

      return res.status(200).json({ sent: true, email_number: 1 });
    } catch (err) {
      console.error('Email 1 send error:', err);
      return res.status(500).json({ error: 'Failed to send email', detail: err.message });
    }
  }

  // ── Email 2 (7 days) ───────────────────────────────────────────────────────
  if (emailNum === 2) {
    if (profileRow.match_email_2_sent_at) {
      return res.status(200).json({ suppressed: true, reason: 'email_2_already_sent' });
    }

    const usedInEmail1   = profileRow.match_email_1_zone2_indices || [];
    const allZone2       = buildZone2Blocks(profileRow, { name: match_name }, '', []);
    const remainingBlock = allZone2.find(b => !usedInEmail1.includes(b.index)) || null;

    const html = buildEmail2Html({
      name:      firstName,
      matchName: match_name || 'your match',
      matchUni:  match_uni  || '',
      score:     score      || '',
      zone2Block: remainingBlock,
      unsubToken,
      email,
    });

    try {
      await resend.emails.send({
        from:    'Cob from UniRenter <noreply@unirenter.com.au>',
        to:      email,
        bcc:     'benjcarey75@gmail.com',
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

  // ── Email 3 (14 days, conditional) ────────────────────────────────────────
  if (emailNum === 3) {
    if (profileRow.match_email_2_sent_at === null) {
      return res.status(200).json({ suppressed: true, reason: 'email_2_not_sent_yet' });
    }

    // Suppress if all key features completed
    const allDone = completedFeatures.includes('household') &&
                    completedFeatures.includes('agreement') &&
                    completedFeatures.includes('tenancy') &&
                    profileRow.vibe_emoji_primary;
    if (allDone) {
      return res.status(200).json({ suppressed: true, reason: 'all_features_complete' });
    }

    const html = buildEmail3Html({
      name:               firstName,
      matchName:          match_name || 'your match',
      completedFeatures,
      unsubToken,
      email,
      profile:            profileRow,
    });

    try {
      await resend.emails.send({
        from:    'Cob from UniRenter <noreply@unirenter.com.au>',
        to:      email,
        bcc:     'benjcarey75@gmail.com',
        subject: `Ay ${firstName}! Two weeks in — Cob checking in 🤠`,
        html,
      });

      return res.status(200).json({ sent: true, email_number: 3 });
    } catch (err) {
      console.error('Email 3 send error:', err);
      return res.status(500).json({ error: 'Failed to send email', detail: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid email_number — must be 1, 2 or 3' });
};
