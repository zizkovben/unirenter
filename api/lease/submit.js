import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);
 
// ── Scam detection ──────────────────────────────────────────────
 
const TIER1_REJECT = [
  // Phone number patterns
  { pattern: /\b04\d{8}\b/, label: 'AU_mobile' },
  { pattern: /\+61\b/, label: 'AU_intl_code' },
  { pattern: /\+234\b/, label: 'NG_intl_code' },
  { pattern: /\+91\b/, label: 'IN_intl_code' },
  { pattern: /\(0[2-9]\)\s?\d{4}\s?\d{4}/, label: 'AU_landline' },
  // Off-platform comms
  { pattern: /whatsapp|whats\s?app|wa\.me\b|chat on wa\b|message me on\b/i, label: 'whatsapp_redirect' },
  { pattern: /\btelegram\b|t\.me\/|signal me\b/i, label: 'telegram_signal' },
  // Payment scams
  { pattern: /western\s?union|wire\s?transfer|money\s?gram|moneygram/i, label: 'wire_transfer' },
  { pattern: /send\s?deposit|deposit\s?first|pay\s?deposit\s?before/i, label: 'deposit_first' },
  { pattern: /\bcrypto\b|\bbitcoin\b|\bethereum\b|\busdt\b/i, label: 'crypto_payment' },
  // Scam language
  { pattern: /\bkindly\b/i, label: 'kindly_flag' },
  { pattern: /god\s?bless|god\s?willing|as\s?god/i, label: 'religious_pressure' },
  { pattern: /going back to my country|relocating overseas|moving abroad|transferred overseas/i, label: 'overseas_departure' },
  { pattern: /\bi am (a )?private landlord\b/i, label: 'private_landlord_claim' },
  { pattern: /\bi'?m (a )?private landlord\b/i, label: 'private_landlord_claim' },
  { pattern: /\bi am legit\b|\b100%\s?real\b|\bi promise\b|\bhonest (and )?trustworthy\b/i, label: 'credibility_overclaim' },
  // External URLs (allow unirenter.com.au only)
  { pattern: /https?:\/\/(?!unirenter\.com\.au)[\w.-]+/, label: 'external_url' },
  { pattern: /www\.(?!unirenter\.com\.au)[\w.-]+/, label: 'external_url' },
];
 
const TIER2_FLAG = [
  { pattern: /\burgent\b|\bmust go\b|\bneed gone\b|\bleaving australia\b|\bvisa expired\b/i, label: 'urgency_language' },
  { pattern: /\bgoing home\b|\bemergency only\b/i, label: 'urgency_language' },
];
 
const DISPOSABLE_DOMAINS = [
  'tempmail', 'guerrillamail', 'mailinator', 'throwam',
  'sharklasers', 'yopmail', 'trashmail', 'dispostable',
  'fakeinbox', 'maildrop', 'spamgourmet', 'getairmail',
];
 
const CITY_PRICE_FLOORS = {
  melbourne: 80, sydney: 80, brisbane: 80,
  adelaide: 80, perth: 80, canberra: 80,
};
 
const CITY_SOFT_FLOORS = {
  melbourne: 130, sydney: 150, brisbane: 130,
  adelaide: 110, perth: 130, canberra: 130,
};
 
function generateListingRef(city) {
  const prefix = city.slice(0, 3).toUpperCase();
  const num = Math.floor(1000 + Math.random() * 8999);
  return `${prefix}-${num}`;
}
 
function scanText(text, patterns) {
  const flags = [];
  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) flags.push(label);
  }
  return flags;
}
 
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    email, city, suburb, property_type,
    bedrooms, weekly_rent, available_from, lease_ends,
    furnished, pets_allowed, title, description,
  } = body;
 
  // ── Basic validation ──
  const VALID_CITIES = ['melbourne', 'sydney', 'brisbane', 'adelaide', 'perth', 'canberra'];
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!VALID_CITIES.includes(city)) return res.status(400).json({ error: 'Invalid city' });
  if (!suburb || !property_type || !weekly_rent || !available_from || !lease_ends) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
 
  // ── Verify email is verified in Supabase ──
  const { data: profile } = await supabase
    .from('profiles')
    .select('email_verified')
    .eq('email', email.toLowerCase())
    .single();
  if (!profile?.email_verified) {
    return res.status(403).json({ error: 'Email not verified. Please verify your email first.' });
  }
 
  const rent = parseInt(weekly_rent, 10);
  const cityFloor = CITY_PRICE_FLOORS[city] || 80;
  const citySoftFloor = CITY_SOFT_FLOORS[city] || 130;
 
  // ── Tier 1 — auto-reject ──
  const scanFields = `${title || ''} ${description || ''}`;
  const tier1Flags = scanText(scanFields, TIER1_REJECT);
 
  if (tier1Flags.length > 0) {
    // Log for admin visibility but don't save
    console.warn('TIER1_REJECT listing from:', email, 'flags:', tier1Flags);
    // Return a generic success to avoid signal to bad actors
    return res.status(200).json({
      success: false,
      rejected: true,
      message: 'Your listing could not be posted. Please review our community guidelines.',
      flags: tier1Flags,
    });
  }
 
  if (rent < cityFloor) {
    return res.status(200).json({
      success: false,
      rejected: true,
      message: `Weekly rent of $${rent} is below our minimum listing price of $${cityFloor}/wk.`,
    });
  }
 
  // ── Check duplicate listings ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('lease_listings')
    .select('*', { count: 'exact', head: true })
    .eq('email', email.toLowerCase())
    .gte('created_at', sevenDaysAgo);
 
  // ── Tier 2 — flag for review ──
  const tier2Flags = scanText(scanFields, TIER2_FLAG);
  const emailDomain = email.split('@')[1]?.toLowerCase() || '';
  const isDisposable = DISPOSABLE_DOMAINS.some(d => emailDomain.includes(d));
  if (isDisposable) tier2Flags.push('disposable_email');
  if (rent < citySoftFloor) tier2Flags.push('low_price');
  if ((recentCount || 0) >= 2) tier2Flags.push('multiple_recent_listings');
 
  const status = tier2Flags.length > 0 ? 'pending_review' : 'active';
 
  // ── Build listing ref ──
  const listing_ref = generateListingRef(city);
  const expires_at = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
 
  // ── Save to Supabase ──
  const { data: listing, error: dbError } = await supabase
    .from('lease_listings')
    .insert({
      email: email.toLowerCase(),
      city,
      suburb: suburb.trim(),
      property_type,
      bedrooms: parseInt(bedrooms, 10) || null,
      weekly_rent: rent,
      available_from,
      lease_ends,
      furnished: furnished === true || furnished === 'true',
      pets_allowed: pets_allowed === true || pets_allowed === 'true',
      title: (title || '').slice(0, 80).trim(),
      description: (description || '').slice(0, 500).trim(),
      status,
      scam_flags: tier2Flags,
      report_count: 0,
      listing_ref,
      expires_at,
    })
    .select()
    .single();
 
  if (dbError) {
    console.error('DB error:', dbError);
    return res.status(500).json({ error: 'Failed to save listing. Please try again.' });
  }
 
  // ── Send confirmation email ──
  const statusNote = status === 'pending_review'
    ? 'Your listing is under review — we\'ll activate it within 24 hours.'
    : 'Your listing is now live on UniRenter.';
 
  try {
    await resend.emails.send({
      from: 'UniRenter <noreply@unirenter.com.au>',
      to: email,
      subject: `Your break lease listing is live — ${listing_ref}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e;">
          <div style="background:#0d1f2d;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <div style="color:#F5B800;font-size:22px;font-weight:800;letter-spacing:-0.5px;">UniRenter</div>
          </div>
          <div style="background:#f8fafc;padding:28px;border-radius:0 0 12px 12px;">
            <h2 style="font-size:18px;font-weight:700;margin:0 0 8px;">Listing confirmed 🏠</h2>
            <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px;">
              Your break lease listing has been received. ${statusNote}
            </p>
            <div style="background:#e8f4ff;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
              <div style="font-size:12px;color:#666;margin-bottom:4px;">Listing reference</div>
              <div style="font-size:20px;font-weight:800;color:#0d1f2d;letter-spacing:1px;">${listing_ref}</div>
            </div>
            <div style="font-size:13px;color:#555;line-height:1.7;margin-bottom:20px;">
              <strong>📍 ${suburb}, ${city.charAt(0).toUpperCase() + city.slice(1)}</strong><br>
              ${property_type.replace(/_/g, ' ')} · $${rent}/wk · Available ${available_from}
            </div>
            <div style="background:#fff8e1;border:1px solid #F5B800;border-radius:8px;padding:14px 18px;font-size:13px;color:#7a5c00;line-height:1.6;">
              🤠 <strong>Cob's reminder:</strong> Never share personal contact details outside UniRenter. 
              Inspections are arranged through the platform — we'll notify you when someone is interested.
            </div>
            <div style="margin-top:20px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:16px;">
              Your listing expires in 60 days. UniRenter · <a href="https://unirenter.com.au/legal" style="color:#4BBFE0;">Terms & Privacy</a>
            </div>
          </div>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error('Email send failed (non-fatal):', emailErr);
  }
 
  return res.status(200).json({
    success: true,
    listing_ref,
    status,
    message: status === 'pending_review'
      ? 'Listing received — under review. We\'ll activate it within 24 hours.'
      : 'Listing live! We\'ll email you when someone is interested.',
  });
}
 
