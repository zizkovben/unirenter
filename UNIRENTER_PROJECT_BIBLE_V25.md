# UNIRENTER PROJECT BIBLE V25
_Last updated: Session 23 — 5 June 2026_

---

## Mission

Help students settle into accommodation quickly and for the right price — without housing stress.

**What UniRenter is:** A student settlement companion. Housing matching is the entry point. The platform guides international and domestic students through finding a housemate, understanding their legal rights, settling into Australian life, and managing their tenancy — all in one place.

**What UniRenter is NOT:**
- Not a real estate agent (no licence under any state Property Act)
- Not a social media platform — no public feeds, posts, or comments ever
- Not a Facebook replacement — Facebook groups are complementary traffic sources

---

## Live Product

| Property | Value |
|---|---|
| Live URL | unirenter.vercel.app |
| GitHub | github.com/zizkovben/unirenter |
| Cities live | Melbourne (/), Sydney (/sydney) |
| Cities built, pending deploy | Brisbane (/brisbane) · Adelaide (/adelaide) · Perth (/perth) · Canberra (/canberra) · Landlords (/landlords) · Session 18–23 files ready to deploy |
| Cities planned next round | Gold Coast (Brisbane suburb group — already in Brisbane page) |
| Tech | Pure HTML/CSS/JS — no framework, no build step |
| Deployment | Vercel — auto-deploy from GitHub (free tier) |
| Database | Supabase (ap-southeast-2 Sydney) — schema live, profiles saving ✅ |
| Domain | unirenter.com.au ✅ registered + verified with Resend |
| ABN | ✅ Registered |

---

## CRITICAL TECHNICAL DECISION — DO NOT REVERSE

UniRenter is pure HTML/CSS/JS. Every page is a self-contained .html file with CSS and JS inline. There is no React, no Next.js, no Vite, no build step, no node_modules. Do not suggest any framework migration. API calls from HTML pages use fetch() to Vercel serverless functions.

**Do NOT suggest React, Next.js, Vite, TypeScript, Tailwind, or npm.**
**Do NOT suggest npm install, package.json changes, or build steps.**

---

## CRITICAL — Working With City HTML Files

City HTML files are **~580KB** because the nav logo is a base64-encoded PNG embedded on a single line. This makes them impossible to paste into chat, store in project knowledge, or regenerate.

**The only safe method for ALL edits (big or small):**
1. User uploads the file as a **file attachment** in the chat
2. Claude copies it to `/home/claude/`
3. Claude applies surgical Python `str.replace()` — skipping any line containing `data:image/png;base64,`
4. Claude runs syntax check (JSON-LD as JSON, main JS with `new Function()`)
5. Claude presents the file for download

**Never:** paste the file into chat · store in project knowledge · use `sed` · regenerate the full file · read or print the base64 line · use the `view` tool on the full file.

Non-city pages (guide, settled, lease, dashboard, cob, etc.) can be fetched directly from GitHub via `curl` — no upload needed unless the user has a locally modified version.

**CRITICAL — Nav surgery lessons (Session 21):**
When adding city badge or reordering nav elements on non-city pages:
- The favicon is a `<link rel="icon" data:image/png...>` in `<head>` — NEVER confuse this with the nav logo `<img>`
- The nav logo line contains `<div class="nav-logo"><img src="data:image/png;base64,...`
- Badge insertion must use string anchor `</a>\n  <div class="nav-dropdown-wrap">` or `</a>\n  <div class="nav-right-group">` — never line-by-line nav reconstruction
- Nav rebuild function: collect dd-items and housing button by string search, never copy base64 lines
- Guide pages and settled pages have different nav CSS structures — always inject full nav CSS block if `nav .nav-logo-link` is missing
- Remove `justify-content:space-between` from nav CSS — use `gap:10px` instead

---

## Services Configured

| Service | Status | Notes |
|---|---|---|
| Vercel | ✅ Live | 5 env vars set |
| Supabase | ✅ Live | Profiles saving — confirmed working |
| Resend.com | ✅ Live | Sending from noreply@unirenter.com.au |
| Domain | ✅ Registered | unirenter.com.au registered and verified with Resend |
| ABN | ✅ Registered | |
| Twilio | Deferred | Phone OTP deferred until revenue justifies cost |
| Stripe | Future | Lease listing activation fee — Jan 2027 |
| Anthropic Claude API | ✅ Live | claude-sonnet-4-20250514 — powers Cob chat + nudges |

### Vercel Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL` ✅
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅
- `RESEND_API_KEY` ✅
- `ANTHROPIC_API_KEY` ✅

### API Routes (Vercel Serverless Functions)
- `POST /api/auth/send-email-otp` ✅
- `POST /api/auth/verify-email-otp` ✅
- `POST /api/profile/save` ✅ city-validated
- `GET /api/profile/get` ✅ built S22 — returns profile by email for dashboard
- `POST /api/matches` ✅ real scoring engine, near_misses added S18, falls back to dummies
- `POST /api/notify/register` ✅ coming soon notify — upserts coming_soon_notify, sends Resend confirmation, auto-broadcast trigger — built S18
- `POST /api/cob` ✅ proxies to Anthropic Claude API — signal extraction added S22
- `POST /api/reviews/submit` ✅ saves review to Supabase (status: pending) — built S17
- `GET /api/reviews/list` ✅ returns approved reviews by city — built S17
- `POST /api/landlords/join` ✅ saves landlord waitlist entry, sends Resend confirmation — built S17

---

## Auth & Profile Flow (LIVE)

**Verification is deferred to "Show my matches" — not at Step 1.**

