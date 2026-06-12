// api/agents/lead-status.js
// Updates the status of a lead. Only the owning agent can update their own leads.
// Valid statuses: new, contacted, in_progress, closed
// CommonJS — S49

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_STATUSES = ['new', 'contacted', 'in_progress', 'closed'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-agent-token'];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const { leadId, status } = req.body || {};

    if (!leadId || !status) {
      return res.status(400).json({ error: 'leadId and status are required' });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: ' + VALID_STATUSES.join(', ') });
    }

    // Verify agent token
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('id')
      .eq('token', token)
      .eq('active', true)
      .single();

    if (agentErr || !agent) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Update lead — only if it belongs to this agent
    const { data: updated, error: updateErr } = await supabase
      .from('agent_leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', leadId)
      .eq('agent_id', agent.id)
      .select()
      .single();

    if (updateErr) {
      console.error('Lead status update error:', updateErr);
      return res.status(500).json({ error: 'Could not update status' });
    }

    if (!updated) {
      return res.status(404).json({ error: 'Lead not found or not owned by this partner' });
    }

    return res.status(200).json({ ok: true, leadId, status });

  } catch (err) {
    console.error('Unexpected error in /api/agents/lead-status:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
