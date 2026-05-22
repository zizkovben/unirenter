# UniRenter — Project Bible & Handover Document
*Last updated: May 2025 | Prepared for Claude project continuity*

---

## MISSION STATEMENT
> "To help students settle into their accommodation quickly and for the right price, so they can focus on uni, studies, meeting friends, and enjoying the experience of studying in Australia — without housing stress."

UniRenter is a **student settlement companion**, not just a housing app. Housing is the entry point. The platform holds a student's hand from the moment they decide to come to Australia until they're settled, confident, and focused on what they came here for.

---

## WHAT HAS BEEN BUILT (prototype HTML files)

### Core app pages (main matching system)
- `index.html` — Melbourne landing page (= unirenter-v8.html)
- `unirenter-sydney.html` — Sydney version
- `unirenter-brisbane.html` — Brisbane version

### Lease board (separate pages)
- `unirenter-lease.html` — Melbourne
- `unirenter-lease-sydney.html` — Sydney
- `unirenter-lease-brisbane.html` — Brisbane

### Guide hub (legal & landlord education)
- `unirenter-guide.html` — Melbourne (VIC law)
- `unirenter-guide-sydney.html` — Sydney (NSW law)
- `unirenter-guide-brisbane.html` — Brisbane (QLD law)

### Getting Settled hub (student settlement companion)
- `unirenter-settled-melbourne.html`
- `unirenter-settled-sydney.html`
- `unirenter-settled-brisbane.html`
Covers: Health/Medicare, Transport (Myki/Opal/go card), Banking, Work rights, Beach safety, Drinking/smoking laws, Australian culture, Wildlife, Wellbeing. Features **Cob** (AI assistant).

### Feature demos (to be integrated into backend)
- `unirenter-oi.html` — Compatibility quiz + Oi/Cob assistant demo
- `unirenter-dashboard.html` — Calendar, snooze, rent calculator, profile extras (age/gen/star sign/sound effects)
- `unirenter-lease-companion.html` — Lease document reading, tenancy timeline, Cob reminders
- `unirenter-agent.html` — Agent portal with lead dashboard, stats, CSV export
- `unirenter-legal.html` — T&Cs, Privacy Policy, Copyright, Disclaimer

### Infrastructure
- `vercel.json` — Clean URL routing for Vercel deployment
- `unirenter-setup-guide.html` — Step-by-step Supabase/Vercel/DNS setup guide

---

## TECHNOLOGY STACK (planned)

### Frontend
- Pure HTML/CSS/JS (current prototype)
- Migrate to: React + Vite (recommended next step)
- Hosted: Vercel (free tier, auto-deploy from GitHub)

### Backend
- **Supabase** (PostgreSQL + Auth + Storage + Realtime)
- Region: ap-southeast-2 (Sydney)
- Free tier: 500MB DB, 1GB storage, 50k MAU

### Authentication
- Phone OTP via **Twilio Verify** (primary)
- Email OTP (secondary/fallback)
- NO social login (Facebook, Google) — intentional for privacy

### AI Features
- **Anthropic Claude API** (claude-sonnet-4-20250514)
- Powers: Cob assistant, compatibility quiz summary, lease document reading
- Cost: fractions of a cent per interaction

### Email
- **Resend.com** — transactional emails, agent lead notifications
- Trigger: Supabase webhook on `agent_leads` INSERT → email to agent

### Push notifications
- Web Push API (browser-native, no app store needed)
- Pair with email fallback (sent 30 min after push if unopened)

### Payments (future)
- **Stripe** — lease listing payments when monetisation begins
- Model: free to list, pay on first enquiry match (~$19-29)

### Domain
- `unirenter.com.au` — requires ABN (pending)
- Interim: `unirenter.vercel.app`

---

## DATABASE SCHEMA (Supabase SQL — already written)

Key tables: `profiles`, `connections`, `messages`, `agent_leads`, `lease_listings`, `reports`
Full SQL in `unirenter-setup-guide.html` Step 2.

---

## KEY PRODUCT DECISIONS (rationale recorded)

