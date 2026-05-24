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

  const { messages, city } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Inject city context into system prompt if provided
  const systemPrompt = city
    ? `${COB_SYSTEM}\n\nCURRENT CONTEXT: The user is on the ${city} page of UniRenter, so they are likely asking about renting in ${city}.`
    : COB_SYSTEM;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
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

    return res.status(200).json({ reply, model: data.model });

  } catch (err) {
    console.error('Cob API handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
