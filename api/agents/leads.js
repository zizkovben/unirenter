// api/agents/leads.js
// Returns leads for the authenticated housing partner.
// Auth: x-agent-token header matched against agents.token in Supabase.
// CommonJS — S49

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-agent-token'];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    // Look up agent by token
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('id, name, email, cities, active, free_access_until, created_at')
      .eq('token', token)
      .eq('active', true)
      .single();

    if (agentErr || !agent) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Fetch all leads for this agent, newest first
    const { data: leads, error: leadsErr } = await supabase
      .from('agent_leads')
      .select('id, student_email, student_name, city, university, budget_max, move_in_date, status, created_at, updated_at')
      .eq('agent_id', agent.id)
      .order('created_at', { ascending: false });

    if (leadsErr) {
      console.error('Leads fetch error:', leadsErr);
      return res.status(500).json({ error: 'Could not fetch leads' });
    }

    return res.status(200).json({
      partner: {
        name: agent.name,
        cities: agent.cities,
        free_access_until: agent.free_access_until,
        created_at: agent.created_at
      },
      leads: leads || []
    });

  } catch (err) {
    console.error('Unexpected error in /api/agents/leads:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