### Matching algorithm weights
- Budget overlap: 25%
- Location overlap: 20%
- Sleep schedule: 15%
- Cleanliness: 15%
- Accommodation type: 10%
- Social/party habits: 10%
- Cultural/dietary: 5%

### Verification approach
- Phone-only OTP (strongest fraud deterrent, 1 account per number)
- Email verification: "coming soon" — disabled in current build
- Uni email: optional, earns "Verified Student" badge
- NO country-level IP blocking (would exclude legitimate Indian/international students)
- Behaviour-based fraud detection instead

### Religion handling
- Removed religion identity chips (legal exposure risk)
- Kept household practice preferences (halal kitchen, no alcohol, prayer space etc)
- Used for matching only, private by default

### WhatsApp
- Removed from agent contact options (scam risk, untraceable)
- Email only for agent leads (professional, paper trail)

### Broken lease payment model
- Free to list initially (build market share first)
- Monetise later: pay on first enquiry match (~$19-29 via Stripe)

### Social media boundary (CRITICAL POLICY DECISION)
- UniRenter is a SERVICE platform, NOT a social network
- NEVER add: public feeds, public posts, public comments, public reactions
- Everything is private (profiles/messages), functional (listings/docs), or editorial (guide content)
- This avoids: content moderation burden, censorship debates, misinformation liability
- Facebook groups remain complementary (messy social) — UniRenter is structured/safe

---

## FEATURES BUILT OR DESIGNED

### Profile system
- 7-step onboarding: Verify → Profile → Status → Housing → Lifestyle → Location → Budget
- Phone OTP verification
- Photo upload with preview
- Country of origin (displayed as flag emoji)
- Student status: Future/Current/Graduate/Community member
- City-specific universities and suburbs
- Lifestyle: sleep schedule, study style, cleanliness, social/party vibe, guests, smoking, pets
- Housing preferences: accommodation type, gender preference, lease type, furnished
- Religion/cultural household preferences (private, matching only)
- Agent opt-in checkbox → email to benjcarey75@gmail.com

### Sleep mode system
- 6 modes: Study Mode, Sorted!, Holiday Mode, Exam Crunch, Just Looking, Taking a Break
- Snooze: quick 24hr–1 month per-match OR whole profile pause
- Auto-sleep timeline: Day 14 nudge → Day 30 Just Looking → Day 60 Taking a Break → Day 90 Cob check-in
- Cob check-ins during sleep (non-housing topics)

### Cob — AI assistant
- Name: Cob (short for Cobber). Tagline: "Oi Cob!"
- Personality: warm, Australian, knowledgeable, non-intrusive
- Available across: Getting Settled hub, Lease Companion, Dashboard, main app
- Knowledge base: bonds, condition reports, scams, rights (VIC/NSW/QLD), PBSA, work rights, banking, culture, wildlife, transport, health, drinking/smoking laws
- Powered by Claude API (claude-sonnet-4-20250514)
- NOT named "Oi" (renamed to Cob during development)

### Lease Companion
- Upload lease photo → Claude reads it via vision API
- Extracts: start/end date, rent, bond, notice period, inspection frequency
- Builds personalised tenancy timeline with Cob reminders
- Critical reminders: condition report (3 days), notice to vacate (28 days before deadline), bond return, routine inspections
- Also tracks: uni semester dates, public holidays, SWOTVAC/exams
- Manual entry fallback

### Calendar (Dashboard)
- 5 categories: Housing (green), Uni (blue), Work (yellow), Public Holidays (coral), Aussie Events (purple)
- Tick-box category activation/deactivation
- Views: Month / Fortnight / Week
- Cob surfaces events contextually
- Work: manual entry only (no automation yet)
- Aussie events: State of Origin, Ekka, AFL Finals, Melbourne Cup, ANZAC Day, Australia Day, Sydney NYE etc
- Cob educates on ANZAC Day, Australia Day history, public holiday significance