1. Student enters email at Step 1 → stored in localStorage only (no OTP yet)
2. Student completes Steps 2–7 of profile builder
3. On "Show my matches" → verify modal opens → OTP sent via Resend → student verifies
4. On successful verification → `saveProfileToSupabase()` fires → profile row created
5. `generateMatches()` calls `/api/matches` → real matches or coming soon card

**Cob FAB trigger:** Appears when student advances to Step 2 (email entered + Next clicked) — NOT waiting for OTP verification.

### localStorage keys:
- `unirenter_email` — email entered at Step 1 (not yet verified)
- `unirenter_email_verified` — `'1'` after OTP verified
- `unirenter_profile_complete` — 0–100
- `unirenter_theme` — 'light' or 'dark' — **used by ALL pages including dashboard**
- `ur_university`, `ur_sleep`, `ur_cleanliness`, `ur_seeking`, `ur_budget_min`, `ur_budget_max`, `ur_household`, `ur_guests`, `ur_pets`, `ur_student_status`, `ur_study_location`, `ur_city` — profile field cache written by dashboard after Supabase fetch, and by Cob signal saves
- `ur_cob_refined` — JSON array of field keys updated by Cob (e.g. `["university","sleep_schedule"]`) — drives 🤠 badge display on dashboard

---

## Design System

### Colour Palette
| Variable | Hex | Usage |
|---|---|---|
| `--brand-yellow` | #F5B800 | Primary CTA, Cob FAB |
| `--brand-coral` | #E8623A | Warnings, Break lease |
| `--brand-blue` | #4BBFE0 | Links, labels |
| `--brand-green` | #3DAA5C | Success, verified |
| `--navy` | #0d1f2d | Page + nav background |
| `--navy-mid` | #162535 | Secondary background |
| `--card-bg` | #182f42 | Card surface |
| `--text` | #e8f0f5 | Body text |
| `--text-muted` | #7a96aa | Secondary text |
| `--font-display` | 'Epilogue', sans-serif | Headings |
| `--font-body` | 'Inter', sans-serif | Body |

### Nav CTA — Uniform Standard (LOCKED Session 15)
All non-city pages use a single uniform nav CTA label: **`🏠 Find housing`** linking to the relevant city root (`/`, `/sydney`, `/brisbane`, `/adelaide`, `/perth`, `/canberra`). No variations.

### Day/Night Theme Toggle — Standard (LOCKED Session 15)
All student-facing pages have a `🌙/☀️` toggle button (`id="btn-theme"`) in the top-right of the nav, to the right of the primary CTA. Preference persists via `localStorage` key `unirenter_theme` ('light' or 'dark') across the entire platform. Nav always stays dark regardless of mode.

### Nav Right Group — Standard (LOCKED Session 20)
All non-city pages wrap the Find housing CTA, Explore button, and theme toggle in `<div class="nav-right-group">`. Order is: **Find housing · Explore ▾ · 🌙**. City badge `<div class="city-badge">📍 City</div>` sits between the logo `</a>` and `nav-right-group` as a direct flex child of `<nav>`. Never use inline `style="display:flex..."` on the nav-right-group wrapper.

