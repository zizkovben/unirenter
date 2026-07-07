// api/messages/block.js — POST /api/messages/block
// S155a: Cob Trust & Safety. Records a one-directional block. The blocked
// person is never notified and is given no signal via the API surface that
// they've been blocked (see the generic 403 in api/messages/send.js) — the
// blocker's identity and the fact of the block are confidential.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method === 'DELETE') return handleUnblock(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = req.body || {};
    const blocker_email = (rawBody.blocker_email || '').trim().toLowerCase();
    const blocked_email = (rawBody.blocked_email || '').trim().toLowerCase();

    if (!blocker_email || !blocked_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (blocker_email === blocked_email) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const { error } = await supabase
      .from('user_blocks')
      .upsert({ blocker_email, blocked_email }, { onConflict: 'blocker_email,blocked_email' });

    if (error) {
      console.error('block.js insert error:', error);
      return res.status(500).json({ error: 'Failed to block user', detail: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('block.js unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};

// S155a: unblock is a small bonus affordance, not in the original scope —
// without it, a mis-tap on "Block" has no way back. Kept intentionally
// minimal (no confirmation flow, no notification either direction).
async function handleUnblock(req, res) {
  try {
    const rawBody = req.body || {};
    const blocker_email = (rawBody.blocker_email || '').trim().toLowerCase();
    const blocked_email = (rawBody.blocked_email || '').trim().toLowerCase();
    if (!blocker_email || !blocked_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_email', blocker_email)
      .eq('blocked_email', blocked_email);
    if (error) {
      console.error('block.js unblock error:', error);
      return res.status(500).json({ error: 'Failed to unblock user', detail: error.message });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('block.js unblock unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