### Profile extras (all optional, no algorithm weight)
- Age range preference (soft filter, generational labels)
- My generation display chip (Gen Z, Millennial, etc)
- Star sign (emoji chip on profile, zero matching weight)
- Sound effects themes: Silent (default), Aussie (kookaburra/magpie), Gaming (retro), Anime/K-pop (soft chimes), Bollywood (tabla-inspired), Beach/Nature (waves), Sci-Fi (digital), Zen (bells), Sport (crowd/siren), Carnival (playful)
- 3 volume levels: Quiet / Mid / Max

### Agent portal
- Login screen → dashboard
- Lead cards with: name, uni, flag, preferences, contact method, notes
- Status cycling: New → Contacted → Inspecting → Leased
- Note-taking modal
- Email compose (opens mailto)
- CSV export
- Insights: suburb demand, budget distribution, move-in timeline, accommodation type
- Email notification on each new lead (benjcarey75@gmail.com)
- WhatsApp removed from contact options

### Rent/bond calculator
- Weekly rent → fortnightly, monthly, annual, bond amount, move-in total
- Affordability bar: <30% good, 30-45% stretched, >45% housing stress
- Bond state guidance (RTBA/NSW FT/RTA)

### Compatibility quiz
- 5 narrative questions (not chip selections)
- Claude API generates personality summary
- Shown on match cards
- 3 persona types with match/friction analysis

### Reporting system
- Report button on every match card and lease listing
- 6 categories: Fake, Scam, Harassment, Spam, Inappropriate, Other
- Block button (silent, immediate)

### Safety features
- Chat: blocks credit card patterns, BSB/account numbers
- Red flag checklist before meeting
- Legal gate on broken lease board (7 mandatory acknowledgements)
- Bond/condition report risk card (most important scam education)

---

## CONTENT: Getting Settled Hub

### All three cities cover:
1. Health & doctors (Medicare eligibility, bulk billing, OSHC)
2. Transport (city-specific card, concession, apps)
3. Banking (CommBank, NAB, Up Bank + city-specific)
4. Cost of living (groceries, coffee, eating out, tipping)
5. Work rights (48hr fortnight, minimum wage, Fair Work, TFN)
6. Job hunting (Seek, Indeed, interview tips, Australian workplace culture)
7. Beach & outdoor safety (flags, rips, sun protection)
8. Emergency contacts (000, 131 444, 1800 022 222, Lifeline)
9. Drinking laws (age 18, public drinking, drink driving)
10. Smoking/vaping laws (city-specific)
11. Cannabis laws
12. Australian culture (tall poppy, directness, sport, slang, BBQ, ANZAC Day)
13. Phone plans (city-specific recommendations)
14. Wildlife (spiders, snakes, friendly creatures, magpie swooping)
15. Homesickness & mental health (Lifeline, Beyond Blue, uni support)
16. Study support (writing centres, library, study groups)
17. Making friends & community

---

## LEGAL DOCUMENTS BUILT
- Terms & Conditions (12 clauses, Australian Privacy Act compliant)
- Privacy Policy (what collected, how used, your rights)
- Copyright Notice (© 2025 UniRenter, Cob character, Oi Cob! tagline protected)
- Platform Disclaimer (not legal/financial advice, Cob disclaimer)

---

## FACEBOOK GROUP STRATEGY
- Melbourne: ~100k members (primary traffic source)
- Sydney: ~124k members  
- Brisbane: ~67k members
- Page URLs: melbournestudentaccommodation, sydneystudentaccommodation, brisbanestudentaccommodation (SEO value)
- Strategy: pin UniRenter link, weekly value posts, scam alerts, NO Facebook SDK integration (too fragile)
- Reciprocal linking for SEO domain authority

---

## BUSINESS MODEL
- Phase 1: Free (build user base)
- Phase 2: Agent referral fees (benjcarey75@gmail.com initially)
  - Per-lead fee ($15-30) OR monthly retainer
  - Scale: one agent per city as platform grows
- Phase 3: Broken lease listing fee (pay on first match, ~$19-29 via Stripe)
- Phase 4: Premium profile features / verified landlord listings
- Domain: unirenter.com.au (requires new ABN — .com.au requires ABN)

