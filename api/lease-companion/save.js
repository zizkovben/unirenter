// api/lease-companion/save.js
// Saves or updates a user's lease companion data in Supabase.
// Called via POST /api/lease-companion/save
// Required Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  try {
    const body = req.body;
 
    if (!body.email) {
      return res.status(400).json({ error: 'email required' });
    }
 
    // Parse notice_period_days — accepts integer or select string like '28 days'
    let noticeDays = null;
    if (body.notice_period_days !== undefined && body.notice_period_days !== null && body.notice_period_days !== '') {
      const parsed = parseInt(String(body.notice_period_days).replace(/\D/g, ''), 10);
      if (!isNaN(parsed)) noticeDays = parsed;
    }
 
    // Parse weekly_rent and bond_amount — strip $ signs and commas
    const parseAmount = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const n = parseFloat(String(val).replace(/[$,]/g, ''));
      return isNaN(n) ? null : n;
    };
 
    const payload = {
      email:                body.email,
      updated_at:           new Date().toISOString(),
    };
 
    const fields = [
      'city', 'property_description', 'lease_start', 'lease_end',
      'university', 'source', 'raw_ai_extract', 'household_id'
    ];
    for (const f of fields) {
      if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
        payload[f] = body[f];
      }
    }
 
    if (parseAmount(body.weekly_rent) !== null) {
      payload.weekly_rent = parseAmount(body.weekly_rent);
    }
    if (parseAmount(body.bond_amount) !== null) {
      payload.bond_amount = parseAmount(body.bond_amount);
    }
    if (noticeDays !== null) {
      payload.notice_period_days = noticeDays;
    }
    if (body.inspection_frequency !== undefined && body.inspection_frequency !== '') {
      payload.inspection_frequency = body.inspection_frequency;
    }
 
    // Upsert on email — one lease companion record per user (most recent active lease)
    const { data, error } = await supabase
      .from('lease_companions')
      .upsert(payload, { onConflict: 'email', returning: 'representation' });
 
    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'Failed to save lease companion', detail: error.message });
    }
 
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('save.js error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
