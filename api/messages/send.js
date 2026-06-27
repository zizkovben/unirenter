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

  const { sender_email, recipient_email, city, body } = req.body || {};

  if (!sender_email || !recipient_email || !city || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (sender_email === recipient_email) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 2000) {
    return res.status(400).json({ error: 'Message must be 1–2000 characters' });
  }
  if (BLOCKED_PATTERNS.some(p => p.test(trimmed))) {
    return res.status(400).json({ error: 'Message contains blocked content' });
  }

  // Verify sender is verified
  const { data: senderProfile, error: senderErr } = await supabase
    .from('profiles')
    .select('email, email_verified, display_name')
    .eq('email', sender_email)
    .single();

  if (senderErr || !senderProfile || !senderProfile.email_verified) {
    return res.status(403).json({ error: 'Sender not verified' });
  }

  // Verify recipient exists
  const { data: recipientProfile, error: recipientErr } = await supabase
    .from('profiles')
    .select('email')
    .eq('email', recipient_email)
    .single();

  if (recipientErr || !recipientProfile) {
    return res.status(404).json({ error: 'Recipient not found' });
  }

  // Insert message
  const { data, error } = await supabase
    .from('messages')
    .insert({ sender_email, recipient_email, city, body: trimmed })
    .select()
    .single();

  if (error) {
    console.error('Message insert error:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }

  // Check if this is the first message in this conversation (avoid spam on every reply)
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .or(`and(sender_email.eq.${sender_email},recipient_email.eq.${recipient_email}),and(sender_email.eq.${recipient_email},recipient_email.eq.${sender_email})`);

  // Send email notification — only if first message in thread, or recipient hasn't replied yet
  // (avoids flooding on every message in an active back-and-forth)
  const isFirstMessage = (count || 0) <= 1;
  if (isFirstMessage) {
    // Fire-and-forget — don't await, don't block response
    notifyRecipient({
      recipientEmail: recipient_email,
      senderName: senderProfile.display_name || sender_email.split('@')[0],
      messagePreview: trimmed,
      city,
    });
  }

  return res.status(200).json({ ok: true, message: data });
};
