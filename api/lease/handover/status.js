// GET /api/lease/handover/status?ref={listing_ref}
// Returns the shared deal room state for both outgoing and incoming tenant.
// Regenerates signed URLs on every call (48hr expiry from Supabase Storage).

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SIGNED_URL_EXPIRY_SECONDS = 172800; // 48 hours

const STEP_FLAGS = [
  's1_outgoing', 's1_incoming',
  's2_outgoing',
  's3_outgoing', 's3_incoming',
  's4_outgoing', 's4_incoming',
  's5_incoming',
  's6_outgoing', 's6_incoming'
];

const DOC_FIELDS = [
  { path_col: 'doc_condition_report',  url_col: 'doc_condition_report_url',  label: 'Condition report' },
  { path_col: 'doc_bond_form',         url_col: 'doc_bond_form_url',         label: 'Bond lodgement form' },
  { path_col: 'doc_landlord_consent',  url_col: 'doc_landlord_consent_url',  label: 'Landlord consent' },
  { path_col: 'doc_tenancy_agreement', url_col: 'doc_tenancy_agreement_url', label: 'Tenancy agreement' },
  { path_col: 'doc_body_corp',         url_col: 'doc_body_corp_url',         label: 'Body corp / house rules' }
];

function calcPercent(row) {
  const done = STEP_FLAGS.filter(f => row[f] === true).length;
  return Math.round((done / STEP_FLAGS.length) * 100);
}

function buildUrlMap(row) {
  const urls = {};
  for (const doc of DOC_FIELDS) {
    urls[doc.path_col] = row[doc.url_col] || null;
  }
  return urls;
}

async function refreshSignedUrls(row) {
  const expiry = row.doc_urls_expire_at ? new Date(row.doc_urls_expire_at) : null;
  const now = new Date();
  const needsRefresh = !expiry || (expiry - now) < 10 * 60 * 1000;

  if (!needsRefresh) {
    return { urls: buildUrlMap(row) };
  }

  const updates = {};
  const urls = {};

  for (const doc of DOC_FIELDS) {
    const storagePath = row[doc.path_col];
    if (storagePath) {
      const { data, error } = await supabase.storage
        .from('lease-docs')
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
      if (!error && data && data.signedUrl) {
        updates[doc.url_col] = data.signedUrl;
        urls[doc.path_col] = data.signedUrl;
      } else {
        urls[doc.path_col] = null;
      }
    } else {
      urls[doc.path_col] = null;
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.doc_urls_expire_at = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();
    updates.updated_at = new Date().toISOString();
    await supabase
      .from('lease_handover')
      .update(updates)
      .eq('listing_ref', row.listing_ref);
  }

  return { urls };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ref = (req.query.ref || '').trim().toUpperCase();
  if (!ref) return res.status(400).json({ error: 'Missing listing ref' });

  const { data: row, error } = await supabase
    .from('lease_handover')
    .select('*')
    .eq('listing_ref', ref)
    .maybeSingle();

  if (error) {
    console.error('lease_handover fetch error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!row) {
    return res.status(200).json({
      exists: false,
      listing_ref: ref,
      percent_complete: 0,
      steps: {},
      docs: {},
      doc_request_sent: false,
      completed_at: null
    });
  }

  const { urls } = await refreshSignedUrls(row);

  const steps = {};
  for (const flag of STEP_FLAGS) {
    steps[flag] = row[flag] === true;
  }

  const docs = {};
  for (const doc of DOC_FIELDS) {
    docs[doc.path_col] = {
      uploaded: !!row[doc.path_col],
      url: urls[doc.path_col] || null,
      label: doc.label
    };
  }

  return res.status(200).json({
    exists: true,
    listing_ref: row.listing_ref,
    listing_id: row.listing_id,
    percent_complete: calcPercent(row),
    steps,
    docs,
    doc_request_sent: row.doc_request_sent === true,
    doc_request_sent_at: row.doc_request_sent_at || null,
    completed_at: row.completed_at || null,
    files_deleted: row.files_deleted === true
  });
};