---

## SECURITY & PRIVACY (for when going live)
- SSL: automatic via Vercel (free)
- Australian Privacy Act 1988 compliance required
- Cookie consent banner needed
- Data retention policy: active + 12 months, then anonymised
- Phone numbers: encrypted, never displayed to other users
- Religious/cultural data: private by default, matching only
- No advertising cookies, no data sold
- Supabase row-level security (RLS) on all tables
- Rate limiting on OTP endpoints
- Report threshold auto-actions: 3 reports = flagged, 5 = suspended

---

## SESSION UPDATE — May 2025
All HTML files rebuilt with:
- Hamburger nav for mobile (Samsung fold tested)
- City switcher tabs on home page  
- Dead links fixed (RTBA QLD → RTA, QCAT, CAV pets, QBCC)
- PBSA duplicates removed (Iglu Sydney×1, UniLodge Brisbane×1)
- Facebook group stats updated (Melbourne 100k, Sydney 126k, Brisbane 67k)
- Internal links updated to Vercel clean URLs
- Logo links to home page
- Break lease wording softened
- T&Cs: "not a real estate agent" clause added
- "Service not social media" clause added to T&Cs
- 4th "break lease" card removed from how-it-works
- "Find your" hero text fixed for mobile
- Favicon added (UniRenter icon) across all files
- Phone & SIM as separate tab in settled hubs

## NEXT STEPS (priority order)
1. Fix Vercel 404 (upload index.html + vercel.json to GitHub)
2. Connect Supabase to HTML files (add SDK snippet)  
3. Wire phone OTP (Twilio Verify)
4. Save profiles to database
5. Real matching algorithm
6. Real messaging
7. Agent lead emails (Resend.com webhook)
8. Push notifications
9. Claude API for Cob (live AI responses)
10. Claude API for lease reading (vision)
11. ABN registration → unirenter.com.au domain
12. Perth and Adelaide expansion

---

## VERCEL FIX INSTRUCTIONS (current issue)
The 404 error is because there is no `index.html` at the root.

**Steps to fix:**
1. Go to github.com → your `unirenter` repository
2. Click **Add file → Upload files**
3. Upload ALL 19 files listed below
4. Click **Commit changes** — Vercel auto-deploys in 30 seconds
5. Visit unirenter.vercel.app — should load Melbourne app

**Files to upload:**
- index.html (critical — fixes the 404)
- vercel.json (critical — clean URL routing)
- unirenter-sydney.html
- unirenter-brisbane.html
- unirenter-lease.html
- unirenter-lease-sydney.html
- unirenter-lease-brisbane.html
- unirenter-guide.html
- unirenter-guide-sydney.html
- unirenter-guide-brisbane.html
- unirenter-settled-melbourne.html
- unirenter-settled-sydney.html
- unirenter-settled-brisbane.html
- unirenter-agent.html
- unirenter-oi.html
- unirenter-dashboard.html
- unirenter-lease-companion.html
- unirenter-legal.html
- unirenter-setup-guide.html

**Clean URLs after upload:**
- unirenter.vercel.app → Melbourne
- unirenter.vercel.app/sydney → Sydney
- unirenter.vercel.app/brisbane → Brisbane
- unirenter.vercel.app/lease → Lease board
- unirenter.vercel.app/guide → Guide hub
- unirenter.vercel.app/settled → Getting Settled
- unirenter.vercel.app/agent → Agent portal
- unirenter.vercel.app/dashboard → Dashboard
- unirenter.vercel.app/legal → T&Cs & Privacy

---

## HOW TO CONTINUE IN A NEW CLAUDE SESSION
1. Create a new Claude Project at claude.ai
2. Upload this bible document as project knowledge
3. Upload all 19 HTML files
4. Start with: "I'm continuing development of UniRenter. Please read the project bible and all HTML files, then we'll pick up from the Next Steps list."

© 2025 UniRenter. All rights reserved.
