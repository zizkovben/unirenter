// api/listing/create.js
// Generates a public listing token for a student's "Flatmate Wanted" card.
// POST { email } → { token, url, expires_at }
// Token is stored on the profiles row. Expires after 30 days.
 
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
 
  // Generate a URL-safe token
  const token = crypto.randomBytes(20).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
 
  // Upsert token onto the profile
  const { error } = await supabase
    .from('profiles')
    .update({ listing_token: token, listing_expires_at: expiresAt })
    .eq('email', email.toLowerCase().trim());
 
  if (error) {
    console.error('listing/create error:', error);
    return res.status(500).json({ error: 'Failed to create listing token' });
  }
 
  const url = `https://unirenter.vercel.app/listing/${token}`;
  return res.status(200).json({ token, url, expires_at: expiresAt });
};
 
