// api/agents/lead.js
// Receives "Free housing assistance" tick box submission from city pages.
// Creates agent_leads row + fires agent notification email + student confirmation email.
// CommonJS — S49

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// City → agent assignment.
// Each entry maps a city to the agent email stored in the agents table.
// We look up the matching agent by city at runtime so this stays data-driven.
const VALID_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      student_email,
      student_name,
      city,
      university,
      budget_max,
      move_in_date
    } = req.body || {};

    // Validate required fields
    if (!student_email || !city) {
      return res.status(400).json({ error: 'student_email and city are required' });
    }

    const normCity = (city || '').toLowerCase().trim();
    if (!VALID_CITIES.includes(normCity)) {
      return res.status(400).json({ error: 'Invalid city' });
    }

    // Look up the active agent for this city
    const { data: agents, error: agentErr } = await supabase
      .from('agents')
      .select('id, name, email, cities, free_access_until')
      .eq('active', true)
      .contains('cities', [normCity]);

    if (agentErr) {
      console.error('Agent lookup error:', agentErr);
      return res.status(500).json({ error: 'Could not find housing partner' });
    }

    if (!agents || agents.length === 0) {
      // No active partner for this city — log and return success silently
      // (student experience must not break if no agent assigned)
      console.log('No active housing partner for city:', normCity);
      return res.status(200).json({ ok: true, note: 'no_partner' });
    }

    const agent = agents[0];

    // Create lead row
    const { data: lead, error: leadErr } = await supabase
      .from('agent_leads')
      .insert({
        agent_id: agent.id,
        student_email: student_email.trim().toLowerCase(),
        student_name: student_name || null,
        city: normCity,
        university: university || null,
        budget_max: budget_max ? parseInt(budget_max, 10) : null,
        move_in_date: move_in_date || null,
        status: 'new'
      })
      .select()
      .single();

    if (leadErr) {
      console.error('Lead insert error:', leadErr);
      return res.status(500).json({ error: 'Could not save lead' });
    }

    const cityLabel = normCity.charAt(0).toUpperCase() + normCity.slice(1);
    const displayName = student_name || 'a student';
    const displayBudget = budget_max ? '$' + budget_max + '/wk' : 'Not specified';
    const displayMoveIn = move_in_date || 'Not specified';
    const displayUni = university || 'Not specified';

    // Fire both emails in parallel — don't let email failure block response
    const emailPromises = [
      // Agent notification email
      resend.emails.send({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: agent.email,
        bcc: 'benjcarey75@gmail.com',
        subject: `New housing lead — ${cityLabel} — ${displayName}`,
        html: agentEmailHtml({
          agentName: agent.name,
          studentName: student_name,
          studentEmail: student_email,
          city: cityLabel,
          university: displayUni,
          budget: displayBudget,
          moveIn: displayMoveIn,
          leadId: lead.id
        })
      }),
      // Student confirmation email
      resend.emails.send({
        from: 'UniRenter <noreply@unirenter.com.au>',
        to: student_email,
        bcc: 'benjcarey75@gmail.com',
        subject: `Your housing assistance request — UniRenter`,
        html: studentEmailHtml({
          studentName: student_name,
          partnerName: agent.name,
          city: cityLabel
        })
      })
    ];

    // Fire and forget — don't await in the response path
    Promise.all(emailPromises).catch(err => {
      console.error('Email send error:', err);
    });

    return res.status(200).json({ ok: true, leadId: lead.id });

  } catch (err) {
    console.error('Unexpected error in /api/agents/lead:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Email templates ──────────────────────────────────────────────────────────

function agentEmailHtml({ agentName, studentName, studentEmail, city, university, budget, moveIn, leadId }) {
  const name = studentName || 'A student';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f2d;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#182f42;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
      <tr>
        <td style="background:#0d1f2d;padding:20px 28px;border-bottom:1px solid #1e3a50;">
          <span style="font-family:'Epilogue',Arial,sans-serif;font-size:20px;font-weight:800;color:#e8f0f5;">Uni<span style="color:#F5B800;">Renter</span></span>
          <span style="float:right;background:#162535;border:1px solid #1e3a50;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:600;color:#4BBFE0;">Housing Partner</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 8px;">
          <p style="color:#7a96aa;font-size:13px;margin:0 0 6px;">New lead received</p>
          <h2 style="color:#e8f0f5;font-size:20px;font-weight:700;margin:0 0 20px;font-family:'Epilogue',Arial,sans-serif;">
            ${name} is looking for housing in ${city} 🏠
          </h2>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#162535;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #1e3a50;">
                <span style="color:#7a96aa;font-size:12px;display:block;margin-bottom:2px;">Student name</span>
                <span style="color:#e8f0f5;font-size:14px;font-weight:600;">${studentName || 'Not provided'}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #1e3a50;">
                <span style="color:#7a96aa;font-size:12px;display:block;margin-bottom:2px;">Contact email</span>
                <a href="mailto:${studentEmail}" style="color:#4BBFE0;font-size:14px;font-weight:600;text-decoration:none;">${studentEmail}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #1e3a50;">
                <span style="color:#7a96aa;font-size:12px;display:block;margin-bottom:2px;">University</span>
                <span style="color:#e8f0f5;font-size:14px;">${university}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #1e3a50;">
                <span style="color:#7a96aa;font-size:12px;display:block;margin-bottom:2px;">Budget</span>
                <span style="color:#F5B800;font-size:14px;font-weight:600;">${budget}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px;">
                <span style="color:#7a96aa;font-size:12px;display:block;margin-bottom:2px;">Move-in date</span>
                <span style="color:#e8f0f5;font-size:14px;">${moveIn}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px;">
          <a href="https://unirenter.vercel.app/agent-portal" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">View in portal →</a>
          <p style="color:#7a96aa;font-size:12px;margin:14px 0 0;line-height:1.5;">
            Hi ${agentName} — this student ticked "Free housing assistance" on UniRenter. Reach out directly via the email above. You can update the lead status in your portal.
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#0d1f2d;padding:16px 28px;border-top:1px solid #1e3a50;">
          <p style="color:#7a96aa;font-size:11px;margin:0;">UniRenter · unirenter.com.au · Housing partner portal: unirenter.vercel.app/agent-portal</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function studentEmailHtml({ studentName, partnerName, city }) {
  const firstName = studentName ? studentName.split(' ')[0] : 'there';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0d1f2d;font-family:'Inter',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f2d;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#182f42;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
      <tr>
        <td style="background:#0d1f2d;padding:20px 28px;border-bottom:1px solid #1e3a50;">
          <span style="font-family:'Epilogue',Arial,sans-serif;font-size:20px;font-weight:800;color:#e8f0f5;">Uni<span style="color:#F5B800;">Renter</span></span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 8px;">
          <h2 style="color:#e8f0f5;font-size:20px;font-weight:700;margin:0 0 14px;font-family:'Epilogue',Arial,sans-serif;">
            Your housing assistance request is on its way 🏠
          </h2>
          <p style="color:#e8f0f5;font-size:14px;line-height:1.6;margin:0 0 16px;">
            Hey ${firstName} — your details have been shared with <strong>${partnerName}</strong>, a housing specialist in ${city}. They'll be in touch via email shortly.
          </p>
          <p style="color:#7a96aa;font-size:13px;line-height:1.6;margin:0 0 24px;">
            While you wait, you can keep browsing housemate matches on UniRenter — finding the right person to share with is just as important as finding the right place.
          </p>
          <a href="https://unirenter.vercel.app/dashboard" style="display:inline-block;background:#F5B800;color:#0d1f2d;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">Go to my matches →</a>
        </td>
      </tr>
      <tr>
        <td style="background:#0d1f2d;padding:16px 28px;border-top:1px solid #1e3a50;margin-top:28px;">
          <p style="color:#7a96aa;font-size:11px;margin:0;">UniRenter · unirenter.com.au · Free for students, always.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
