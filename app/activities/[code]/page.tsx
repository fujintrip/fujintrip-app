// Activity detail page (interface round, Nov 16 2026 — P1 #14):
// one Hotelbeds sandbox activity — photo, summary, modality,
// duration, from-price, sandbox tag. A server component: the
// sandbox search runs server-side (the same search the Attractions
// tab ran, same params, so the server cache answers it — no extra
// Hotelbeds call) and the page renders the activity — or its honest
// empty — without JavaScript, so the link is shareable. No invented
// "what's included": only what the sandbox search returned. No
// "Book now": sandbox activities cannot be booked — the action is
// "Search attractions for this destination".
import { CITY_INFO } from '../../../lib/tripCard';
import {
  hotelbedsActivitiesSandboxTag,
  searchHotelbedsActivities,
} from '../../../lib/hotelbeds-activities';
import { SafeImg } from '../../../components/FujinChat';

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

export default async function ActivityDetailPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const code = decodeURIComponent(params.code);
  const dest = typeof searchParams?.dest === 'string' ? searchParams.dest : '';
  const from = typeof searchParams?.from === 'string' ? searchParams.from : '';
  const to = typeof searchParams?.to === 'string' ? searchParams.to : from;
  const travelers = Math.min(9, Math.max(1, Number(searchParams?.travelers ?? 2) || 2));
  const searchHref = dest ? `/?tab=tours&plan=${encodeURIComponent(dest)}` : '/';
  const info = dest ? CITY_INFO[dest] : undefined;
  const money = (n: number, currency: string) =>
    currency === 'USD' ? `$${n.toLocaleString()}` : `${n.toLocaleString()} ${currency}`;

  if (!dest || !from || !code || !info) {
    return (
      <Shell>
        <section>
          <h1>No sandbox activity found</h1>
          <p className="plan-muted">
            No Hotelbeds sandbox activity with that code for this search — the link needs a destination the sandbox
            knows and a trip date, and the sandbox list changes per search.
          </p>
          <p>
            <a href={searchHref}>Search attractions{dest ? ` in ${dest}` : ''} →</a>
          </p>
        </section>
      </Shell>
    );
  }

  const res = await searchHotelbedsActivities({
    latitude: info.lat,
    longitude: info.lng,
    destination: dest,
    from,
    to,
    travelers,
  }).catch(() => null);
  const activity = res?.activities.find((a) => a.code === code) ?? null;

  if (!activity) {
    return (
      <Shell>
        <section>
          <h1>No sandbox activity found</h1>
          <p className="plan-muted">
            No Hotelbeds sandbox activity with that code for this search — the sandbox list changes per search, and an
            activity from an older search may no longer be in it.
          </p>
          <p>
            <a href={searchHref}>Search attractions{dest ? ` in ${dest}` : ''} →</a>
          </p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section>
        <p>
          <a href={searchHref}>← Back to attractions{dest ? ` in ${dest}` : ''}</a>
        </p>
        <h1>{activity.name}</h1>
        <p className="sub">{[activity.destinationName, activity.countryName].filter(Boolean).join(' · ')}</p>
        {activity.imageUrl && (
          <SafeImg src={activity.imageUrl} alt={activity.name} label={activity.name} className="result-photo" />
        )}
        {(activity.modalityName || activity.durationDays !== undefined) && (
          <p className="plan-muted">
            {activity.modalityName ?? ''}
            {activity.modalityName && activity.durationDays !== undefined ? ' · ' : ''}
            {activity.durationDays !== undefined
              ? `${activity.durationDays} day${activity.durationDays === 1 ? '' : 's'}`
              : ''}
          </p>
        )}
        {activity.summary && <p>{activity.summary}</p>}
        <p className="result-price">
          from {money(activity.price, activity.currency)} per person{' '}
          <span className="plan-muted">
            · {money(activity.total, activity.currency)} total for {travelers} traveler{travelers > 1 ? 's' : ''}
          </span>
        </p>
        <p className="fare-card-source">{hotelbedsActivitiesSandboxTag(res?.checkedAt ?? null)}</p>
        <p>
          <a className="primary" href={searchHref}>
            Search attractions{dest ? ` in ${dest}` : ''}
          </a>
        </p>
        <p className="plan-muted">
          Test activity from the Hotelbeds evaluation account — the price above is sandbox test data, not a live
          quote, and the activity cannot be booked. Live bookable attractions arrive when Viator / GetYourGuide /
          Klook connect.
        </p>
      </section>
    </Shell>
  );
}
