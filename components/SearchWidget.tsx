// Direction v3 search widget (Nov 14, 2026): the Booking-style
// search card on the hero. Category tabs switch the FORM — nothing
// else changes, and nothing searches until the traveler submits.
// Place fields are live type-aheads (components/PlaceField.tsx, backed
// by GET /api/places) — Travelpayouts autocomplete, then Nominatim,
// then the known list. A typed place the app does not know is handled
// honestly by the results, never invented.
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_TABS, type HomeTabId } from '../lib/homeTabs';
import {
  CABINS,
  emptySearchQuery,
  searchButtonLabel,
  searchQueryToParams,
  type SearchQuery,
} from '../lib/searchPlaces';
import { MONTH_NAMES } from '../lib/planner';
import PlaceField from './PlaceField';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="sw-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TravelersSelect({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <option key={n} value={n}>
            {n} traveler{n > 1 ? 's' : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function SearchWidget({
  tab,
  onTabChange,
  initialSearch,
  prefill,
  onSubmit,
}: {
  tab: HomeTabId;
  onTabChange: (tab: HomeTabId) => void;
  initialSearch: SearchQuery | null;
  // A destination card prefills the widget (spec §1d) — the shared
  // destination takes the card's destination; the traveler searches
  // from there. The nonce changes per click so the same card can be
  // picked twice.
  prefill: { destination: string; nonce: number } | null;
  onSubmit: (q: SearchQuery) => void;
}) {
  const router = useRouter();
  // One shared destination value across tabs (spec §2: switching
  // tabs keeps the destination if it applies, resets nothing else).
  const [place, setPlace] = useState(initialSearch?.dest || initialSearch?.to || '');
  const [from, setFrom] = useState(initialSearch?.from || '');
  const [depart, setDepart] = useState(initialSearch?.depart || '');
  const [ret, setRet] = useState(initialSearch?.ret || '');
  const [travelers, setTravelers] = useState(initialSearch?.travelers ?? 2);
  const [cabin, setCabin] = useState(initialSearch?.cabin || 'Economy');
  const [guests, setGuests] = useState(initialSearch?.guests ?? 2);
  const [rooms, setRooms] = useState(initialSearch?.rooms ?? 1);
  const [pickupTime, setPickupTime] = useState(initialSearch?.pickupTime || '');
  const [dropoffTime, setDropoffTime] = useState(initialSearch?.dropoffTime || '');
  const [sameLocation, setSameLocation] = useState(initialSearch?.sameLocation ?? true);
  const [dropoff, setDropoff] = useState(initialSearch?.dropoff || '');
  const [month, setMonth] = useState(initialSearch?.month || '');
  const [note, setNote] = useState<string | null>(null);

  const prefillNonce = prefill?.nonce ?? 0;
  useEffect(() => {
    if (!prefill) return;
    setPlace(prefill.destination);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  // A deep-linked search (?tab=flights&from=...&to=...) runs once on
  // mount — a shared link lands on results, not an empty form.
  const initialSubmittedRef = useRef(false);
  useEffect(() => {
    if (!initialSearch || initialSubmittedRef.current) return;
    initialSubmittedRef.current = true;
    onSubmit(initialSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setNote(null);
    if (tab === 'flights' && !from.trim() && !place.trim()) {
      setNote('Add the route first — where are you flying from, and to where?');
      return;
    }
    if (tab === 'buses' && !from.trim() && !place.trim()) {
      setNote('Add the route first — where are you traveling from, and to where?');
      return;
    }
    if (tab === 'taxis' && !from.trim() && !dropoff.trim()) {
      setNote('Add the trip first — where should the ride pick you up, and drop you off?');
      return;
    }
    if (tab !== 'flights' && tab !== 'buses' && tab !== 'taxis' && !place.trim()) {
      setNote('Add a destination first — where do you want to go?');
      return;
    }
    if (depart && ret && ret < depart) {
      setNote('The return date is before the departure date — check the dates.');
      return;
    }
    const q: SearchQuery = {
      ...emptySearchQuery(tab),
      from: from.trim(),
      to: tab === 'flights' || tab === 'buses' ? place.trim() : '',
      dest: tab === 'flights' || tab === 'buses' || tab === 'taxis' ? '' : place.trim(),
      depart,
      ret,
      travelers,
      cabin,
      guests,
      rooms,
      pickupTime,
      dropoffTime,
      sameLocation,
      dropoff: tab === 'cars' ? (sameLocation ? '' : dropoff.trim()) : tab === 'taxis' ? dropoff.trim() : '',
      month,
    };
    try {
      router.replace(`/?${searchQueryToParams(q)}`, { scroll: false });
    } catch {}
    onSubmit(q);
  };

  return (
    <div className="search-widget" id="search-widget">
      <div className="sw-tabs" role="tablist" aria-label="Search by category">
        {HOME_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`sw-tab-${t.id}`}
            aria-selected={tab === t.id}
            className={`sw-tab${tab === t.id ? ' selected' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <form onSubmit={submit}>
        <div className="sw-fields">
          {tab === 'hotels' && (
            <>
              <Field label="Destination">
                <PlaceField id="hotels-dest" label="Destination" value={place} onChange={setPlace} placeholder="Where are you staying?" />
              </Field>
              <Field label="Check-in">
                <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} aria-label="Check-in date" />
              </Field>
              <Field label="Check-out">
                <input type="date" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Check-out date" />
              </Field>
              <Field label="Guests">
                <select value={guests} onChange={(e) => setGuests(Number(e.target.value))} aria-label="Guests">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <option key={n} value={n}>
                      {n} guest{n > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rooms">
                <select value={rooms} onChange={(e) => setRooms(Number(e.target.value))} aria-label="Rooms">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} room{n > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {tab === 'flights' && (
            <>
              <Field label="From">
                <PlaceField id="flights-from" label="Flying from" value={from} onChange={setFrom} placeholder="Departure city" />
              </Field>
              <Field label="To">
                <PlaceField id="flights-to" label="Flying to" value={place} onChange={setPlace} placeholder="Destination" />
              </Field>
              <Field label="Depart">
                <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} aria-label="Departure date" />
              </Field>
              <Field label="Return">
                <input type="date" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Return date" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
              <Field label="Cabin">
                <select value={cabin} onChange={(e) => setCabin(e.target.value)} aria-label="Cabin">
                  {CABINS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {tab === 'cars' && (
            <>
              <Field label="Pick-up location">
                <PlaceField id="cars-pickup" label="Pick-up location" value={place} onChange={setPlace} placeholder="City or airport" />
              </Field>
              <Field label="Pick-up date">
                <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} aria-label="Pick-up date" />
              </Field>
              <Field label="Pick-up time">
                <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} aria-label="Pick-up time" />
              </Field>
              <Field label="Drop-off date">
                <input type="date" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Drop-off date" />
              </Field>
              <Field label="Drop-off time">
                <input type="time" value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)} aria-label="Drop-off time" />
              </Field>
              <label className="sw-check">
                <input type="checkbox" checked={sameLocation} onChange={(e) => setSameLocation(e.target.checked)} />
                Return to the same location
              </label>
              {!sameLocation && (
                <Field label="Drop-off location">
                  <PlaceField id="cars-dropoff" label="Drop-off location" value={dropoff} onChange={setDropoff} placeholder="Drop-off city" />
                </Field>
              )}
            </>
          )}
          {tab === 'tours' && (
            <>
              <Field label="Destination">
                <PlaceField id="tours-dest" label="Destination" value={place} onChange={setPlace} placeholder="Where to?" />
              </Field>
              <Field label="Date">
                <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} aria-label="Date" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
            </>
          )}
          {tab === 'cruises' && (
            <>
              <Field label="Departure region">
                <PlaceField id="cruises-region" label="Departure region" value={place} onChange={setPlace} placeholder="Caribbean, Mediterranean…" />
              </Field>
              <Field label="Departure month">
                <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Departure month">
                  <option value="">Any month</option>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
            </>
          )}
          {tab === 'buses' && (
            <>
              <Field label="From">
                <PlaceField id="buses-from" label="Traveling from" value={from} onChange={setFrom} placeholder="Departure city" />
              </Field>
              <Field label="To">
                <PlaceField id="buses-to" label="Traveling to" value={place} onChange={setPlace} placeholder="Destination city" />
              </Field>
              <Field label="Date">
                <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} aria-label="Date" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
            </>
          )}
          {tab === 'taxis' && (
            <>
              <Field label="Pick-up">
                <PlaceField id="taxis-pickup" label="Pick-up" value={from} onChange={setFrom} placeholder="Pick-up place" />
              </Field>
              <Field label="Drop-off">
                <PlaceField id="taxis-dropoff" label="Drop-off" value={dropoff} onChange={setDropoff} placeholder="Drop-off place" />
              </Field>
              <Field label="Date">
                <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} aria-label="Date" />
              </Field>
              <Field label="Time">
                <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} aria-label="Time" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Passengers" />
            </>
          )}
        </div>
        <button type="submit" className="primary sw-search">
          {searchButtonLabel(tab)}
        </button>
      </form>
      {note && (
        <p className="sw-note" role="status">
          {note}
        </p>
      )}
      <p className="sw-honest">All-in prices. No hidden fees. Planning estimates until live suppliers connect.</p>
    </div>
  );
}
