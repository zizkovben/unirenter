// api/notifications/register-push.js
// Saves a Web Push subscription for a verified student.
// Upserts on email — one active subscription per user.
// CommonJS — matches all new API files in this project.
 
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
 
  try {
    const { email, subscription, city } = req.body || {};
 
    if (!email || !subscription || !subscription.endpoint) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
 
    // Basic email sanity check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }
 
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          email:        email.toLowerCase().trim(),
          subscription: subscription,
          city:         city || 'melbourne',
          updated_at:   new Date().toISOString()
        },
        { onConflict: 'email' }
      );
 
    if (error) {
      console.error('push_subscriptions upsert error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to save subscription' });
    }
 
    return res.status(200).json({ ok: true });
 
  } catch (err) {
    console.error('register-push error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