### City Badge — Standard (Session 21)
All non-city pages (guide, settled, lease) display `<div class="city-badge">📍 City</div>` between the logo and nav-right-group. Decorative only — not a link. Hidden on mobile (max-width:480px). CSS uses `var(--blue,#4BBFE0)` for colour (not `--brand-blue` which doesn't exist on settled/guide pages).

### Translation — Google Translate Standard (Session 21/22)
All pages with a translate bar use Google Translate via `window.location.href` (in-tab, not new window). 18 languages. Brand terms protected with `<span class="notranslate">` — specifically "Cob" on all pages. "UniRenter" is already protected as a proper noun by Google. Apply `.notranslate { translate: no; }` CSS to all pages. Bundle `notranslate` fix for "Cob" into every city page upload going forward. **Do NOT use DeepL or in-app translation until revenue justifies it — revisit Session 31+.**

---

## Cob — AI Housing Assistant

**Name:** Cob (short for Cobber)
**Tagline:** Oi Cob! 🤠 (student-facing) · Hi, I'm Cob (landlord-facing — more professional register, same brand)
**Emoji:** 🤠 — NOT 🏠
**Role:** Settlement companion for students. Platform guide for landlords. Warm, helpful, always present, always working in the user's best interest.
**Powered by:** Claude API via `/api/cob` ✅ LIVE
**Philosophy:** Cob builds a relationship. One nudge at a time — never overwhelming. Never gives formal legal advice, but IS knowledgeable and specific about tenancy law, repair timeframes, and tenant rights. For landlords, Cob guides through platform steps only.

**IMPORTANT — "Cob" must never be translated.** Wrap every instance in `<span class="notranslate">Cob</span>` on all pages with a translate bar. "Cob" in Spanish becomes "mazorca" (corn cob) which is meaningless. The name must stay in English across all languages.

---

### Cob Phase 1 — Static Nudges (LIVE ✅)

**Trigger:** FAB appears when student advances to Step 2 (email entered). Also appears immediately on page load if `unirenter_email` or `unirenter_email_verified` is set in localStorage (returning visitor).

**Welcome nudge (800ms after Step 2):**
> "Welcome to UniRenter! I'm Cob — I'll be with you every step 🤠 Tap me any time you have a question."

**Step nudges (800ms after arriving at each step):**

| Step | Message |
|---|---|
| Step 2 — Photo | "A real photo gets you 3× more connections 📸 — international students especially, it shows you're genuine and builds trust." |
| Step 3 — Status | "Just arriving in Australia? Most international students find their first housemate within 2 weeks here. You're doing great! 🙌" |
| Step 4 — Housing | "Not sure what to pick? A private room in a share house is the most popular choice — your own space, shared costs." |
| Step 5 — Lifestyle | "Be honest here — mismatched sleep schedules cause more housemate friction than almost anything else. Pick what's actually true for you." |
| Step 6 — Location | "Pick suburbs close to your uni first. A short commute saves 1–2 hours a day — really adds up during exam season. 📚" |
| Step 7 — Budget | City-specific (see city data below) |

**Budget dynamic nudge (1.5s into Step 7, city-specific threshold):**
- Melbourne: fires if budget < $200 → "That budget is very tight for Melbourne 😬 — Cob found more matches at $220–260/wk."
- Sydney: fires if budget < $250 → "That budget is very tight for Sydney 😬 — Cob found more matches at $280–320/wk."
- Brisbane: fires if budget < $190 → "That budget is very tight for Brisbane 😬 — Cob found more matches at $230–270/wk."
- Adelaide: fires if budget < $160 → "That budget is very tight for Adelaide 😬 — Cob found more matches at $180–220/wk."
- Perth: fires if budget < $185 → "That budget is very tight for Perth 😬 — Cob found more matches at $220–260/wk."
- Canberra: fires if budget < $200 → "That budget is very tight for Canberra 😬 — Cob found more matches at $220–260/wk."

---

### Cob Phase 2 — Dynamic Match Nudges (LIVE ✅ — Session 18)

**Core philosophy:**
- Only fires if matches < 4
- One nudge at a time — highest unlock value first
- Cob suggests, never changes preferences silently
- Only nudge if unlock adds 5+ matches
- "Good to know 👍" button dismisses nudge and advances to next near_miss

**`/api/matches` returns (updated S18):**
```json
{
  "matches": [...],
  "near_misses": [
    { "constraint": "suburb", "unlock": 8, "suburbs": ["Carlton", "Fitzroy"], "label": "location", "suggestion": "Adding Carlton, Fitzroy would unlock 8 more matches" },
    { "constraint": "budget", "unlock": 5, "amount": 30, "label": "budget", "suggestion": "Widening your budget by +$30/wk would unlock 5 more matches" },
    { "constraint": "accommodation_type", "unlock": 6, "alternatives": ["Share apartment"], "label": "accommodation", "suggestion": "Opening up to Share apartment would unlock 6 more matches" }
  ]
}
```
near_misses only included when matches < 4. Sorted by unlock value descending. Min unlock threshold: 5.

---

### Cob Phase 3 — Profile Signal Extraction (LIVE ✅ — Session 22)

When a student chats with Cob (on the `/cob` page or city page FAB), the API now runs a secondary Haiku extraction pass after every reply. It detects housing preferences mentioned in conversation — university, suburb preferences, budget, sleep schedule, cleanliness, pets, student status, household type — and returns them as `profile_signals`.

The calling page (`unirenter-cob.html` and city pages when uploaded) then:
1. Saves signals to Supabase via `/api/profile/save`
2. Writes `ur_*` localStorage cache keys
3. Updates `ur_cob_refined` list — the fields Cob has touched
4. Dashboard shows 🤠 Cob badge on any profile row Cob has refined

Signal extraction failure is always silent — never breaks the main Cob reply.

---

### Cob — Repairs & Maintenance Knowledge (LIVE ✅ — Session 22 system prompt update)

Cob is now explicitly knowledgeable about repairs and maintenance. Students can ask Cob about repair rights and timeframes and get specific, state-aware answers.

**Emergency repair timeframes by state:**
| State | Landlord response time | Self-arrange limit | Authority |
|---|---|---|---|
| VIC | 24 hours | $2,500 | Consumer Affairs Victoria — 1300 558 181 |
| NSW | Immediately / urgent | $1,000 | NSW Fair Trading — 13 32 20 |
| QLD | Immediately / ASAP | $1,800 | RTA Queensland — 1300 366 311 |
| SA | Immediately | Reasonable costs | CBS South Australia — 131 882 |
| WA | As soon as practicable | $1,100 | Consumer Protection WA — 1300 30 40 54 |
| ACT | 24 hours | $150 (or more with ACAT approval) | Access Canberra — 13 22 81 |

---

### Cob Phase 4 — Break Lease Handover Guide (PLANNED — Session 26+)

Cob takes an active guiding role during the break lease transaction, serving both the outgoing and incoming tenant simultaneously but with different framing for each.

---

### Cob for Landlords (PLANNED — Session 25+)

Cob guides landlords through completing their listing on UniRenter. Same brand, professional register. Triggered from the landlord portal listing form.

---

## Cob Questionnaire → Dashboard Profile Integration (LIVE ✅ — Session 22)

The `/cob` standalone page now reads `unirenter_email` from localStorage. Conversation signals are extracted server-side and saved back to Supabase. Dashboard shows 🤠 Cob badge on any profile field Cob has refined. Profile completion banner shows when `profile_complete < 80%` with a city-aware link back to the correct city profile builder step.

---

## Coming Soon Card (LIVE ✅ — Session 18)

Shows when real matches = 0, or < 4 in a new city, or when all matches are inactive.

- Shows alongside real cards when 1–3 matches; full-width when 0 matches
- Email pre-filled from localStorage `unirenter_email` if available
- "Notify me" button calls `/api/notify/register` — saves to `coming_soon_notify` Supabase table
- Confirmation email sent via Resend immediately on registration
- Auto-broadcast fires when BOTH conditions met:
  - Condition A: ≥15 verified profiles in city (≥10 for Canberra)
  - Condition B: ≥60% of those profiles get ≥3 matches against each other
  - Broadcast checked on every new registration — no cron job needed
  - `city_status.city_launched = true` prevents repeat broadcasts
- localStorage flag `unirenter_notify_{city}` = '1' prevents re-showing notify form

---

## Break Lease Board — Full Specification

### The Problem Being Solved
Students desperate to break leases currently post on Facebook groups with no process, no legal protection, no verification, and no document trail. Both parties are exposed — the outgoing tenant to ongoing rent liability, the incoming tenant to inheriting undocumented damage and losing their bond for someone else's wear and tear. UniRenter owns this space properly with a structured, legally-aware, Cob-guided transaction. No other platform does this.

### The Bond Injustice — Core Insight
The incoming tenant takes over a property that already has wear and tear from the previous tenant. When they eventually leave, they are judged against the **original** entry condition report from the beginning of the tenancy — not from when they moved in. Without a thorough mid-tenancy condition assessment at the point of handover, they are exposed to bond claims for damage they did not cause.

**UniRenter's protection:** A mandatory, documented condition walkthrough at the point of key exchange establishes a clear line of responsibility. Everything before that point is the outgoing tenant's liability. Everything after is the incoming tenant's. Both parties tick-confirm the property is at the standard documented in the attached photos and condition report before keys and money exchange.

### Monetisation Model (LOCKED)
- **Free to use** — from launch until **January 2027**
- **From January 2027:** Outgoing tenant pays a **listing activation fee (~$15 via Stripe)** at the point of posting
- **Incoming tenant pays nothing — ever.**
- **60-day no-match policy:** Platform credit equal to listing fee. No cash refund. No escrow — requires real estate licence.

---

## Repairs & Maintenance — Guide Section (LIVE ✅ — Session 23)

**All 6 guide pages** now have a dedicated "🔧 Repairs & mould" tab with:

1. Emergency repairs section (state-specific timeframes + self-arrange limits)
2. Routine repairs section (14-day rule, written request requirement)
3. Landlord vs tenant responsibility table
4. Mould section (structural vs behavioural cause, documentation, state-specific guidance)
5. State authority links + legislation links

**Mould migration complete:** Mould content moved OUT of settled "Your Home" tab → INTO guide repairs section on all 6 guide pages. Settled "Your Home" tab renamed to "🏠 Shared Living" across all 6 settled pages.

---

## Landlord Portal — Waitlist (LIVE — Session 17)

Coming soon page + lead capture at `/landlords`. Free listing code carrot for waitlist members. Supabase `landlord_leads` table. Built and deployed S17.

---

## Nav Structure (Current — all pages)

**Always dark — nav stays navy regardless of day/night mode. DECISION LOCKED.**

**Explore dropdown (city pages):**
1. 🔄 Break lease → /lease
2. 🏠 List your property → /landlords
3. ─── divider ───
4. 📖 Renter's Guide → /guide
5. 🇦🇺 Getting Settled → /settled
6. 🤠 Ask Cob → /cob
7. ─── divider ───
8. 💤 Sleep Mode (opens modal)

**Rule:** All future features go inside Explore dropdown — never top-level.

**Non-city pages nav standard (LOCKED Session 15):** Logo · 📍 City badge · `🏠 Find housing` (yellow CTA → city root) · `Explore ▾` · `🌙` theme toggle. All wrapped in nav-right-group except the badge. No redundant pill buttons.

**IMPORTANT — "Ask Cob" in Explore dropdown:** The dropdown item exists on city pages only. Non-city pages (guide, settled, lease) do NOT have "Ask Cob" as a dropdown item — Cob lives in the FAB on city pages. Remove only when the file is re-uploaded for another reason.

---

## Settled Pages — Tab Structure (LOCKED Session 21, updated S23)

All 6 settled pages (Melbourne, Sydney, Brisbane, Adelaide, Perth, Canberra) have identical tab order:

**Emergency 🚨 | Health & doctors | Transport | Money & banking | Work & jobs | Beach & outdoor | Drinking & smoking | Wildlife 🐍 | Shared Living 🏠 | Phone & SIM | Wellbeing & study | Internet & NBN | Aussie culture**

- Emergency is tab position 1 and the default active tab on page load
- Aussie culture is last
- Insects & bugs card lives ONLY inside the Wildlife tab — never in Shared Living or any other tab
- **"Your Home" tab renamed to "Shared Living" in Session 23** — mould content removed (now in Guide repairs tab)
- Shared Living tab covers shared living tips and bond protection only (no mould card)
- Each city has state-specific emergency numbers, hospitals, DV lines, mental health lines

---

## Guide Pages — Tab Structure (Updated Session 23)

All 6 guide pages have tabs:
**🤝 Good housemate | 🏢 Landlord types | 🏨 PBSA | 🐾 Pets & rentals | ⚖️ Legal resources | 🌏 Communication tips | 🔧 Repairs & mould**

- "🔧 Repairs & mould" tab added in Session 23 — last tab position
- State-specific content: repair timeframes, self-arrange limits, dispute bodies, authority links

---

## City Switcher (FIXED Session 20)

All 6 city pages (index.html, unirenter-sydney.html, unirenter-brisbane.html, unirenter-adelaide.html, unirenter-perth.html, unirenter-canberra.html) now display all 6 cities in the footer city switcher, with the current city highlighted as active. **When adding a new city in future, update the city switcher on all existing city pages.**

---

## Supabase Schema

### profiles table (27 columns)
Key columns: id, email, email_verified, display_name, university, student_status, seeking, suburb_preferences[], budget_min, budget_max, sleep_schedule, cleanliness, city (default 'melbourne'), profile_complete (0–100), is_active, uni_email, uni_email_verified.

### landlord_leads table (LIVE — Session 17)
### coming_soon_notify table (LIVE — Session 18)
### city_status table (LIVE — Session 18)
RLS: service role only. Seed rows for melbourne, sydney, brisbane (city_launched = true). Adelaide, Perth, Canberra: city_launched = false initially.
### reviews table (LIVE — Session 17)
### lease_listings table (FUTURE — Session 24+)

---

## City Data Reference

### Melbourne
| Field | Value |
|---|---|
| Route | `/` |
| JS city value | `city: 'melbourne'` |
| Universities | UniMelb, RMIT, Monash, Deakin, La Trobe, Swinburne, Victoria University |
| Uni email placeholder | `you@student.unimelb.edu.au` |
| Budget nudge | "Melbourne rooms average $220–280/wk. If your budget is under $200, options get very tight." |
| Budget threshold | `budget < 200` |
| Pet law | Victorian pet law |
| Suburb groups | Inner city/north: CBD, Carlton, Fitzroy, Collingwood, Brunswick, Northcote, Coburg · Inner east/south: Richmond, South Yarra, Prahran, St Kilda, Hawthorn, Camberwell · West/campus: Footscray, Flemington, Parkville (UniMelb), Clayton (Monash), Bundoora (La Trobe) |

### Sydney
| Field | Value |
|---|---|
| Route | `/sydney` |
| JS city value | `city: 'sydney'` |
| Universities | UNSW, University of Sydney, UTS, Macquarie, Western Sydney University, ACU, Notre Dame |
| Uni email placeholder | `you@student.unsw.edu.au` |
| Budget nudge | "Sydney rooms average $280–350/wk. If your budget is under $250, options get very tight." |
| Budget threshold | `budget < 250` |
| Pet law | NSW pet law |

### Brisbane
| Field | Value |
|---|---|
| Route | `/brisbane` |
| JS city value | `city: 'brisbane'` |
| Universities | QUT (Gardens Point + Kelvin Grove), University of Queensland (St Lucia), Griffith University (Nathan + South Bank), Bond University, Australian Catholic University |
| Uni email placeholder | `you@student.qut.edu.au` |
| Budget nudge | "Brisbane rooms average $230–290/wk. If your budget is under $200, options get very tight." |
| Budget threshold | `budget < 190` |
| Pet law | QLD pet law |

### Adelaide
| Field | Value |
|---|---|
| Route | `/adelaide` |
| JS city value | `city: 'adelaide'` |
| Universities | University of Adelaide, UniSA — University of South Australia, Flinders University, Torrens University, TAFE SA |
| Uni email placeholder | `you@student.adelaide.edu.au` |
| Group members | 28k Adelaide group members |
| Budget nudge | "Adelaide rooms average $180–240/wk — one of Australia's most affordable student cities. If your budget is under $160, options get very tight." |
| Budget threshold | `budget < 160` |
| Pet law | SA pet law (Residential Tenancies Act 1995) |

### Perth
| Field | Value |
|---|---|
| Route | `/perth` |
| JS city value | `city: 'perth'` |
| Universities | UWA — University of Western Australia, Curtin University, Murdoch University, Edith Cowan University (ECU), Notre Dame Australia, TAFE WA |
| Uni email placeholder | `you@student.uwa.edu.au` |
| Group members | 34k Perth group members |
| Budget nudge | "Perth rooms average $220–280/wk — demand has surged significantly in recent years. If your budget is under $185, options get very tight." |
| Budget threshold | `budget < 185` |
| Pet law | WA pet law (Residential Tenancies Act 1987) |

### Canberra
| Field | Value |
|---|---|
| Route | `/canberra` |
| JS city value | `city: 'canberra'` |
| Universities | ANU — Australian National University, University of Canberra (UC), CIT — Canberra Institute of Technology |
| Uni email placeholder | `you@student.anu.edu.au` |
| Group members | 22k Canberra group members |
| Budget nudge | "Canberra rooms average $220–280/wk. If your budget is under $200, options get very tight." |
| Budget threshold | `budget < 200` |
| Pet law | ACT pet law (Residential Tenancies Act 1997) |

---

## City Expansion Strategy (Locked)

1. **Gold Coast** — Brisbane suburb group. Southport, Robina/Bond, Varsity Lakes, Broadbeach, Burleigh Heads, Coolangatta. Already in Brisbane page.
2. **Ipswich / Springfield** — Brisbane North & outer suburb chips. USQ Springfield corridor. Already in Brisbane page.
3. **Session 19 completed** — Adelaide + Perth + Canberra. Three-city national launch.
4. **Canberra** — UniLodge year-two transition angle is the long-term strategy. Built as standard clone in Session 19.

---

## Complete File Map

| File | Route | Status | Notes |
|---|---|---|---|
| index.html | / | ✅ Live | S18: near_misses + Cob Phase 2 + Coming Soon · S20: city switcher · S22: language selector pending upload |
| auth.html | /auth | ✅ | |
| unirenter-cob.html | /cob | ✅ S22 | Signal extraction + saveCobSignals added |
| unirenter-guide.html | /guide | ✅ S23 | Repairs & mould tab added · mould moved from settled |
| unirenter-guide-sydney.html | /guide/sydney | ✅ S23 | As above — NSW-specific |
| unirenter-guide-brisbane.html | /guide/brisbane | ✅ S23 | As above — QLD-specific |
| unirenter-guide-adelaide.html | /guide/adelaide | ✅ S23 | As above — SA-specific · Scape duplicate removed |
| unirenter-guide-perth.html | /guide/perth | ✅ S23 | As above — WA-specific · CLV fixed · Tenancy WA → Circle Green · Consumer Protection WA pets URL fixed |
| unirenter-guide-canberra.html | /guide/canberra | ✅ S23 | As above — ACT-specific |
| unirenter-lease.html | /lease | ✅ S21 | Nav · city badge · translate bar |
| unirenter-lease-sydney.html | /lease/sydney | ✅ S21 | As above |
| unirenter-lease-brisbane.html | /lease/brisbane | ✅ S21 | As above |
| unirenter-lease-adelaide.html | /lease/adelaide | ✅ S21 | As above |
| unirenter-lease-perth.html | /lease/perth | ✅ S21 | As above |
| unirenter-lease-canberra.html | /lease/canberra | ✅ S21 | As above |
| unirenter-settled-melbourne.html | /settled | ✅ S23 | Tab renamed "Shared Living" · mould removed · job boards expanded · broken links fixed · Myki concession URL fixed |
| unirenter-settled-sydney.html | /settled/sydney | ✅ S23 | Tab renamed · mould removed · job boards expanded · broken links fixed |
| unirenter-settled-brisbane.html | /settled/brisbane | ✅ S23 | As above |
| unirenter-settled-adelaide.html | /settled/adelaide | ✅ S23 | As above |
| unirenter-settled-perth.html | /settled/perth | ✅ S23 | As above |
| unirenter-settled-canberra.html | /settled/canberra | ✅ S23 | As above |
| unirenter-dashboard.html | /dashboard | ✅ S22 | Supabase profile fetch · applyProfileData · 🤠 Cob refined badges · completion banner · applyCobSignals |
| unirenter-lease-companion.html | /lease-companion | ✅ | Theme toggle · nav standardised · Supabase wiring pending |
| unirenter-agent.html | /agent | ✅ S17 | Privacy Act disclosure section added |
| unirenter-legal.html | /legal | ✅ | Theme toggle S15 |
| unirenter-sydney.html | /sydney | ✅ Live | S18: near_misses + Cob Phase 2 + Coming Soon · S20: city switcher · S22: language selector pending upload |
| unirenter-brisbane.html | /brisbane | ✅ Built | S20: city switcher · S22: language selector pending upload · Deploy pending |
| unirenter-adelaide.html | /adelaide | ✅ Built S19 | S20: city switcher · S22: language selector pending upload |
| unirenter-perth.html | /perth | ✅ Built S19 | S20: city switcher · S22: language selector pending upload |
| unirenter-canberra.html | /canberra | ✅ Built S19 | S20: city switcher · S22: language selector pending upload |
| unirenter-landlords.html | /landlords | ✅ Built S17 | Landlord waitlist page |
| api/auth/send-email-otp.js | /api/auth/send-email-otp | ✅ | |
| api/auth/verify-email-otp.js | /api/auth/verify-email-otp | ✅ | |
| api/profile/save.js | /api/profile/save | ✅ | City-validated — **VALID_CITIES still missing adelaide/perth/canberra — fix before deploy** |
| api/profile/get.js | /api/profile/get | ✅ S22 | Returns profile by email for dashboard |
| api/matches.js | /api/matches | ✅ S18 | near_misses: suburb, budget, accommodation_type |
| api/notify/register.js | /api/notify/register | ✅ S18 | Coming soon notify + Resend confirmation + auto-broadcast |
| api/reviews/submit.js | /api/reviews/submit | ✅ S17 | |
| api/reviews/list.js | /api/reviews/list | ✅ S17 | |
| api/landlords/join.js | /api/landlords/join | ✅ S17 | |
| api/cob.js | /api/cob | ✅ S22 | Signal extraction via Haiku secondary call added |
| vercel.json | / | ✅ S19 | 48 routes · wildcard /api/(.*) covers all API routes |
| sitemap.xml | /sitemap.xml | ✅ S22 | 27 URLs — all 6 cities + guide/settled/lease + platform pages |
| robots.txt | /robots.txt | ✅ S17 | No changes needed |

---

## Known Issues

| Issue | Priority | When | Notes |
|---|---|---|---|
| Language selector on city pages | High | Session 24 | index.html + 5 city files need upload — translate bar + `notranslate` on "Cob" — carried from S22 |
| api/profile/save.js — VALID_CITIES missing Adelaide/Perth/Canberra | High | Before deploy | save.js currently only accepts ['melbourne','sydney','brisbane'] — add new cities before deploying them |
| city_status Supabase table — seed Adelaide/Perth/Canberra | High | Before deploy | INSERT rows with city_launched=false so Coming Soon / auto-broadcast work |
| `notranslate` on "Cob" — non-city pages | Medium | Session 24 | Already handled on city pages via Goal 1 upload. Non-city pages (guide/settled/lease) need same treatment next time they're touched |
| README.md says "React + Vite" | Low | Session 24+ | Leftover from Session 1 scaffold |
| Lease-companion Supabase wiring | Medium | Session 24+ | Sleep modes, snooze, wake now are UI-only — no Supabase persistence yet |
| Break lease listing form + scam detection | High | Session 24 | Supabase lease_listings table, OTP gate, automated checks |
| Break lease browse + pre-connect checklist | High | Session 25 | Match card variant, state-specific legal checklist |
| Cob for Landlords — listing portal guide | High | Session 25+ | After landlord portal form exists |
| Break lease handover task flow | High | Session 26 | Cob-guided steps, document upload, landlord consent nudges |
| Entry condition report walkthrough | High | Session 27 | Two-path UI, Claude API parsing, final tick-box, photo storage |
| Lease health check | Medium | Session 28 | Cob flagging, landlord Verified badge connection |
| Re-listing flow + 60-day no-match | Medium | Session 29 | Platform credit, Cob coaching, one-tap re-activation |
| Calendar tab in Dashboard | Medium | Session 30 | Key dates from lease, Cob reminders |
| DeepL / in-app translation | Low | Session 31+ | Google Translate stays. Revisit when revenue exists. |
| Admin dashboard + moderation queue | Medium | Session 32 | Flagged listings, analytics, periodic review model |
| Stripe integration | High | Session 33 | Lease listing activation fee — target Jan 2027 |
| Review slider — put to sleep before marketing push | High | Before launch | Reactivate once 10–15 real reviews collected per city |
| Periodic link audit | High | Monthly | Next comprehensive audit Session 24. Use GitHub issue to track dead links between sessions. |

---

## Session Roadmap

| Session | Focus | Status |
|---|---|---|
| 1–11 | Foundation through Dashboard + Resend domain | ✅ Done |
| 12 | Nav always-dark + Cob Phase 1 | ✅ Done |
| 13 | Sydney page | ✅ Done |
| 14 | Brisbane page + strategy + fixes | ✅ Done |
| 15 | Theme toggle sweep + nav standardisation + content additions + link fixes | ✅ Done |
| 16 | Brisbane suburb expansion + Internet/NBN + review system + Explore dropdown sweep + dashboard access | ✅ Done |
| 17 | Landlord waitlist + reviews API + agent update + Supabase tables + sitemap + robots.txt | ✅ Done |
| 18 | api/matches near_misses + Cob Phase 2 + Coming Soon card + auto-broadcast | ✅ Done |
| 19 | Adelaide + Perth + Canberra — three-city national launch | ✅ Done |
| 20 | City switcher (6 cities) + nav-right-group fixes on new-city pages | ✅ Done |
| 21 | Non-city page sweep (all 18 guide/settled/lease files) — nav, badge, translate, reviews, emergency tab, pets, insects, tab reorder | ✅ Done |
| 22 | Dashboard Supabase wiring + Cob signal extraction + profile completion banner + sitemap + Canberra fix + api/profile/get | ✅ Done — city page uploads (language selector) still pending |
| 23 | **Link audit + repairs section + job boards + mould migration** | ✅ Done — 12 files: all 6 guide + all 6 settled |
| 24 | Language selector + notranslate "Cob" on all 6 city pages (upload required) · api/profile/save VALID_CITIES fix · city_status seed for Adelaide/Perth/Canberra · README fix | ⬅️ Next |
| 25 | Break lease listing form — outgoing tenant posts, Supabase lease_listings, OTP gate, scam detection | Then |
| 26 | Break lease browse + pre-connect checklist + Cob for Landlords (listing portal guide) | Then |
| 27 | Break lease handover task flow — Cob-guided steps, document upload | Then |
| 28 | Entry condition report walkthrough — two-path UI, Cob room-by-room, PDF/photo parsing | Then |
| 29 | Lease health check — drag and drop lease review, Cob flagging, Verified lease badge | Then |
| 30 | Re-listing flow + 60-day no-match — platform credit, Cob coaching | Then |
| 31 | Calendar tab in Dashboard — key dates from lease parsing, Cob reminders | Then |
| 32 | Sound effects + Settings enhancements + DeepL translation review | Then |
| 33 | Admin dashboard — moderation queue, flagged listings, review approval, analytics | Then |
| 34 | Stripe integration — lease listing activation fee (target live Jan 2027) | Then |
| 35 | Go to market — Facebook groups, uni outreach | When ready |

---

## Session History

### Session 23 — Link audit + repairs section + job boards + mould migration

**Files produced:** 12 files — all 6 guide pages + all 6 settled pages

**All 6 guide pages (guide.html + 5 city variants):**
- New "🔧 Repairs & mould" tab added as 7th tab
- State-specific repairs section: emergency repairs (timeframes + self-arrange limits), routine repairs, landlord vs tenant responsibility table, mould section (structural vs behavioural cause + state guidance), authority links, legislation links
- Adelaide guide: Scape duplicate card removed
- Perth guide: CLV description corrected (Murdoch/ECU — not Monash) · CLV URL updated to Perth-specific page · Tenancy WA → Circle Green Community Legal · Consumer Protection WA pets URL fixed

**All 6 settled pages (settled-melbourne.html + 5 city variants):**
- "Your Home" tab renamed to "Shared Living" across all 6 pages
- Mould card removed from Shared Living tab (now lives in guide repairs section)
- Job boards expanded: Seek + Indeed + Jora + Sidekicker + Airtasker + Workforce Australia added
- Broken links fixed across all 6: Red Cross snakebite URL · Poisons Information Centre dead domain → health.gov.au · Fair Work Ombudsman URL (visa-holders-and-migrants → visa-holders-migrants) · Agriculture ag-visa page → agricultural-workforce
- Melbourne settled only: Myki concession URL updated (ptv.vic.gov.au old path → concessions-and-free-travel/children-and-students/)

**Verified broken link replacements:**
| Old | New |
|---|---|
| redcross.org.au/stories/snakebite-first-aid/ | redcross.org.au/firstaid/basics/snake-bite/ |
| poison.org.au (dead) | health.gov.au/contacts/poisons-information-centre |
| ptv.vic.gov.au/tickets/myki/concession-myki/ | ptv.vic.gov.au/tickets/myki/concessions-and-free-travel/children-and-students/ |
| fairwork.gov.au/find-help-for/visa-holders-and-migrants | fairwork.gov.au/find-help-for/visa-holders-migrants |
| agriculture.gov.au/.../ag-visa | agriculture.gov.au/.../agricultural-workforce |
| tenancywa.org.au (merged) | circlegreen.org.au/tenancy/ |
| commerce.wa.gov.au/consumer-protection/pets-rental-properties | consumerprotection.wa.gov.au/renting-pets |

**Goal 1 (language selector on city pages) — NOT completed this session.** City files were not uploaded. Carry to Session 24 as first priority.

**JS syntax check:** All 12 files passed node --check ✅

**Bible updated to V25**

### Session 22 — Dashboard wiring + Cob signal extraction + sitemap + Canberra fix
- Bible updated to V24

### Session 21 — Non-city page sweep (all 18 guide/settled/lease files)
- Bible updated to V23

### Session 20 — City switcher + nav-right-group fixes
- Bible updated to V22

### Session 19 — Adelaide + Perth + Canberra national launch
- Bible updated to V21

### Session 18 — api/matches near_misses + Cob Phase 2 + Coming Soon + auto-broadcast
- Bible updated to V20

---

## Revenue Model — Three Income Streams

**Core principle: students always free. Supply side pays for access to verified students.**

| Stream | Who pays | Amount | From when | Notes |
|---|---|---|---|---|
| Break lease listing fee | Outgoing tenant | ~$15 | Jan 2027 | Activation fee at point of posting. Platform credit if no match in 60 days. |
| Landlord listing fee | Landlord / housing provider | TBD (~$30–50/mo or flat fee) | Post Jan 2027 | Waitlist launched Session 17. Price informed by waitlist data. |
| Agent referral fee | Remoters / partner agents | Per qualified lead (TBD) | Free initially, then negotiated | Free for first 6 months post-launch. Negotiate from data. |

**What never changes:** Students pay nothing — ever. No fees, no commissions, no hidden charges.

---

## Agent Opt-In — Remoters Partnership

UniRenter has a partnership with Remoters — a licensed real estate agent network. Students who want help from a real local agent can opt in.

**The Legal Line:** UniRenter is a lead generation platform only. Flat per-lead referral fee — NOT a percentage of rent or commission on a signed lease.

**Agent notification email: benjcarey75@gmail.com — keep this private**

---

## Marketing & Growth

- **Facebook groups** — top-of-funnel, post helpfully, never advertise
- **Coming Soon card** — built S18, active on Adelaide/Perth/Canberra from launch
- **Cob** — strongest differentiator, no competitor has a named AI settlement companion
- **Break lease board** — second major differentiator
- **Landlord waitlist** — builds supply side ahead of portal launch
- **Three-city national launch** (Adelaide + Perth + Canberra) — marketing moment — files ready S21
- **Always free for students** — non-negotiable
- **Never advertising** — UniRenter products are ad-free

---

## Session Rules

- One file per session (relaxed for sweep sessions — surgical changes only)
- Always read the bible first
- City HTML files (~580KB): always upload as attachment — never paste, never project knowledge
- Non-city pages: can be fetched directly from GitHub via `curl` if no local version
- Always run a syntax check before presenting
- Present all files for download at end of session
- Update bible at end of every session
- Never suggest React, Next.js, Vite, TypeScript, Tailwind, or npm
- **Monthly link audit:** Ben flags broken links during normal use. Comprehensive audit each session. Full sweep every month minimum.

---

## Legal

"We are not a real estate agent and hold no licence under the Property and Stock Agents Act 2002 (NSW), Estate Agents Act 1980 (VIC), or Property Occupations Act 2014 (QLD)."

**No escrow or trust account holding.** Platform credit only for refund scenarios.

**Agent notification email: benjcarey75@gmail.com — keep this private**

---

## Facebook Group URLs (Primary Traffic Source)

| City | Group URL |
|---|---|
| Melbourne | https://www.facebook.com/groups/melbournestudentaccommodation |
| Sydney | https://www.facebook.com/groups/sydneystudentaccommodation |
| Brisbane | https://www.facebook.com/groups/brisbanestudentaccommodation |
| Adelaide | https://www.facebook.com/groups/adelaidestudentaccommodation |
| Perth | https://www.facebook.com/groups/perthstudentaccommodation |
| Canberra | https://www.facebook.com/groups/canberrastudentaccommodation |

**Strategy: post helpfully, never advertise. Overt promotion = ban.**

---

## Go-To-Market Plan (Post-Build)

**Sequence is locked:**
1. Complete the build (Sessions 24–34)
2. Move domain from unirenter.vercel.app → unirenter.com.au
3. Update all internal links, vercel.json, Resend sender domain
4. Set up group descriptions, pinned posts, welcome messages, membership questions across all 6 groups
5. Begin active posting — practical helpful content, not ads

**Before group push — minimum viable profile count:**
- Melbourne: 50 verified profiles
- Sydney: 30 verified profiles
- Brisbane/Adelaide/Perth/Canberra: 15 each (auto-broadcast threshold already set)

**Review slider:** Put to sleep before launch. Reactivate once 10–15 real reviews collected per city.
