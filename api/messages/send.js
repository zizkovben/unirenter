// api/messages/send.js — POST /api/messages/send
const { createClient } = require('@supabase/supabase-js');
const notifyRecipient = require('./notify');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BLOCKED_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /\b\d{6}[\s-]\d{6,10}\b/,
  /\b(paypal\.me|cashapp|venmo|binance)\b/i,
  /\bwhatsapp\b/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sender_email, recipient_email, recipient_id, city, body } = req.body || {};

    // S128: accept recipient_id (UUID from matches API) OR recipient_email
    if (!sender_email || (!recipient_email && !recipient_id) || !city || !body) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const trimmed = (body || '').trim();
    if (!trimmed || trimmed.length > 2000) {
      return res.status(400).json({ error: 'Message must be 1–2000 characters' });
    }
    if (BLOCKED_PATTERNS.some(p => p.test(trimmed))) {
      return res.status(400).json({ error: 'Message contains blocked content' });
    }

    // Verify sender exists and is verified
    const { data: senderProfile, error: senderErr } = await supabase
      .from('profiles')
      .select('email, email_verified, display_name')
      .eq('email', sender_email)
      .single();

    if (senderErr || !senderProfile) {
      return res.status(403).json({ error: 'Sender profile not found' });
    }
    if (!senderProfile.email_verified) {
      return res.status(403).json({ error: 'Sender not verified — please verify your email first' });
    }

    // Resolve recipient email — by id (from matches API) or directly
    let resolvedRecipientEmail = recipient_email || null;

    if (!resolvedRecipientEmail && recipient_id) {
      const { data: recipById, error: recipByIdErr } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', recipient_id)
        .single();
      if (recipByIdErr || !recipById || !recipById.email) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
      resolvedRecipientEmail = recipById.email;
    } else if (resolvedRecipientEmail) {
      const { data: recipientProfile, error: recipientErr } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', resolvedRecipientEmail)
        .single();
      if (recipientErr || !recipientProfile) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
    }

    if (!resolvedRecipientEmail) {
      return res.status(400).json({ error: 'Could not resolve recipient' });
    }

    if (sender_email === resolvedRecipientEmail) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    // S131: Check if a thread ALREADY EXISTS between these two people in EITHER direction.
    // If a thread exists → allow send (it's a reply, not a duplicate opener).
    // If NO thread exists AND sender has already sent to recipient → block (duplicate opener).
    //
    // A "thread exists" means at least one message exists where:
    //   (sender=A, recipient=B) OR (sender=B, recipient=A)
    const { count: threadCount } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .or(
        `and(sender_email.eq.${sender_email},recipient_email.eq.${resolvedRecipientEmail}),` +
        `and(sender_email.eq.${resolvedRecipientEmail},recipient_email.eq.${sender_email})`
      );

    const threadExists = (threadCount || 0) > 0;

    if (!threadExists) {
      // No thread yet — check if THIS sender has already tried to open (duplicate opener guard)
      const { count: senderCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_email', sender_email)
        .eq('recipient_email', resolvedRecipientEmail);

      if ((senderCount || 0) > 0) {
        return res.status(409).json({ error: 'Already messaged this person' });
      }
    }
    // If threadExists → fall through and allow the reply

    // Insert message
    const { data, error: insertErr } = await supabase
      .from('messages')
      .insert({ sender_email, recipient_email: resolvedRecipientEmail, city, body: trimmed })
      .select()
      .single();

    if (insertErr) {
      console.error('Message insert error:', JSON.stringify(insertErr));
      return res.status(500).json({ error: 'Failed to send message', detail: insertErr.message });
    }

    // Fire notify only on first message in thread (i.e. threadCount was 0 before this insert)
    if (!threadExists) {
      notifyRecipient({
        recipientEmail: resolvedRecipientEmail,
        senderName: senderProfile.display_name || sender_email.split('@')[0],
        messagePreview: trimmed,
        city,
      });
    }

    return res.status(200).json({ ok: true, message: data });

  } catch (err) {
    console.error('send.js unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
