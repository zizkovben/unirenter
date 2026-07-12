// api/messages/respond-request.js — POST /api/messages/respond-request
// S181: Accept/Decline for a pending connection request. The opening
// message already exists (created immediately by send.js, just hidden
// from the recipient's main inbox by get.js while pending) — this endpoint
// only flips connection_requests.status, it never creates a message.
//
// POST body: { email, sender_email, action }
//   email        — the person responding (must be the recipient of the
//                   pending request, i.e. NOT connection_requests.requested_by)
//   sender_email — who sent the original request
//   action       — 'accept' | 'decline'
//
// Decline cooldown: 1st decline → 7 days before that sender can request
// this recipient again, 2nd+ decline → 14 days. Recipient can also hard-block
// any time via the existing /api/messages/block endpoint — independent of
// this cooldown and checked first on every send (api/messages/send.js).
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    const senderEmail = (body.sender_email || '').trim().toLowerCase();
    const action = body.action;

    if (!email || !senderEmail || !['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'email, sender_email and a valid action are required' });
    }
    if (email === senderEmail) {
      return res.status(400).json({ error: 'Cannot respond to your own request' });
    }

    const [participant_a, participant_b] = [email, senderEmail].sort();

    const { data: crRow, error: crErr } = await supabase
      .from('connection_requests')
      .select('*')
      .eq('participant_a', participant_a)
      .eq('participant_b', participant_b)
      .maybeSingle();

    if (crErr) {
      console.error('[respond-request] lookup error:', crErr);
      return res.status(500).json({ error: 'Could not load request' });
    }
    if (!crRow) {
      return res.status(404).json({ error: 'No request found between these two people' });
    }
    if (crRow.status !== 'pending') {
      // Already actioned (e.g. a second click, or the sender's reply already
      // flipped it to accepted) — report current state rather than erroring.
      return res.status(200).json({ ok: true, already_actioned: true, status: crRow.status });
    }
    if (crRow.requested_by === email) {
      return res.status(403).json({ error: 'Only the recipient of a request can accept or decline it' });
    }

    if (action === 'accept') {
      const { error: updateErr } = await supabase
        .from('connection_requests')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('participant_a', participant_a)
        .eq('participant_b', participant_b);

      if (updateErr) {
        console.error('[respond-request] accept update error:', updateErr);
        return res.status(500).json({ error: 'Could not accept request' });
      }
      return res.status(200).json({ ok: true, status: 'accepted' });
    }

    // action === 'decline'
    const newDeclineCount = (crRow.decline_count || 0) + 1;
    const cooldownDays = newDeclineCount === 1 ? 7 : 14;
    const retryAllowedAt = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000).toISOString();

    const { error: declineErr } = await supabase
      .from('connection_requests')
      .update({
        status: 'declined',
        responded_at: new Date().toISOString(),
        decline_count: newDeclineCount,
        retry_allowed_at: retryAllowedAt,
      })
      .eq('participant_a', participant_a)
      .eq('participant_b', participant_b);

    if (declineErr) {
      console.error('[respond-request] decline update error:', declineErr);
      return res.status(500).json({ error: 'Could not decline request' });
    }

    // No email to the sender on decline — deliberately soft (matches the
    // existing pre-connect "Skip" pattern). The sender's own match card
    // picks up the "not taking new connections right now" copy next time
    // it loads/polls, via connection_requests data returned from get.js.
    return res.status(200).json({ ok: true, status: 'declined', retry_allowed_at: retryAllowedAt });

  } catch (err) {
    console.error('[respond-request] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
