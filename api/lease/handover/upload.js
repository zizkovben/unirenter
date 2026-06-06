// POST /api/lease/handover/upload
// Outgoing tenant uploads a handover document (PDF/JPG/PNG, max 10MB).
// Accepts base64-encoded file in JSON body (no multipart needed).
// Stores in Supabase Storage bucket 'lease-docs' at {listing_ref}/{doc_type}.{ext}
// Updates lease_handover row and returns a fresh 48hr signed URL.
//
// Body (JSON):
//   listing_ref  — e.g. "MEL-2847"
//   email        — outgoing tenant email (must match original listing)
//   doc_type     — condition_report | bond_form | landlord_consent | tenancy_agreement | body_corp
//   file_base64  — base64-encoded file content
//   file_mime    — MIME type: application/pdf | image/jpeg | image/png
//   file_name    — original filename (for ext detection fallback)

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_DOC_TYPES = [
  'condition_report', 'bond_form', 'landlord_consent', 'tenancy_agreement', 'body_corp'
];

const DOC_TYPE_TO_COL = {
  condition_report:  'doc_condition_report',
  bond_form:         'doc_bond_form',
  landlord_consent:  'doc_landlord_consent',
  tenancy_agreement: 'doc_tenancy_agreement',
  body_corp:         'doc_body_corp'
};

const DOC_TYPE_TO_URL_COL = {
  condition_report:  'doc_condition_report_url',
  bond_form:         'doc_bond_form_url',
  landlord_consent:  'doc_landlord_consent_url',
  tenancy_agreement: 'doc_tenancy_agreement_url',
  body_corp:         'doc_body_corp_url'
};

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BASE64_LENGTH = 14 * 1024 * 1024; // ~10MB binary becomes ~13.3MB base64
const SIGNED_URL_EXPIRY_SECONDS = 172800; // 48 hours

function extFromMime(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listing_ref, email, doc_type, file_base64, file_mime } = req.body || {};

  if (!listing_ref || !email || !doc_type || !file_base64 || !file_mime) {
    return res.status(400).json({ error: 'Missing required fields: listing_ref, email, doc_type, file_base64, file_mime' });
  }

  const ref      = listing_ref.trim().toUpperCase();
  const addr     = email.trim().toLowerCase();
  const docType  = doc_type.trim().toLowerCase();
  const mime     = file_mime.trim().toLowerCase();

  if (!ALLOWED_DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: 'Invalid doc_type. Must be one of: ' + ALLOWED_DOC_TYPES.join(', ') });
  }

  if (!ALLOWED_MIME.includes(mime)) {
    return res.status(400).json({ error: 'Invalid file type. PDF, JPG, or PNG only.' });
  }

  if (file_base64.length > MAX_BASE64_LENGTH) {
    return res.status(413).json({ error: 'File too large — maximum 10MB' });
  }

  const ext = extFromMime(mime);
  if (!ext) return res.status(400).json({ error: 'Unsupported file type' });

  // Decode base64
  let fileBytes;
  try {
    fileBytes = Buffer.from(file_base64, 'base64');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid base64 file data' });
  }

  // Verify listing exists and email matches poster
  const { data: listing, error: listingErr } = await supabase
    .from('lease_listings')
    .select('id, email, city, status')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (listingErr || !listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.email.toLowerCase() !== addr) {
    return res.status(403).json({ error: 'Email does not match the listing poster' });
  }

  const storagePath = ref + '/' + docType + '.' + ext;

  // Upload to Supabase Storage
  const { error: uploadErr } = await supabase.storage
    .from('lease-docs')
    .upload(storagePath, fileBytes, { contentType: mime, upsert: true });

  if (uploadErr) {
    console.error('Storage upload error:', uploadErr);
    return res.status(500).json({ error: 'File upload failed' });
  }

  // Generate signed URL
  const { data: signedData, error: signedErr } = await supabase.storage
    .from('lease-docs')
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  const signedUrl  = (!signedErr && signedData && signedData.signedUrl) ? signedData.signedUrl : null;
  const pathCol    = DOC_TYPE_TO_COL[docType];
  const urlCol     = DOC_TYPE_TO_URL_COL[docType];
  const now        = new Date().toISOString();
  const urlExpiry  = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  // Upsert handover row
  const { data: existing } = await supabase
    .from('lease_handover')
    .select('id')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('lease_handover')
      .update({ [pathCol]: storagePath, [urlCol]: signedUrl, doc_urls_expire_at: urlExpiry, updated_at: now })
      .eq('listing_ref', ref);
  } else {
    await supabase
      .from('lease_handover')
      .insert({ listing_ref: ref, listing_id: listing.id, [pathCol]: storagePath, [urlCol]: signedUrl, doc_urls_expire_at: urlExpiry, created_at: now, updated_at: now });
  }

  return res.status(200).json({
    success: true,
    listing_ref: ref,
    doc_type: docType,
    storage_path: storagePath,
    signed_url: signedUrl,
    expires_at: urlExpiry
  });
};
