// api/household/get.js — S45
// GET /api/household/get?household_id=<uuid>&email=<email>
// Returns household data + member profiles (name, uni, vibe emoji, compatibility fields).
// CommonJS

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // S151: this is a dynamic, frequently-repeated GET (household composition
  // rarely changes call-to-call) — confirmed via live Network tab that it was
  // being served as a 304 with no body, which made res.json() throw client-
  // side and surfaced as a generic "could not reach the server" failure.
  // Explicitly disabling caching stops any CDN/browser layer from doing this.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { household_id, email: rawEmail } = req.query || {};
    if (!household_id) return res.status(400).json({ ok: false, error: 'household_id required' });
    // S151: same normalisation fix as api/messages/get.js (S150) and
    // api/household/create.js (S151) — a mixed-case email at signup should
    // never make this membership check silently fail.
    const email = rawEmail ? rawEmail.toLowerCase().trim() : rawEmail;

    // Verify caller is a member of this household (if email provided)
    if (email) {
      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('household_id', household_id)
        .ilike('email', email)
        .maybeSingle();

      if (!membership) {
        return res.status(403).json({ ok: false, error: 'Not a member of this household.' });
      }
    }

    // Fetch household row
    const { data: household, error: hhErr } = await supabase
      .from('households')
      .select('id, created_by, invite_token, created_at')
      .eq('id', household_id)
      .single();

    if (hhErr || !household) {
      return res.status(404).json({ ok: false, error: 'Household not found.' });
    }

    // Fetch members
    const { data: memberRows, error: memberErr } = await supabase
      .from('household_members')
      .select('email, joined_at, tenancy_confirmed_at')
      .eq('household_id', household_id)
      .order('joined_at', { ascending: true });

    if (memberErr) {
      console.error('household_members fetch error:', memberErr);
      return res.status(500).json({ ok: false, error: 'Could not load members.' });
    }

    const memberEmails = (memberRows || []).map(function(m) { return m.email; });

    // Fetch profiles for all members
    // Only pull the fields needed for compatibility display — no sensitive data
    const { data: profiles, error: profileErr } = await supabase
      .from('profiles')
      .select('email, display_name, university, vibe_emoji_primary, vibe_emoji_secondary, cob_summary, sleep_schedule, cleanliness, guests, household_type, city')
      .in('email', memberEmails);

    if (profileErr) {
      console.error('profiles fetch error:', profileErr);
      // Non-fatal — return household with empty member profiles
    }

    const profileMap = {};
    (profiles || []).forEach(function(p) { profileMap[p.email] = p; });

    // S146: lease_companions lookup — one row per email, upserted from the
    // Lease Companion tool. Powers the layered timeline widget (each
    // member's own lease_start/lease_end shown individually, plus an
    // earliest-start/latest-end household summary computed client-side).
    // Non-fatal if it errors — household still renders without timeline data.
    let leaseMap = {};
    try {
      const { data: leaseRows } = await supabase
        .from('lease_companions')
        .select('email, lease_start, lease_end, property_description')
        .in('email', memberEmails);
      (leaseRows || []).forEach(function(l) { leaseMap[l.email] = l; });
    } catch (leaseErr) {
      console.warn('lease_companions fetch error (non-fatal):', leaseErr.message);
    }

    // Build member array in join order
    const members = (memberRows || []).map(function(m) {
      const p = profileMap[m.email] || {};
      const l = leaseMap[m.email] || {};
      return {
        email:              m.email,
        joined_at:          m.joined_at,
        display_name:       p.display_name || null,
        university:         p.university   || null,
        city:               p.city         || null,
        vibe_emoji_primary: p.vibe_emoji_primary   || null,
        vibe_emoji_secondary: p.vibe_emoji_secondary || null,
        cob_summary:        p.cob_summary   || null,
        sleep_schedule:     p.sleep_schedule || null,
        cleanliness:        p.cleanliness   || null,
        guests:             p.guests        || null,
        household_type:     p.household_type || null,
        lease_start:        l.lease_start   || null,
        lease_end:          l.lease_end     || null,
        lease_property:     l.property_description || null,
        // S148: Cob end-of-tenancy prompt re-ask timing (see tenancy-check.js)
        tenancy_confirmed_at: m.tenancy_confirmed_at || null
      };
    });

    return res.status(200).json({
      ok: true,
      data: {
        id:          household.id,
        created_by:  household.created_by,
        created_at:  household.created_at,
        invite_token: household.invite_token,
        member_count: members.length,
        members:     members
      }
    });

  } catch (err) {
    console.error('household/get unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};
