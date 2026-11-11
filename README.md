# FujinTrip — real codebase for DigitalOcean App Platform

One-stop tourism platform: flights, hotels, cruises, car rental, buses, taxis &
transfers, sightseeing — with Fujin AI gathering them into one customized plan
(Cheapest / Best value / Premium). Homepage is the app at fujintrip.com.

Global packages are the main offering, plus a "Near you" section based on the
visitor's location, and featured hidden gems: St. George (Utah), Tacoma
(Washington), Hilo (Hawaii, Big Island).

## Status

- Prototype (Muse artifact `tourism-website`, v4 decluttered) cannot be exported,
  so this is a clean rebuild of the same experience as a proper Next.js app.
- Prices are **planning estimates** until live suppliers are connected. The
  Duffel server route (`app/api/duffel/route.ts`) returns labeled estimates
  when no `DUFFEL_API_KEY` is set, and never exposes a key to the browser.

## Fujin AI (live model)

- The chat calls the server route `app/api/fujin/route.ts` first. When
  `MODEL_API_KEY` is set, the route calls the Meta Model API
  (`https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3`,
  OpenAI-compatible) server-side and returns the model's understanding
  as strict JSON: destination, travelers, reply, missing questions.
  The key never reaches the browser.
- When no key is set, or the API call fails, times out, or returns
  invalid JSON, the route falls back to the built-in planner in
  `lib/planner.ts` (`askFujin`) and returns `live: false`, clearly
  labeled. The chat keeps working with no key at all.
- The structured plan (Cheapest / Best value / Premium, day by day)
  still comes from `buildPlan` in `lib/planner.ts` — the AI does the
  understanding and reply; prices stay planning estimates until live
  suppliers are connected, and the AI never invents live fares.
- Travel-only: Fujin AI answers only about travel and trip planning
  (destinations, flights, hotels, cars, buses, taxis, cruises,
  sightseeing, plans, prices, booking help). Off-topic messages get a
  one-sentence polite decline and a redirect back to travel — never an
  answer, never an argument about the limit. The rule is enforced in
  the live system prompt and in the built-in fallback (`askFujin` in
  `lib/planner.ts`), so it holds with or without a key.
- To switch live AI on: get a key at dev.meta.ai (Model API dashboard
  → API keys → Create API key), set `MODEL_API_KEY` in the DigitalOcean
  dashboard (Settings → App-Level Environment Variables), redeploy.
  Pay-as-you-go, roughly $10-$30 per 1,000 trip plans.

## Plan PDF — $1 to download, free when booked

Firm rule (Nov 10, 2026): the AI reply carries real value (the 3 tier prices
with a clear pick); the options stay in the traveler's browser memory
(localStorage — trip + built plan + chosen tier, restored on reload) until
they request the plan; the plan generates as a PDF with links to book.
Downloading the PDF costs **$1 when the traveler has NOT booked with
FujinTrip** and is **FREE when they booked with us**.

- The plan view has a "How to book" section: flights are booked with
  FujinTrip (a booking request saved to My Trips — the team follows up;
  live booking activates with Duffel live mode); hotels link to Google
  Hotels, cars and activities to Google searches built from the
  destination name. In the printed PDF the full URLs print as text.
- The PDF shows the tier the traveler chose; the other two print as a
  one-line summary.
- A trip is "booked" when a My Trips item for that destination is marked
  "Booked with FujinTrip" (the "Mark as booked" button — set by the
  traveler or the team when a booking request is confirmed; it is not a
  live booking).
- `POST /api/plan-download` decides: `{destination, travelers, booked}`
  → `{decision: "free" | "pay_1", priceCents, stripe, checkoutUrl}`.
  Today it returns `stripe: "not_configured"` and `checkoutUrl: null` for
  the $1 case, and the UI explains Stripe setup is needed — it never
  pretends a payment happened.

### To collect the $1 (needs the user)

1. Create a Stripe account at https://dashboard.stripe.com/register
   (business details + bank account for payouts).
2. In the Stripe dashboard, get the **secret key** (Developers → API keys).
3. Set `STRIPE_SECRET_KEY` in the DigitalOcean dashboard (Settings →
   App-Level Environment Variables) and redeploy.
4. Wire Stripe Checkout in `app/api/plan-download/route.ts` — the route
   has a marked `// TODO: Stripe Checkout` block: create a Checkout
   Session for $1 (100 cents, USD) and return its URL as `checkoutUrl`;
   the UI already redirects there when one is returned. Verify with a
   Stripe test card first; no real money until live mode is switched on
   in Stripe.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in real values locally only — never commit .env*
