// api/household/agreement-save.js
// POST — save or update a household agreement
// Body: { email, household_id, tier, clauses, all_equal_responsibility, head_tenant_email? }
// Returns: { ok, agreement_id, share_token }

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { email, household_id, tier, clauses, all_equal_responsibility, head_tenant_email } = req.body || {};

  if (!email || !household_id || !tier || !clauses) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Verify this email is a member of the household
  const { data: memberRow } = await supabase
    .from('household_members')
    .select('email')
    .eq('household_id', household_id)
    .eq('email', email)
    .maybeSingle();

  if (!memberRow) {
    return res.status(403).json({ ok: false, error: 'Not a member of this household' });
  }

  // Check if an agreement already exists for this household
  const { data: existing } = await supabase
    .from('household_agreement')
    .select('id, share_token, version, locked_at')
    .eq('household_id', household_id)
    .maybeSingle();

  // Cannot edit a locked agreement
  if (existing && existing.locked_at) {
    return res.status(403).json({ ok: false, error: 'Agreement is locked and cannot be edited' });
  }

  const now = new Date().toISOString();

  if (existing) {
    // Update existing
    const { error: updateErr } = await supabase
      .from('household_agreement')
      .update({
        tier,
        clauses,
        all_equal_responsibility: all_equal_responsibility || false,
        head_tenant_email: head_tenant_email || null,
        version: (existing.version || 1) + 1,
        updated_at: now
      })
      .eq('id', existing.id);

    if (updateErr) {
      console.error('agreement-save update error:', updateErr);
      return res.status(500).json({ ok: false, error: 'Failed to update agreement' });
    }

    // Clear all ticks when clauses change (new version)
    await supabase
      .from('household_agreement_ticks')
      .delete()
      .eq('agreement_id', existing.id);

    return res.status(200).json({ ok: true, agreement_id: existing.id, share_token: existing.share_token });
  } else {
    // Create new
    const share_token = crypto.randomBytes(20).toString('hex');

    const { data: newRow, error: insertErr } = await supabase
      .from('household_agreement')
      .insert({
        household_id,
        tier,
        clauses,
        all_equal_responsibility: all_equal_responsibility || false,
        head_tenant_email: head_tenant_email || null,
        version: 1,
        share_token,
        created_at: now,
        updated_at: now
      })
      .select('id, share_token')
      .single();

    if (insertErr) {
      console.error('agreement-save insert error:', insertErr);
      return res.status(500).json({ ok: false, error: 'Failed to create agreement' });
    }

    return res.status(200).json({ ok: true, agreement_id: newRow.id, share_token: newRow.share_token });
  }
};
