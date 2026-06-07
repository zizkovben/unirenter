// api/lease/stripe-webhook.js
// Handles Stripe webhook events for lease connection fees.
// Only active when STRIPE_ENABLED=true (env var).
// On checkout.session.completed:
//   - Creates the lease_handover row
//   - Sends the outgoing tenant notification email
// S36: new file.

const { createClient }    = require('@supabase/supabase-js');
const { Resend }           = require('resend');
const { createHandoverAndNotify } = require('./interest');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stripe is only initialised when STRIPE_ENABLED=true.
const STRIPE_ENABLED = (process.env.STRIPE_ENABLED || 'false').toLowerCase() === 'true';

let stripe = null;
if (STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Vercel doesn't parse body for webhooks — we need raw body.
// Set config to disable body parsing for this route.
module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!STRIPE_ENABLED || !stripe) {
    return res.status(503).json({ error: 'Stripe not enabled' });
  }

  // Read raw body for signature verification
  const rawBody = await readRawBody(req);
  const sig     = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Only handle completed checkouts
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const {
    listing_ref,
    incoming_email,
    incoming_name,
    outgoing_email,
    city,
    listing_id,
  } = session.metadata || {};

  if (!listing_ref || !incoming_email || !outgoing_email) {
    console.error('Stripe webhook: missing metadata', session.metadata);
    return res.status(400).json({ error: 'Missing required metadata' });
  }

  try {
    // Reconstruct the minimal listing object needed by the shared helper
    const listing = {
      listing_ref,
      id:          Number(listing_id),
      email:       outgoing_email,
      city,
      suburb:      session.metadata.suburb || '',
      weekly_rent: session.metadata.weekly_rent ? Number(session.metadata.weekly_rent) : null,
      title:       session.metadata.title || null,
    };

    await createHandoverAndNotify(
      listing,
      incoming_email,
      incoming_name || null,
      session.metadata.incoming_uni || null
    );

    console.log(`Stripe webhook: handover created for ${listing_ref} after payment`);
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Stripe webhook processing error:', err);
    return res.status(500).json({ error: 'Processing failed' });
  }
};

// Helper: read raw body from request stream
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
