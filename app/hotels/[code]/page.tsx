// Hotel detail page (interface round, Nov 16 2026 — P1 #13):
// one Hotelbeds sandbox hotel — gallery, zone, room + board list,
// total + per-night, sandbox tag. A server component: the sandbox
// search runs server-side (the same search the Stays tab ran, same
// params, so the server cache answers it — no extra Hotelbeds call)
// and the page renders the hotel — or its honest empty — without
// JavaScript, so the link is shareable. No reviews, no invented
// amenities: only what the sandbox search returned. No "Book now":
// sandbox hotels cannot be booked — the action is "Search stays
// for this destination".
import { CITY_INFO } from '../../../lib/tripCard';
import {
  hotelbedsSandboxTag,
  hotelbedsStars,
  searchHotelbedsStays,
} from '../../../lib/hotelbeds';
import HotelGallery from '../../../components/HotelGallery';

export const dynamic = 'force-dynamic';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header>
        <div className="wrap topbar">
          <div>
            <div className="logo">
              Fujin<span>Trip</span>
            </div>
            <div className="tag">Ride the wind. Pay less. · fujintrip.com</div>
          </div>
          <div className="tag">Quality + affordable prices</div>
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer>
        <div className="wrap">
          <p>
            <strong>FujinTrip</strong> — Ride the wind. Pay less. Named for Fujin, Japan’s wind god.
          </p>
          <p>
            <a href="/">Back to FujinTrip</a> · <a href="/privacy">Privacy Policy</a>
          </p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
        </div>
      </footer>
    </div>
  );
}

export default async function HotelDetailPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const code = Number(params.code);
  const dest = typeof searchParams?.dest === 'string' ? searchParams.dest : '';
  const checkIn = typeof searchParams?.checkIn === 'string' ? searchParams.checkIn : '';
  const checkOut = typeof searchParams?.checkOut === 'string' ? searchParams.checkOut : '';
  const guests = Math.min(9, Math.max(1, Number(searchParams?.guests ?? 2) || 2));
  const rooms = Math.min(4, Math.max(1, Number(searchParams?.rooms ?? 1) || 1));
  const searchHref = dest ? `/?tab=hotels&plan=${encodeURIComponent(dest)}` : '/';

  const validIso = (v: string): boolean => {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const info = dest ? CITY_INFO[dest] : undefined;
  const money = (n: number, currency: string) =>
    currency === 'USD' ? `$${n.toLocaleString()}` : `${n.toLocaleString()} ${currency}`;

  if (!dest || !validIso(checkIn) || !validIso(checkOut) || checkOut <= checkIn || !Number.isFinite(code) || !info) {
    return (
      <Shell>
        <section>
          <h1>No sandbox hotel found</h1>
          <p className="plan-muted">
            No Hotelbeds sandbox hotel with that code for this search — the link needs a destination the sandbox knows
            and valid check-in / check-out dates, and the sandbox list changes per search.
          </p>
          <p>
            <a href={searchHref}>Search stays{dest ? ` in ${dest}` : ''} →</a>
          </p>
        </section>
      </Shell>
    );
  }

  const res = await searchHotelbedsStays({
    latitude: info.lat,
    longitude: info.lng,
    destination: dest,
    checkIn,
    checkOut,
    guests,
    rooms,
  }).catch(() => null);
  const hotel = res?.hotels.find((h) => h.code === code) ?? null;

  if (!hotel) {
    return (
      <Shell>
        <section>
          <h1>No sandbox hotel found</h1>
          <p className="plan-muted">
            No Hotelbeds sandbox hotel with that code for this search — the sandbox list changes per search, and a
            hotel from an older search may no longer be in it.
          </p>
          <p>
            <a href={searchHref}>Search stays{dest ? ` in ${dest}` : ''} →</a>
          </p>
        </section>
      </Shell>
    );
  }

  const stars = hotelbedsStars(hotel);
  const gallery = hotel.images && hotel.images.length > 0 ? hotel.images : hotel.imageUrl ? [hotel.imageUrl] : [];

  return (
    <Shell>
      <section>
        <p>
          <a href={searchHref}>← Back to stays{dest ? ` in ${dest}` : ''}</a>
        </p>
        <h1>
          {hotel.name}
          {stars !== null ? ` · ${'★'.repeat(stars)}` : ''}
        </h1>
        <p className="sub">{[hotel.categoryName, hotel.zoneName, hotel.destinationName].filter(Boolean).join(' · ')}</p>
        <HotelGallery images={gallery} name={hotel.name} />
        <div className="result-cards" style={{ marginBottom: 16 }}>
          <article className="result-card">
            <div className="result-body">
              <h3>Your stay</h3>
              <p className="plan-muted">
                {hotel.nights} night{hotel.nights > 1 ? 's' : ''} · {guests} guest{guests > 1 ? 's' : ''} · {rooms} room
                {rooms > 1 ? 's' : ''}
              </p>
              {hotel.roomName && <p>Room: {hotel.roomName}</p>}
              {hotel.boardName && <p>Meal plan: {hotel.boardName}</p>}
              {hotel.rateType && <p className="plan-muted">Rate type: {hotel.rateType}</p>}
              <p className="result-price">
                from {money(hotel.price, hotel.currency)} total{' '}
                <span className="plan-muted">
                  · {money(hotel.perNight, hotel.currency)}/night · {money(hotel.perTraveler, hotel.currency)} per
                  traveler
                </span>
              </p>
              <p className="fare-card-source">{hotelbedsSandboxTag(res?.checkedAt ?? null)}</p>
              <p>
                <a className="primary" href={searchHref}>
                  Search stays{dest ? ` in ${dest}` : ''}
                </a>
              </p>
            </div>
          </article>
        </div>
        <p className="plan-muted">
          Test hotel from the Hotelbeds evaluation account — the price above is sandbox test data, not a live quote,
          and the room cannot be booked. Live bookable stays arrive when Expedia Rapid / Duffel Stays connect.
        </p>
      </section>
    </Shell>
  );
}