npm run dev                  # http://localhost:3000
npm run build                # production build check
```

## Deploy to DigitalOcean (existing app "fujintrip")

The DigitalOcean side is already created (Nov 9, 2026, $25.15/mo total):
- Project: FujinTrip
- App Platform app "fujintrip" — Basic 512 MB / 1 vCPU, NYC1, $5/mo.
  Live URL now: https://fujintrip-u8hv5.ondigitalocean.app
  **Currently a Next.js starter template placeholder — NOT the real code yet.**
- Managed Postgres "fujintrip-db" — $15.15/mo, ready, NYC3
- Spaces "fujintrip-images" — $5/mo, NYC3
- Domain fujintrip.com added to DigitalOcean DNS (NS only; nameservers at
  GoDaddy already point to ns1/ns2/ns3.digitalocean.com)

### Exact deploy steps

1. **GitHub repo — BLOCKED, do not do this yet.** A GitHub account is still
   needed. Create a repo (e.g. `fujintrip-app`), push this directory to it
   (do not commit `.env*` or any real key), then connect it in DigitalOcean.
   This task did NOT push to GitHub, did NOT create a repo, and made NO
   DigitalOcean API calls.
2. In DigitalOcean: Apps → fujintrip → Settings → Source → connect the GitHub
   repo, branch `main`. Or use the spec in `.do/app.yaml` — set its
   `github.repo` to your repo first. App Platform will build with
   `npm run build` and run `npm start` (port 3000, health check on `/`).
3. Set env vars in the dashboard (Settings → App-Level Environment Variables):
   `DATABASE_URL` (bind the fujintrip-db database or paste the connection
   string), `SPACES_ENDPOINT`, `SPACES_BUCKET=fujintrip-images`,
   `SPACES_REGION=nyc3`, `SPACES_KEY`, `SPACES_SECRET`, `DUFFEL_API_KEY`
   (server-side only; leave empty until you want live Duffel fares),
   `MODEL_API_KEY` (server-side only; leave empty and the chat uses the
   built-in planner — see "Fujin AI (live model)" above).
4. Redeploy. Verify the live URL serves the real FujinTrip homepage, not the
   starter template.
5. Add fujintrip.com as a custom domain: Apps → fujintrip → Settings →
   Domains → Add Domain → fujintrip.com. DigitalOcean will give the CNAME /
   A record to add — the domain is already in DigitalOcean DNS, so add the
   record there. Wait for DNS propagation (up to 24h).
6. Cloudflare: deferred — wait for DigitalOcean DNS to finish propagating,
   add Cloudflare later. Creating it now would overwrite the DigitalOcean
   nameservers and restart the 24h wait.

## Design

Japanese feel: gold-leaf + jade-green, Fraunces type, decluttered hero
(one short headline, one quiet line, generous spacing). Fujin artwork:
Ogata Korin, Wind God, c.1700 — public domain (artist died 1716), credited
in the footer. The portrait is loaded from Wikimedia Commons, not bundled
as a paid stock scan.

## Advertising (Google AdSense — dormant)

- Ad slots are ready but **off**: `components/AdSlot.tsx` renders nothing at
  all unless `NEXT_PUBLIC_ADSENSE_ID` is set *and* a slot ID is passed in,
  and the AdSense script is never loaded while dormant. No ad unit is
  requested without both. Slot IDs are in `.env.example` (empty placeholders
  only): `NEXT_PUBLIC_ADSENSE_SLOT_BELOW_GEMS`,
  `NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_FOOTER`.
- Placement, by design: only in content areas below the fold — one between
  the Hidden gems and the price-comparison sections, one above the footer.
  Never in the hero, search panel, Fujin AI chat/planner, My Trips, or any
  checkout flow, so ads never clutter the booking experience.
- Before applying to AdSense, the real site must be live with substantive
  content, and the Privacy Policy page (`app/privacy/page.tsx`, linked in
  the footer) must stay accurate: it says advertising is currently off,
  explains Google AdSense cookies and opt-outs, and covers searches, My
  Trips (browser local storage only), location, and supplier bookings.
- To switch ads on later: get AdSense approval, set the three env vars in
  the DigitalOcean dashboard, redeploy. No code change needed.

## What is still needed

- GitHub account + repo, connected to the existing App Platform app
- Env vars set in the DigitalOcean dashboard (see above)
- fujintrip.com added as the app's custom domain
- Duffel test/live key (server-side only) and, later, Expedia Rapid for hotels
- Muse API key (`MODEL_API_KEY`, server-side only) to switch on live Fujin AI
