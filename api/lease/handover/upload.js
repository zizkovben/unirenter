// POST /api/lease/handover/upload
// Outgoing tenant uploads a handover document (PDF/JPG/PNG, max 10MB).
// Stores in Supabase Storage bucket 'lease-docs' at {listing_ref}/{doc_type}.{ext}
// Updates lease_handover row and returns a fresh 48hr signed URL.
//
// Body: multipart/form-data
//   listing_ref  — e.g. "MEL-2847"
//   email        — outgoing tenant email (must match original listing)
//   doc_type     — one of: condition_report | bond_form | landlord_consent | tenancy_agreement | body_corp
//   file         — the binary file

import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

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

// Maps doc_type → lease_handover column name
const DOC_TYPE_TO_COL = {
  condition_report:   'doc_condition_report',
  bond_form:          'doc_bond_form',
  landlord_consent:   'doc_landlord_consent',
  tenancy_agreement:  'doc_tenancy_agreement',
  body_corp:          'doc_body_corp'
};

const DOC_TYPE_TO_URL_COL = {
  condition_report:   'doc_condition_report_url',
  bond_form:          'doc_bond_form_url',
  landlord_consent:   'doc_landlord_consent_url',
  tenancy_agreement:  'doc_tenancy_agreement_url',
  body_corp:          'doc_body_corp_url'
};

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const SIGNED_URL_EXPIRY_SECONDS = 172800; // 48 hours

function extFromMime(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse multipart form
  const form = formidable({ maxFileSize: MAX_FILE_SIZE_BYTES });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    if (err.code === 1009) {
      return res.status(413).json({ error: 'File too large — maximum 10MB' });
    }
    return res.status(400).json({ error: 'Could not parse upload' });
  }

  const listing_ref = (fields.listing_ref?.[0] || '').trim().toUpperCase();
  const email       = (fields.email?.[0] || '').trim().toLowerCase();
  const doc_type    = (fields.doc_type?.[0] || '').trim().toLowerCase();
  const uploadedFile = files.file?.[0];

  // Validate inputs
  if (!listing_ref || !email || !doc_type || !uploadedFile) {
    return res.status(400).json({ error: 'Missing required fields: listing_ref, email, doc_type, file' });
  }

  if (!ALLOWED_DOC_TYPES.includes(doc_type)) {
    return res.status(400).json({ error: `Invalid doc_type. Must be one of: ${ALLOWED_DOC_TYPES.join(', ')}` });
  }

  const mime = uploadedFile.mimetype || '';
  if (!ALLOWED_MIME.includes(mime)) {
    return res.status(400).json({ error: 'Invalid file type — PDF, JPG, or PNG only' });
  }

  const ext = extFromMime(mime);
  if (!ext) {
    return res.status(400).json({ error: 'Unsupported file type' });
  }

  // Verify the listing exists and the email matches the poster
  const { data: listing, error: listingErr } = await supabase
    .from('lease_listings')
    .select('id, email, city, status')
    .eq('listing_ref', listing_ref)
    .maybeSingle();

  if (listingErr || !listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  if (listing.email.toLowerCase() !== email) {
    return res.status(403).json({ error: 'Email does not match the listing poster' });
  }

  // Read file bytes
  let fileBytes;
  try {
    fileBytes = fs.readFileSync(uploadedFile.filepath);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read uploaded file' });
  }

  // Build storage path: listing_ref/doc_type.ext
  const storagePath = `${listing_ref}/${doc_type}.${ext}`;

  // Upload to Supabase Storage (upsert — overwrite if re-uploading same doc type)
  const { error: uploadErr } = await supabase.storage
    .from('lease-docs')
    .upload(storagePath, fileBytes, {
      contentType: mime,
      upsert: true
    });

  if (uploadErr) {
    console.error('Storage upload error:', uploadErr);
    return res.status(500).json({ error: 'File upload failed' });
  }

  // Generate fresh signed URL (48hr)
  const { data: signedData, error: signedErr } = await supabase.storage
    .from('lease-docs')
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  const signedUrl = (!signedErr && signedData?.signedUrl) ? signedData.signedUrl : null;

  // Ensure lease_handover row exists (upsert), then update doc path + URL
  const pathCol = DOC_TYPE_TO_COL[doc_type];
  const urlCol  = DOC_TYPE_TO_URL_COL[doc_type];
  const now     = new Date().toISOString();
  const urlExpiry = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  // Try update first; if no row, insert
  const { data: existing } = await supabase
    .from('lease_handover')
    .select('id')
    .eq('listing_ref', listing_ref)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('lease_handover')
      .update({
        [pathCol]: storagePath,
        [urlCol]: signedUrl,
        doc_urls_expire_at: urlExpiry,
        updated_at: now
      })
      .eq('listing_ref', listing_ref);
  } else {
    await supabase
      .from('lease_handover')
      .insert({
        listing_ref,
        listing_id: listing.id,
        [pathCol]: storagePath,
        [urlCol]: signedUrl,
        doc_urls_expire_at: urlExpiry,
        created_at: now,
        updated_at: now
      });
  }

  // Clean up temp file
  try { fs.unlinkSync(uploadedFile.filepath); } catch (_) {}

  return res.status(200).json({
    success: true,
    listing_ref,
    doc_type,
    storage_path: storagePath,
    signed_url: signedUrl,
    expires_at: urlExpiry
  });
}
