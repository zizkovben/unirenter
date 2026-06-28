// api/messages/get.js — GET /api/messages/get?email=X&other=Y&city=Z
// Returns the conversation thread between email and other_email
// Also returns the list of all conversations (sidebar) if other is omitted
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { email, other, city } = req.query || {};

  if (!email) return res.status(400).json({ error: 'Missing email' });

  // ── Mode 1: return all conversations for sidebar ──────────────────────────
  if (!other) {
    // Get all messages involving this user
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_email.eq.${email},recipient_email.eq.${email}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Messages list error:', error);
      return res.status(500).json({ error: 'Failed to load conversations' });
    }

    // Group by conversation partner
    const convMap = {};
    (data || []).forEach(msg => {
      const partner = msg.sender_email === email ? msg.recipient_email : msg.sender_email;
      if (!convMap[partner]) {
        convMap[partner] = {
          partner_email: partner,
          last_message: msg.body,
          last_time: msg.created_at,
          unread: 0,
          city: msg.city,
        };
      }
      // Count unread (messages TO me that I haven't read)
      if (msg.recipient_email === email && !msg.read) {
        convMap[partner].unread++;
      }
    });

    // Fetch display names for all partners
    const partnerEmails = Object.keys(convMap);
    let profileMap = {};
    if (partnerEmails.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('email, display_name, university, suburb_preferences, match_score')
        .in('email', partnerEmails);
      (profiles || []).forEach(p => { profileMap[p.email] = p; });
    }

    const conversations = Object.values(convMap).map(c => {
      const profile = profileMap[c.partner_email] || {};
      return {
        ...c,
        display_name: profile.display_name || 'Housemate',
        university: profile.university || null,
        suburb_preferences: profile.suburb_preferences || [],
      };
    });

    // Sort by last_time desc
    conversations.sort((a, b) => new Date(b.last_time) - new Date(a.last_time));

    const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

    return res.status(200).json({ conversations, totalUnread });
  }

  // ── Mode 2: return thread between email and other ─────────────────────────
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_email.eq.${email},recipient_email.eq.${other}),and(sender_email.eq.${other},recipient_email.eq.${email})`
    )
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Thread load error:', error);
    return res.status(500).json({ error: 'Failed to load thread' });
  }

  // Mark messages from other → me as read
  await supabase
    .from('messages')
    .update({ read: true })
    .eq('sender_email', other)
    .eq('recipient_email', email)
    .eq('read', false);

  return res.status(200).json({ messages: data || [] });
};
