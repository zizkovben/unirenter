// POST /api/lease/handover/release-doc
// Outgoing tenant releases a specific document to the incoming tenant.
// Sets doc_{type}_released = true on the lease_handover row.
// Verified: caller email must match the listing poster email.
//
// Body: { listing_ref, email, doc_type }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_DOC_TYPES = [
  'condition_report',
  'bond_form',
  'landlord_consent',
  'tenancy_agreement',
  'body_corp'
];

const DOC_TYPE_TO_RELEASED_COL = {
  condition_report:  'doc_condition_report_released',
  bond_form:         'doc_bond_form_released',
  landlord_consent:  'doc_landlord_consent_released',
  tenancy_agreement: 'doc_tenancy_agreement_released',
  body_corp:         'doc_body_corp_released'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listing_ref, email, doc_type } = req.body || {};

  if (!listing_ref || !email || !doc_type) {
    return res.status(400).json({ error: 'Missing required fields: listing_ref, email, doc_type' });
  }

  const ref     = listing_ref.trim().toUpperCase();
  const addr    = email.trim().toLowerCase();
  const docType = doc_type.trim().toLowerCase();

  if (!ALLOWED_DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: 'Invalid doc_type. Must be one of: ' + ALLOWED_DOC_TYPES.join(', ') });
  }

  // Verify listing exists and caller is the outgoing tenant
  const { data: listing, error: listingErr } = await supabase
    .from('lease_listings')
    .select('id, email')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (listingErr || !listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.email.toLowerCase() !== addr) {
    return res.status(403).json({ error: 'Only the listing poster can release documents' });
  }

  // Verify the document is actually uploaded before releasing
  const pathCol = 'doc_' + docType;
  const { data: handover, error: hdErr } = await supabase
    .from('lease_handover')
    .select('id, ' + pathCol)
    .eq('listing_ref', ref)
    .maybeSingle();

  if (hdErr || !handover) return res.status(404).json({ error: 'Handover record not found' });
  if (!handover[pathCol]) {
    return res.status(400).json({ error: 'Document has not been uploaded yet' });
  }

  // Set the released flag
  const releasedCol = DOC_TYPE_TO_RELEASED_COL[docType];
  const { error: updateErr } = await supabase
    .from('lease_handover')
    .update({ [releasedCol]: true, updated_at: new Date().toISOString() })
    .eq('listing_ref', ref);

  if (updateErr) {
    console.error('release-doc update error:', updateErr);
    return res.status(500).json({ error: 'Failed to release document' });
  }

  return res.status(200).json({ success: true, listing_ref: ref, doc_type: docType, released: true });
};
