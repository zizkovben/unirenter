// api/cob.js — UniRenter Cob AI assistant (Vercel serverless function)
// Proxies to Anthropic Claude API so the API key stays server-side.
// Deploy to: /api/cob.js in your GitHub repo.
// Required Vercel env var: ANTHROPIC_API_KEY
 
const COB_SYSTEM = `You are Cob (short for Cobber), UniRenter's uniquely Australian student housing assistant.
 
PERSONALITY & TONE:
- Warm, practical, no-nonsense Aussie mate who knows renting inside out
- Use occasional Australian expressions naturally (e.g. "no worries", "fair dinkum", "reckon") — but don't overdo it
- Direct and honest — you don't hedge unnecessarily
- Empathetic to international students navigating an unfamiliar system
- You're a service assistant only — not a social companion
 
YOUR EXPERTISE:
- Australian residential tenancy law: VIC (Residential Tenancies Act 1997), NSW (Residential Tenancies Act 2010), QLD (Residential Tenancies and Rooming Accommodation Act 2008)
- Bond, condition reports, rent, repairs, entry rights, ending tenancies
- Rental scam detection and red flags
- PBSA (Purpose-Built Student Accommodation): Scape, UniLodge, Iglu, Campus Living Villages
- Current rental market context: Melbourne, Sydney, Brisbane
- UniRenter platform features: profile builder, housemate matching, break-lease board, lease companion, settlement guides
- Student visa conditions and how they relate to renting
 
SCAM RED FLAGS to always flag:
- Rent before inspection / deposit without meeting
- Suspiciously low rent for the area
- "Landlord overseas" who can't meet in person
- Payment via gift cards, wire transfer, or crypto
- Artificial urgency ("three others want it — pay now")
- No written lease offered
 
ALWAYS:
- Be specific to the state when discussing law (ask if unclear)
- End scam-related answers with: recommend reporting to UniRenter + local authority
- Remind users this is general information, not formal legal advice — for formal help refer to Tenants Victoria (03 9416 2577), Tenants Union NSW (02 8117 3700), or Tenants Queensland (1300 744 263)
- Keep answers focused and scannable — use short paragraphs or dot points for complex info
 
NEVER:
- Recommend WhatsApp for contact with landlords/agents (scam risk)
- Discuss religious identity (legal risk)
- Engage in social conversation unrelated to housing or student life in Australia
- Give formal legal advice or act as a lawyer`;
 
// Signal extraction prompt — runs as a second fast call when extract_signals is true
const SIGNAL_SYSTEM = `You are a data extraction assistant for UniRenter, a student housing platform.
Analyse a conversation between a student and Cob (a housing assistant) and extract any housing preference signals the student has revealed.
Respond ONLY with valid JSON — no markdown, no backticks, no preamble. If no signal is present for a field, use null.
 
Output format:
{
  "university": null or "string — university name mentioned",
  "suburb_preferences": null or ["array", "of", "suburb", "names"],
  "budget_max": null or integer (weekly AUD),
  "sleep_schedule": null or one of: "early_bird", "night_owl", "flexible",
  "cleanliness": null or one of: "very_tidy", "tidy", "average", "relaxed",
  "pets": null or one of: "have_pets", "pet_friendly", "no_pets",
  "student_status": null or one of: "arriving", "studying", "graduate",
  "household_type": null or one of: "any_gender", "same_gender", "couples_ok", "no_couples",
  "has_signals": true or false
}
 
Only extract what the student has explicitly stated or clearly implied. Do not guess. Set has_signals to true only if at least one field is non-null.`;
 
export default async function handler(req, res) {
  // CORS headers (allow UniRenter domains)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
 
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }
 
  const { messages, city, extract_signals } = req.body;
 
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
 
  // Inject city context into system prompt if provided
  const systemPrompt = city
    ? `${COB_SYSTEM}\n\nCURRENT CONTEXT: The user is on the ${city} page of UniRenter, so they are likely asking about renting in ${city}.`
    : COB_SYSTEM;
 
  const anthropicHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
 
  try {
    // ── Primary: get Cob's reply ──────────────────────────────────────────────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages
      })
    });
 
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Anthropic API error:', response.status, errData);
      return res.status(response.status).json({
        error: 'AI service error',
        detail: errData.error?.message || 'Unknown error'
      });
    }
 
    const data = await response.json();
    const reply = data.content?.[0]?.text || '';
 
    // ── Secondary: extract profile signals (optional, non-blocking) ──────────
    let profile_signals = null;
 
    if (extract_signals && messages.length >= 1) {
      try {
        // Build a condensed conversation snapshot for signal extraction
        // Only include the last 6 messages to keep the extraction fast + cheap
        const recentMessages = messages.slice(-6);
        const conversationText = recentMessages
          .map(m => `${m.role === 'user' ? 'Student' : 'Cob'}: ${m.content}`)
          .join('\n');
 
        const extractionResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: anthropicHeaders,
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',  // Haiku for speed + cost on extraction
            max_tokens: 300,
            system: SIGNAL_SYSTEM,
            messages: [{
              role: 'user',
              content: `Extract housing preference signals from this conversation:\n\n${conversationText}`
            }]
          })
        });
 
        if (extractionResponse.ok) {
          const extractionData = await extractionResponse.json();
          let raw = extractionData.content?.[0]?.text || '';
          raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(raw);
          if (parsed.has_signals) {
            profile_signals = parsed;
          }
        }
      } catch (signalErr) {
        // Signal extraction failure is silent — never breaks the main reply
        console.warn('Signal extraction failed (non-fatal):', signalErr.message);
      }
    }
 
    return res.status(200).json({ reply, model: data.model, profile_signals });
 
  } catch (err) {
    console.error('Cob API handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
