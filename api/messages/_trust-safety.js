// api/messages/_trust-safety.js — internal shared helper, not a route.
// S155c: centralizes logic previously duplicated between send.js (auto-
// detection) and report.js (manual reports) — both need to run the same
// fast-track suspension and standard-category ladder checks.
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL = 'benjcarey75@gmail.com';

// Lazy-expiry windows, in days. banned_permanent has no entry — it never
// auto-clears. suspended_pending_review and banned_2wk both revert to
// 'active' once their window passes, but ladder_stage is never touched by
// expiry — it's a permanent historical counter (see migration comments).
const EXPIRY_DAYS = {
  suspended_pending_review: 7,
  banned_2wk: 14,
};

async function notifyAdmin(subject, htmlBody) {
  try {
    await resend.emails.send({
      from: 'UniRenter <noreply@unirenter.com.au>',
      to: ADMIN_EMAIL,
      subject: '[Trust & Safety] ' + subject,
      html: htmlBody,
    });
  } catch (err) {
    console.warn('_trust-safety.js notifyAdmin error (non-fatal):', err.message);
  }
}

// S155c: fast-track suspension, shared between send.js's auto-detect path
// and report.js's manual-report path (previously each had its own inline
// copy of this same update — centralized here instead).
async function applyFastTrackSuspension(supabase, sender_email, category, source) {
  try {
    await supabase.from('profiles')
      .update({ account_status: 'suspended_pending_review', account_status_since: new Date().toISOString() })
      .eq('email', sender_email);
  } catch (err) {
    console.warn('_trust-safety.js applyFastTrackSuspension error (non-fatal):', err.message);
  }
  notifyAdmin(
    'Fast-track suspension — ' + category,
    `<p><strong>${sender_email}</strong> was suspended pending review.</p>
     <p>Category: <strong>${category}</strong> · Source: ${source}</p>
     <p>Auto-clears after 7 days if untouched. To review or clear sooner, update <code>profiles.account_status</code> in Supabase.</p>`
  );
}

// S155c: standard-category ladder check. Call this after inserting ANY
// standard-severity message_flags row (auto-detected or manually
// reported) — it's safe to call every time; it only acts the first time a
// given (sender, category) pair crosses the 3-distinct-flagger threshold,
// because account_strikes has a unique constraint on (sender_email,
// category) and this function checks for an existing row before doing
// anything.
async function checkStandardLadder(supabase, sender_email, category) {
  try {
    const { data: existingStrike } = await supabase
      .from('account_strikes')
      .select('id')
      .eq('sender_email', sender_email)
      .eq('category', category)
      .maybeSingle();
    if (existingStrike) return; // this category has already struck once — never again

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: flagRows } = await supabase
      .from('message_flags')
      .select('recipient_email')
      .eq('sender_email', sender_email)
      .eq('category', category)
      .eq('severity', 'standard')
      .gte('created_at', thirtyDaysAgo);

    const distinctPeople = new Set((flagRows || []).map(r => r.recipient_email));
    if (distinctPeople.size < 3) return; // not there yet

    // Threshold crossed for the first time on this category — record the
    // strike (blocks this category from ever striking again) and advance
    // the account's overall ladder stage.
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('ladder_stage')
      .eq('email', sender_email)
      .single();
    const newStage = (profileRow ? profileRow.ladder_stage : 0) + 1;

    const { error: strikeErr } = await supabase.from('account_strikes').insert({
      sender_email, category, strike_number: newStage,
    });
    if (strikeErr) {
      // Unique-constraint collision means another request already struck
      // this category first (race condition) — safe to stop here.
      return;
    }

    let newStatus;
    if (newStage === 1) newStatus = 'warned';
    else if (newStage === 2) newStatus = 'banned_2wk';
    else newStatus = 'banned_permanent';

    await supabase.from('profiles')
      .update({ ladder_stage: newStage, account_status: newStatus, account_status_since: new Date().toISOString() })
      .eq('email', sender_email);

    notifyAdmin(
      `Ladder stage ${newStage} (${newStatus}) — ${sender_email}`,
      `<p><strong>${sender_email}</strong> reached ladder stage <strong>${newStage}</strong> (${newStatus}).</p>
       <p>Triggered by category <strong>${category}</strong> reaching 3 distinct people within 30 days.</p>
       ${newStage >= 3 ? '<p>This is a <strong>permanent ban</strong> — it will not auto-clear.</p>' : '<p>Temporary states auto-clear on their own; no action needed unless you want to intervene early.</p>'}`
    );
  } catch (err) {
    console.warn('_trust-safety.js checkStandardLadder error (non-fatal):', err.message);
  }
}

// S155c: lazy expiry + enforcement check. Called at the top of send.js in
// place of the old inline account_status check. Mirrors the lazy-decay
// pattern already used elsewhere in this codebase (get.js's conversation
// status) rather than a scheduled job — the expiry only actually happens
// the next time someone tries to send, or checks their own status.
async function checkAccountEnforcement(supabase, email) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_status, account_status_since')
      .eq('email', email)
      .single();
    if (!profile) return { blocked: false, status: 'active' };

    let status = profile.account_status || 'active';
    const since = profile.account_status_since ? new Date(profile.account_status_since).getTime() : null;
    const expiryDays = EXPIRY_DAYS[status];

    if (expiryDays && since && (Date.now() - since) > expiryDays * 86400000) {
      // Window passed, untouched — lazily clear back to active.
      // ladder_stage is deliberately NOT reset here (see migration notes).
      await supabase.from('profiles')
        .update({ account_status: 'active', account_status_since: null })
        .eq('email', email);
      status = 'active';
    }

    const blocked = status === 'suspended_pending_review' || status === 'banned_2wk' || status === 'banned_permanent';
    return { blocked, status };
  } catch (err) {
    console.warn('_trust-safety.js checkAccountEnforcement error (non-fatal, allowing send):', err.message);
    return { blocked: false, status: 'active' };
  }
}

module.exports = { applyFastTrackSuspension, checkStandardLadder, checkAccountEnforcement, notifyAdmin };
