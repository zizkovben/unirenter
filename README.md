# UniRenter

Student accommodation matching and settlement platform for Australian university students.

**Live:** [unirenter.com.au](https://unirenter.com.au) · [unirenter.vercel.app](https://unirenter.vercel.app)

---

## Tech Stack

- **Frontend:** Pure HTML/CSS/JS — no framework, no build step. Every page is a self-contained `.html` file with CSS and JS inline.
- **Hosting:** Vercel (auto-deploy from GitHub, free tier)
- **Database:** Supabase (ap-southeast-2 Sydney)
- **Email:** Resend.com — transactional email from `noreply@unirenter.com.au`
- **AI:** Anthropic Claude API — powers Cob (the student housing assistant)
- **Payments:** Stripe (planned — lease listing fees from Jan 2027)

## Cities

| City | Route | Status |
|---|---|---|
| Melbourne | `/` or `/melbourne` | ✅ Live |
| Sydney | `/sydney` | ✅ Live |
| Brisbane | `/brisbane` | Built — deploy pending |
| Adelaide | `/adelaide` | Built — deploy pending |
| Perth | `/perth` | Built — deploy pending |
| Canberra | `/canberra` | Built — deploy pending |

## Structure

```
/                         → Melbourne homepage (index.html)
/sydney                   → Sydney homepage
/brisbane                 → Brisbane homepage
/guide                    → Renter's guide (Melbourne)
/guide/sydney             → Renter's guide (Sydney)
/settled                  → Getting settled guide (Melbourne)
/lease                    → Break lease board (Melbourne)
/dashboard                → Student dashboard
/cob                      → Ask Cob (AI housing assistant)
/landlords                → Landlord waitlist
/agent                    → Agent partnership page
/legal                    → Terms & Privacy
/api/*                    → Vercel serverless functions
```

## No framework, no build step

This project deliberately uses no React, Next.js, Vite, TypeScript, Tailwind, or npm packages in the frontend. Do not suggest migrating to a framework. The pure HTML approach deploys instantly, works in any browser, and removes all framework complexity.

## Environment Variables (Vercel)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
ANTHROPIC_API_KEY
```
