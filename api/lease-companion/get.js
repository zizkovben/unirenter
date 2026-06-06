// api/lease-companion/get.js
// Retrieves a user's lease companion data from Supabase.
// Called via GET /api/lease-companion/get?email=xxx
// Required Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: 'email query parameter required' });
  }

  try {
    const { data, error } = await supabase
      .from('lease_companions')
      .select('*')
      .eq('email', email)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // PGRST116 = no rows found — not an error, just no data yet
      if (error.code === 'PGRST116') {
        return res.status(200).json({ ok: true, data: null });
      }
      console.error('Supabase get error:', error);
      return res.status(500).json({ error: 'Failed to get lease companion', detail: error.message });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('get.js error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
