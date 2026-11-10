import { NextRequest, NextResponse } from 'next/server';

/**
 * Duffel flights — server-side only.
 * If DUFFEL_API_KEY is not set, returns labeled planning estimates (never invented live fares).
 * When a key is set, this is the place to call Duffel Offer Requests server-side.
 * The key is never sent to the browser.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { origin = 'JFK', destination = 'LHR', date = '', travelers = 1 } = body as Record<string, unknown>;
  const hasKey = Boolean(process.env.DUFFEL_API_KEY);
  if (!hasKey) {
    return NextResponse.json({
      live: false,
      label: 'Planning estimate — not a live quote. Connect Duffel to see live fares.',
      origin, destination, date, travelers,
      offers: [
        { airline: 'Estimate', price: 830, currency: 'USD', stops: 0, duration: '7h 5m' },
        { airline: 'Estimate', price: 940, currency: 'USD', stops: 1, duration: '9h 20m' },
      ],
    });
  }
  // TODO: call Duffel API with DUFFEL_API_KEY server-side (Offer Request → Offer).
  // Kept intentionally unimplemented here: no live key is committed in this repo.
  return NextResponse.json({ live: false, label: 'Duffel key is set but live lookup is not yet wired in this build.', origin, destination, date, travelers, offers: [] });
}

export async function GET() {
  return NextResponse.json({ live: false, label: 'Duffel route ready. POST an offer request; returns labeled estimates when no key is set.' });
}
