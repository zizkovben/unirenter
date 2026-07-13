// api/messages/react.js — POST /api/messages/react
// S158: message reactions (tapback chips). Toggles a single reactor's emoji
// on a message — if this reactor already has this exact emoji on this
// message, it's removed (tap to un-react); otherwise it's added. One
// reactor can have multiple different emoji on the same message (each is
// its own row), matching the client's per-emoji toggle UI in
// msgReactionsHtml()/msgToggleReaction().
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = req.body || {};
    const message_id = (rawBody.message_id || '').toString().trim();
    // S135-pattern: normalize casing at the source, same as send.js/get.js —
    // without this a reactor could accumulate both "User@Gmail.com" and
    // "user@gmail.com" rows for the same real person and the toggle would
    // never find its own prior reaction to remove.
    const reactor_email = (rawBody.email || '').trim().toLowerCase();
    const emoji = (rawBody.emoji || '').toString().trim();

    if (!message_id || !reactor_email || !emoji) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Confirm the reactor is actually a participant in this message's
    // conversation — same confidentiality posture as message_flags/user_blocks
    // elsewhere in this file group. Reacting to a message you're not part of
    // isn't a legitimate action from any surface the client exposes.
    const { data: message, error: msgErr } = await supabase
      .from('messages')
      .select('id, sender_email, recipient_email')
      .eq('id', message_id)
      .maybeSingle();

    if (msgErr) {
      console.error('react.js message lookup error:', msgErr);
      return res.status(500).json({ error: 'Failed to load message', detail: msgErr.message });
    }
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const isParticipant =
      (message.sender_email || '').toLowerCase() === reactor_email ||
      (message.recipient_email || '').toLowerCase() === reactor_email;
    if (!isParticipant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    // Toggle: does this reactor already have this exact emoji on this message?
    const { data: existing, error: existingErr } = await supabase
      .from('message_reactions')
      .select('id')
      .eq('message_id', message_id)
      .eq('emoji', emoji)
      .eq('reactor_email', reactor_email)
      .maybeSingle();

    if (existingErr) {
      console.error('react.js existing-reaction lookup error:', existingErr);
      return res.status(500).json({ error: 'Failed to check reaction', detail: existingErr.message });
    }

    if (existing) {
      const { error: delErr } = await supabase
        .from('message_reactions')
        .delete()
        .eq('id', existing.id);
      if (delErr) {
        console.error('react.js delete error:', delErr);
        return res.status(500).json({ error: 'Failed to remove reaction', detail: delErr.message });
      }
      return res.status(200).json({ ok: true, action: 'removed' });
    }

    const { error: insErr } = await supabase
      .from('message_reactions')
      .insert({ message_id, emoji, reactor_email });
    if (insErr) {
      console.error('react.js insert error:', insErr);
      return res.status(500).json({ error: 'Failed to add reaction', detail: insErr.message });
    }
    return res.status(200).json({ ok: true, action: 'added' });
  } catch (err) {
    console.error('react.js unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
