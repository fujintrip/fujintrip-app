import { NextRequest, NextResponse } from 'next/server';

/**
 * Duffel flights — server-side only.
 * If DUFFEL_API_KEY is not set, returns labeled planning estimates (never invented live fares).
 * When a key is set, calls Duffel Offer Requests (v2) server-side and returns real fares.
 * The key is never sent to the browser and never logged.
 */

const DUFFEL_API = 'https://api.duffel.com/air/offer_requests';

type DuffelSegment = {
  operating_carrier?: { name?: string };
  marketing_carrier?: { name?: string };
};

type DuffelOffer = {
  id?: string;
  total_amount?: string;
  total_currency?: string;
  slices?: Array<{ duration?: string; segments?: DuffelSegment[] }>;
};

function parseDuration(iso: string | undefined): string {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return '';
  const h = m[1] ? `${Number(m[1])}h` : '';
  const min = m[2] ? ` ${Number(m[2])}m` : '';
  return `${h}${min}`.trim();
}

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function estimates(origin: string, destination: string, date: string, travelers: number) {
  return {
    live: false,
    label: 'Planning estimate — not a live quote. Connect Duffel to see live fares.',
    origin, destination, date, travelers,
    offers: [
      { airline: 'Estimate', price: 830, currency: 'USD', stops: 0, duration: '7h 5m' },
      { airline: 'Estimate', price: 940, currency: 'USD', stops: 1, duration: '9h 20m' },
    ],
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const origin = String(raw.origin || 'JFK').toUpperCase().slice(0, 3);
  const destination = String(raw.destination || 'LHR').toUpperCase().slice(0, 3);
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : defaultDate();
  const travelers = Math.min(9, Math.max(1, Number(raw.travelers) || 1));

  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(estimates(origin, destination, date, travelers));
  }

  try {
    const res = await fetch(DUFFEL_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          slices: [{ origin, destination, departure_date: date }],
          passengers: Array.from({ length: travelers }, () => ({ type: 'adult' })),
          cabin_class: 'economy',
        },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string; offers?: DuffelOffer[] };
      errors?: Array<{ title?: string; message?: string }>;
    };

    if (!res.ok) {
      const detail = json.errors?.[0];
      return NextResponse.json({
        live: false,
        label:
          res.status === 401
            ? 'Duffel rejected the API key — check the key in DigitalOcean env vars (test keys start with test_).'
            : `Duffel lookup failed (${res.status})${detail?.title ? `: ${detail.title}` : ''} — showing no live fares.`,
        origin, destination, date, travelers, offers: [],
      });
    }

    const offers = (json.data?.offers ?? [])
      .filter((o) => o.total_amount && o.slices?.length)
      .map((o) => {
        const slice = o.slices![0];
        const segments = slice.segments ?? [];
        const first = segments[0];
        const airline =
          first?.operating_carrier?.name || first?.marketing_carrier?.name || 'See details';
        return {
          airline,
          price: Math.round(Number(o.total_amount)),
          currency: o.total_currency || 'USD',
          stops: Math.max(0, segments.length - 1),
          duration: parseDuration(slice.duration),
          offer_id: o.id,
        };
      })
      .sort((a, b) => a.price - b.price)
      .slice(0, 6);

    return NextResponse.json({
      live: true,
      label: `Live fares from Duffel — ${origin} → ${destination} · ${date} · ${travelers} traveler${travelers > 1 ? 's' : ''}. Prices before booking; confirm at checkout.`,
      origin, destination, date, travelers,
      offer_request_id: json.data?.id,
      offers,
    });
  } catch {
    return NextResponse.json({
      live: false,
      label: 'Could not reach Duffel right now — no live fares. Try again in a moment.',
      origin, destination, date, travelers, offers: [],
    });
  }
}

export async function GET() {
  return NextResponse.json({ live: false, label: 'Duffel route ready. POST an offer request; returns labeled estimates when no key is set, live fares when DUFFEL_API_KEY is set.' });
}
