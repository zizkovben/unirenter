// api/lease/report.js
// Records a listing report and increments report_count.
// At report_count >= 3, listing status auto-flips to 'under_review'.
// No human needed — system handles threshold enforcement automatically.
 
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const { listing_ref, report_type, detail, reporter_email } = req.body || {};
 
  if (!listing_ref || !report_type) {
    return res.status(400).json({ error: 'listing_ref and report_type are required' });
  }
 
  const VALID_TYPES = ['fake', 'scam', 'harassment', 'spam', 'other'];
  if (!VALID_TYPES.includes(report_type)) {
    return res.status(400).json({ error: 'Invalid report type' });
  }
 
  try {
    // ── 1. Fetch current listing ──────────────────────────────────────────────
    const { data: listing, error: fetchErr } = await supabase
      .from('lease_listings')
      .select('id, report_count, status, listing_ref, city')
      .eq('listing_ref', listing_ref)
      .single();
 
    if (fetchErr || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
 
    // Already removed from view
    if (['expired', 'filled', 'under_review'].includes(listing.status)) {
      return res.status(200).json({ ok: true, note: 'Already under review' });
    }
 
    // ── 2. Increment report_count and auto-flag at threshold ──────────────────
    const newCount   = (listing.report_count || 0) + 1;
    const newStatus  = newCount >= 3 ? 'under_review' : listing.status;
 
    const { error: updateErr } = await supabase
      .from('lease_listings')
      .update({
        report_count: newCount,
        status:       newStatus,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', listing.id);
 
    if (updateErr) {
      console.error('lease report update error:', updateErr);
      return res.status(500).json({ error: 'Could not record report' });
    }
 
    return res.status(200).json({
      ok:            true,
      report_count:  newCount,
      status:        newStatus,
      auto_flagged:  newStatus === 'under_review',
    });
 
  } catch (err) {
    console.error('lease/report error:', err);
    return res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
};
