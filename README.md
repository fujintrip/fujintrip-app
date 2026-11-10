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
   (server-side only; leave empty until you want live Duffel fares).
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

## What is still needed

- GitHub account + repo, connected to the existing App Platform app
- Env vars set in the DigitalOcean dashboard (see above)
- fujintrip.com added as the app's custom domain
- Duffel test/live key (server-side only) and, later, Expedia Rapid for hotels
