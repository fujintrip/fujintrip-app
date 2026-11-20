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
  cleanFlightLegs,
  emptySearchQuery,
  FLIGHT_TRIP_TYPES,
  formValuesFromQuery,
  MAX_FLIGHT_LEGS,
  searchButtonLabel,
  searchQueryToParams,
  todayIsoLocal,
  nowTimeLocal,
  type FlightLeg,
  type FlightTripType,
  type SearchQuery,
  type BusTier,
  type CarTier,
  type CruiseTier,
  type StayTier,
  type TaxiTier,
  type TourTier,
} from '../lib/searchPlaces';
import { MONTH_NAMES } from '../lib/planner';
import PlaceField from './PlaceField';
import { Icon, type IconName } from './icons';

// One field: label above, Lucide icon inside the control, the input
// or select below it. The icon is decorative (aria-hidden inside the
// Icon component) — the label carries the field for assistive tech.
function Field({ label, icon, children }: { label: string; icon?: IconName; children: React.ReactNode }) {
  return (
    <label className="sw-field">
      <span>{label}</span>
      {icon ? (
        <span className="sw-field-control">
          <span className="sw-field-icon" aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
          {children}
        </span>
      ) : (
        children
      )}
    </label>
  );
}

// A date/time input that never garbles while typing (audit round,
// Nov 17, 2026 — gap 12): a CONTROLLED native date input reports ''
// while the traveler is mid-typing an incomplete date, and React
// writing '' back clears the in-progress segments — typing 12/22/2026
// into Return produced "mm/12/222026". This input is uncontrolled:
// the browser keeps its editing state, the parent is told the value
// on every change ('' while incomplete, the full YYYY-MM-DD once
// complete), and external changes (prefill, clear, trip-type switch)
// sync in through the ref — never a remount, never a stolen focus.
function DateField({
  type = 'date',
  min,
  value,
  onChange,
  ariaLabel,
}: {
  type?: 'date' | 'time';
  min?: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);
  return (
    <input
      ref={ref}
      type={type}
      min={type === 'date' ? min : undefined}
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    />
  );
}

// The trip-type segmented control (Nov 15, 2026): One-way /
// Round-trip / Multi-city as a pill radiogroup — the traveler sees
// all three options up front, the selected one filled in the accent,
// 44px targets, keyboard-operable (arrow keys move between radios
// natively; Tab reaches the group once).
function TripTypeControl({
  value,
  onChange,
}: {
  value: FlightTripType;
  onChange: (t: FlightTripType) => void;
}) {
  const icons: Record<FlightTripType, IconName> = {
    oneway: 'arrowRight',
    roundtrip: 'arrowLeftRight',
    multicity: 'route',
  };
  return (
    <div className="sw-trip-type" role="radiogroup" aria-label="Trip type">
      {FLIGHT_TRIP_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          className={value === t.id ? 'selected' : ''}
          onClick={() => onChange(t.id)}
        >
          <span className="sw-trip-type-icon" aria-hidden="true">
            <Icon name={icons[t.id]} size={16} />
          </span>
          {t.label}
        </button>
      ))}
    </div>
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
    <Field label={label} icon="users">
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

// Guests / Rooms steppers (Stays, Nov 15 2026): minus / plus
// buttons instead of a select — the traveler sees the number and
// taps to change it. 44px targets, clamped to the range, disabled
// at the bounds, the value announced when it changes.
function Stepper({
  value,
  min,
  max,
  onChange,
  singular,
  plural,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  singular: string;
  plural: string;
}) {
  return (
    <span className="sw-stepper">
      <button
        type="button"
        aria-label={`Fewer ${plural}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <strong aria-live="polite">
        {value} {value === 1 ? singular : plural}
      </strong>
      <button
        type="button"
        aria-label={`More ${plural}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
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
  // Flights trip type (Nov 15, 2026): one-way / round-trip /
  // multi-city. Multi-city legs live here — leg 1 mirrors the shared
  // from/place/depart state, so the round-trip/one-way form and the
  // deep-link re-sync never see a second source of truth.
  const [tripType, setTripType] = useState<FlightTripType>(initialSearch?.tripType ?? 'roundtrip');
  const [legs, setLegs] = useState<FlightLeg[]>(() => padLegs(initialSearch?.legs ?? [], initialSearch));
  // Stays tier (Nov 15, 2026): the widget carries it, never renders
  // it — the tier control lives in the results filters, and the deep
  // link (?tier=) is the tier's home. A submit without it would drop
  // a tiered search back to Best value.
  const [stayTier, setStayTier] = useState<StayTier>(initialSearch?.stayTier ?? 'best');
  // Car rental tier (Nov 15, 2026): the same carry-through as the
  // Stays tier, for the same reason — the tier control lives in the
  // results filters, the deep link is the tier's home.
  const [carTier, setCarTier] = useState<CarTier>(initialSearch?.carTier ?? 'best');
  // Attractions tier (Nov 15, 2026): the same carry-through as the
  // Stays and Car rental tiers, for the same reason.
  const [tourTier, setTourTier] = useState<TourTier>(initialSearch?.tourTier ?? 'best');
  // Cruises tier (Nov 15, 2026): the same carry-through as the
  // Stays, Car rental and Attractions tiers, for the same reason.
  const [cruiseTier, setCruiseTier] = useState<CruiseTier>(initialSearch?.cruiseTier ?? 'best');
  // Buses tier (Nov 15, 2026): the same carry-through as the
  // Stays, Car rental, Attractions and Cruises tiers, for the same
  // reason.
  const [busTier, setBusTier] = useState<BusTier>(initialSearch?.busTier ?? 'best');
  // Taxis tier (Nov 15, 2026): the same carry-through as the
  // Stays, Car rental, Attractions, Cruises and Buses tiers, for
  // the same reason.
  const [taxiTier, setTaxiTier] = useState<TaxiTier>(initialSearch?.taxiTier ?? 'best');

  // A multi-city search always has 2–4 legs. A fresh multi-city
  // form starts from the route already typed (leg 1) plus one empty
  // leg whose From is leg 1's To — the traveler chains the trip
  // instead of retyping the city they just landed in.
  function padLegs(raw: FlightLeg[], q: SearchQuery | null | undefined): FlightLeg[] {
    const clean = cleanFlightLegs(raw);
    if (clean.length >= 2) return clean;
    const first: FlightLeg = clean[0] ?? {
      from: q?.from || '',
      to: q?.to || '',
      depart: q?.depart || '',
    };
    return [
      first,
      { from: first.to, to: '', depart: '' },
    ];
  }

  // One leg's edit — leg 1 also writes the shared from/place/depart
  // state, so the form, the deep link and the results all read the
  // same first hop.
  const updateLeg = (i: number, patch: Partial<FlightLeg>) => {
    setLegs(legs.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    if (i === 0) {
      if (patch.from !== undefined) setFrom(patch.from);
      if (patch.to !== undefined) setPlace(patch.to);
      if (patch.depart !== undefined) setDepart(patch.depart);
    }
  };

  const switchTripType = (t: FlightTripType) => {
    setTripType(t);
    if (t === 'multicity') setLegs((prev) => padLegs(prev, { ...emptySearchQuery('flights'), from, to: place, depart }));
    setNote(null);
  };
  // Today's date for the date pickers' min attribute — set after
  // mount, never during render: the server's today (UTC) and the
  // traveler's today can differ by a day, and a differing min would
  // be a hydration mismatch.
  const [today, setToday] = useState('');
  useEffect(() => {
    setToday(todayIsoLocal());
  }, []);

  const prefillNonce = prefill?.nonce ?? 0;
  useEffect(() => {
    if (!prefill) return;
    setPlace(prefill.destination);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  // A deep link followed while already on the page (or Back) changes
  // initialSearch without remounting the widget — the form re-syncs
  // to the link so "Edit search" shows the values the results were
  // built from, not the stale values from the first load. Typing
  // never changes initialSearch, so typing is never clobbered; the
  // widget's own submit writes the same values back, so its
  // router.replace is a no-op here.
  const initialSearchKey = initialSearch ? searchQueryToParams(initialSearch) : '';
  useEffect(() => {
    if (!initialSearch) return;
    const v = formValuesFromQuery(initialSearch);
    setPlace(v.place);
    setFrom(v.from);
    setDepart(v.depart);
    setRet(v.ret);
    setTravelers(v.travelers);
    setCabin(v.cabin);
    setGuests(v.guests);
    setRooms(v.rooms);
    setPickupTime(v.pickupTime);
    setDropoffTime(v.dropoffTime);
    setSameLocation(v.sameLocation);
    setDropoff(v.dropoff);
    setMonth(v.month);
    setTripType(v.tripType);
    setLegs(padLegs(v.legs, initialSearch));
    setStayTier(v.stayTier);
    setCarTier(v.carTier);
    setTourTier(v.tourTier);
    setCruiseTier(v.cruiseTier);
    setBusTier(v.busTier);
    setTaxiTier(v.taxiTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearchKey]);

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
    // A route needs both ends — the old check only failed when both
    // were empty, while the message already promised both.
    if (tab === 'flights' && tripType === 'multicity') {
      // Every leg needs both ends and a date, and a later leg cannot
      // depart before the one before it — the note names the leg.
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        if (!leg.from.trim() || !leg.to.trim()) {
          setNote(`Leg ${i + 1} needs both ends — where are you flying from, and to where?`);
          return;
        }
        if (!leg.depart) {
          setNote(`Leg ${i + 1} needs a date — when are you flying?`);
          return;
        }
      }
      const now = todayIsoLocal();
      for (let i = 0; i < legs.length; i++) {
        if (legs[i].depart < now) {
          setNote(`Leg ${i + 1} is in the past — pick a date from today on.`);
          return;
        }
        if (i > 0 && legs[i].depart < legs[i - 1].depart) {
          setNote(`Leg ${i + 1} departs before leg ${i} — check the dates.`);
          return;
        }
      }
    }
    if (tab === 'flights' && tripType !== 'multicity' && (!from.trim() || !place.trim())) {
      setNote('Add the route first — where are you flying from, and to where?');
      return;
    }
    if (tab === 'buses' && (!from.trim() || !place.trim())) {
      setNote('Add the route first — where are you traveling from, and to where?');
      return;
    }
    if (tab === 'taxis' && (!from.trim() || !dropoff.trim())) {
      setNote('Add the trip first — where should the ride pick you up, and drop you off?');
      return;
    }
    if (tab !== 'flights' && tab !== 'buses' && tab !== 'taxis' && !place.trim()) {
      setNote('Add a destination first — where do you want to go?');
      return;
    }
    // Dates can't be in the past (checked against the traveler's
    // local today, at submit time) and the return can't precede the
    // departure. A missing date stays flexible — only a given date
    // is validated. Multi-city legs were already checked one by one
    // above; the shared dates mirror leg 1 there, so re-checking
    // them would only repeat the same verdict in vaguer words.
    const now = todayIsoLocal();
    // Stays dates name the stay: a check-out on the check-in day
    // is not a night, and a check-out with no check-in has nothing
    // to end. The generic block below would only repeat these
    // verdicts in vaguer words, so Stays skips it.
    if (tab === 'hotels') {
      if (depart && depart < now) {
        setNote('That check-in date is in the past — pick a date from today on.');
        return;
      }
      if (ret && !depart) {
        setNote('Add a check-in date first — check-out needs a check-in.');
        return;
      }
      if (ret && ret < now) {
        setNote('That check-out date is in the past — pick a date from today on.');
        return;
      }
      if (depart && ret && ret <= depart) {
        setNote('Check-out must be after check-in — a stay needs at least one night.');
        return;
      }
    }
    // Car rental dates name the rental: a drop-off on the pick-up
    // day is one rental day (same-day hire is real), a drop-off
    // before pick-up is not a rental, and a drop-off with no
    // pick-up has nothing to end. The generic block below would
    // only repeat these verdicts in vaguer words, so cars skip it.
    if (tab === 'cars') {
      if (depart && depart < now) {
        setNote('That pick-up date is in the past — pick a date from today on.');
        return;
      }
      if (ret && !depart) {
        setNote('Add a pick-up date first — drop-off needs a pick-up.');
        return;
      }
      if (ret && ret < now) {
        setNote('That drop-off date is in the past — pick a date from today on.');
        return;
      }
      if (depart && ret && ret < depart) {
        setNote('Drop-off must be after pick-up — check the dates.');
        return;
      }
    }
    // Attractions dates name the visit: an end date on the start
    // date is not a visit window, and an end date with no start
    // date has nothing to end. The generic block below would only
    // repeat these verdicts in vaguer words, so tours skip it.
    if (tab === 'tours') {
      if (depart && depart < now) {
        setNote('That start date is in the past — pick a date from today on.');
        return;
      }
      if (ret && !depart) {
        setNote('Add a start date first — the end date needs a start.');
        return;
      }
      if (ret && ret < now) {
        setNote('That end date is in the past — pick a date from today on.');
        return;
      }
      if (depart && ret && ret <= depart) {
        setNote('The end date must be after the start date — an attractions visit needs at least one day.');
        return;
      }
    }
    // Cruises month names the sailing window: a month that already
    // passed is not a trip, and the generic block below has no dates
    // to check on this tab (cruises carry a month, not dates), so
    // cruises skip it.
    if (tab === 'cruises') {
      if (month && Number(month) < Number(now.slice(5, 7))) {
        setNote('That month has already passed — pick this month or a later one.');
        return;
      }
    }
    // Buses dates name the ride: a return on the departure day is
    // not a round trip, and a return with no departure has nothing
    // to end. The generic block below would only repeat these
    // verdicts in vaguer words, so buses skip it.
    if (tab === 'buses') {
      if (depart && depart < now) {
        setNote('That departure date is in the past — pick a date from today on.');
        return;
      }
      if (ret && !depart) {
        setNote('Add a departure date first — the return date needs a departure.');
        return;
      }
      if (ret && ret < now) {
        setNote('That return date is in the past — pick a date from today on.');
        return;
      }
      if (depart && ret && ret <= depart) {
        setNote('The return date must be after the departure date — a bus trip needs at least one day.');
        return;
      }
    }
    // Taxis date/time name the ride: a ride date in the past is not
    // a ride, and a ride today at a time that already passed is not
    // a ride either. A time with no date is flexible — there is no
    // day to compare it against. The generic block below would only
    // repeat the date verdict in vaguer words, so taxis skip it.
    if (tab === 'taxis') {
      if (depart && depart < now) {
        setNote('That ride date is in the past — pick a date from today on.');
        return;
      }
      if (depart && depart === now && pickupTime && pickupTime <= nowTimeLocal()) {
        setNote('That pick-up time has already passed — pick a later time.');
        return;
      }
    }
    if (tab !== 'hotels' && tab !== 'cars' && tab !== 'tours' && tab !== 'cruises' && tab !== 'buses' && tab !== 'taxis' && (tab !== 'flights' || tripType !== 'multicity')) {
      if (depart && depart < now) {
        setNote('That date is in the past — pick a date from today on.');
        return;
      }
      // One-way flights carry no return (Nov 17, 2026): a return
      // left over from a round-trip switch — or a deep link — is
      // dropped at submit, so it must never block the search with a
      // return-date verdict. The return field is hidden for one-way,
      // but the state still holds the stale date.
      const hasReturn = !(tab === 'flights' && tripType === 'oneway');
      if (hasReturn && ret && ret < now) {
        setNote('That return date is in the past — pick a date from today on.');
        return;
      }
      if (hasReturn && depart && ret && ret < depart) {
        setNote('The return date is before the departure date — check the dates.');
        return;
      }
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
      // Flights trip type: one-way carries no return (a return left
      // over from a round-trip switch is dropped, not searched);
      // multi-city carries the legs, with leg 1 mirrored onto the
      // shared from/to/depart so every consumer reads the first hop.
      tripType: tab === 'flights' ? tripType : 'roundtrip',
      legs:
        tab === 'flights' && tripType === 'multicity'
          ? legs.map((l) => ({ from: l.from.trim(), to: l.to.trim(), depart: l.depart }))
          : [],
      stayTier: tab === 'hotels' ? stayTier : 'best',
      carTier: tab === 'cars' ? carTier : 'best',
      tourTier: tab === 'tours' ? tourTier : 'best',
      cruiseTier: tab === 'cruises' ? cruiseTier : 'best',
      busTier: tab === 'buses' ? busTier : 'best',
      taxiTier: tab === 'taxis' ? taxiTier : 'best',
    };
    if (tab === 'flights' && tripType === 'oneway') q.ret = '';
    if (tab === 'flights' && tripType === 'multicity') {
      q.from = legs[0].from.trim();
      q.to = legs[0].to.trim();
      q.depart = legs[0].depart;
      q.ret = '';
    }
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
            <span className="sw-tab-icon" aria-hidden="true">
              <Icon name={t.icon} size={16} />
            </span>{' '}
            {t.label}
          </button>
        ))}
      </div>
      <form onSubmit={submit}>
        {tab === 'flights' && tripType === 'multicity' ? (
        <div className="sw-multicity">
          <TripTypeControl value={tripType} onChange={switchTripType} />
          <div className="flight-legs">
            {legs.map((leg, i) => (
              <div key={i} className="flight-leg">
                <div className="flight-leg-head">
                  <span className="flight-leg-title">Leg {i + 1}</span>
                  {i >= 1 && legs.length > 2 && (
                    <button
                      type="button"
                      className="ghost flight-leg-remove"
                      aria-label={`Remove leg ${i + 1}`}
                      onClick={() => setLegs(legs.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" size={16} /> Remove
                    </button>
                  )}
                </div>
                <div className="sw-fields">
                  <Field label="From" icon="pin">
                    <PlaceField id={`flights-leg${i + 1}-from`} label={`Leg ${i + 1} flying from`} value={leg.from} onChange={(v) => updateLeg(i, { from: v })} placeholder="Departure city" />
                  </Field>
                  <Field label="To" icon="pin">
                    <PlaceField id={`flights-leg${i + 1}-to`} label={`Leg ${i + 1} flying to`} value={leg.to} onChange={(v) => updateLeg(i, { to: v })} placeholder="Destination" />
                  </Field>
                  <Field label="Date" icon="calendar">
                    <DateField min={today || undefined} value={leg.depart} onChange={(v) => updateLeg(i, { depart: v })} ariaLabel={`Leg ${i + 1} date`} />
                  </Field>
                </div>
              </div>
            ))}
            {legs.length < MAX_FLIGHT_LEGS && (
              <button
                type="button"
                className="ghost flight-leg-add"
                onClick={() => setLegs([...legs, { from: legs[legs.length - 1].to, to: '', depart: '' }])}
              >
                <Icon name="plus" size={16} /> Add another flight
              </button>
            )}
          </div>
          <button type="submit" className="primary sw-search" aria-label={searchButtonLabel(tab)}>
            <span className="sw-search-icon" aria-hidden="true">
              <Icon name="search" size={20} />
            </span>
            <span className="sw-search-text">{searchButtonLabel(tab)}</span>
          </button>
        </div>
        ) : (
        <div className="sw-bar">
          {tab === 'flights' && <TripTypeControl value={tripType} onChange={switchTripType} />}
          {tab === 'hotels' && (
            <>
              <Field label="Destination" icon="pin">
                <PlaceField id="hotels-dest" label="Destination" value={place} onChange={setPlace} placeholder="Where are you staying?" />
              </Field>
              <Field label="Check-in" icon="calendar">
                <DateField min={today || undefined} value={depart} onChange={setDepart} ariaLabel="Check-in date" />
              </Field>
              <Field label="Check-out" icon="calendar">
                <DateField min={today || undefined} value={ret} onChange={setRet} ariaLabel="Check-out date" />
              </Field>
              <Field label="Guests" icon="users">
                <Stepper value={guests} min={1} max={9} onChange={setGuests} singular="guest" plural="guests" />
              </Field>
              <Field label="Rooms" icon="bed">
                <Stepper value={rooms} min={1} max={5} onChange={setRooms} singular="room" plural="rooms" />
              </Field>
            </>
          )}
          {tab === 'flights' && (
            <>
              <Field label="From" icon="pin">
                <PlaceField id="flights-from" label="Flying from" value={from} onChange={setFrom} placeholder="Departure city" />
              </Field>
              <Field label="To" icon="pin">
                <PlaceField id="flights-to" label="Flying to" value={place} onChange={setPlace} placeholder="Destination" />
              </Field>
              <Field label="Depart" icon="calendar">
                <DateField min={today || undefined} value={depart} onChange={setDepart} ariaLabel="Departure date" />
              </Field>
              {tripType === 'roundtrip' && (
                <Field label="Return" icon="calendar">
                  <DateField min={today || undefined} value={ret} onChange={setRet} ariaLabel="Return date" />
                </Field>
              )}
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
              <Field label="Cabin" icon="ticket">
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
              <Field label="Pick-up location" icon="pin">
                <PlaceField id="cars-pickup" label="Pick-up location" value={place} onChange={setPlace} placeholder="City or airport" />
              </Field>
              <Field label="Pick-up date" icon="calendar">
                <DateField min={today || undefined} value={depart} onChange={setDepart} ariaLabel="Pick-up date" />
              </Field>
              <Field label="Pick-up time" icon="clock">
                <DateField type="time" value={pickupTime} onChange={setPickupTime} ariaLabel="Pick-up time" />
              </Field>
              <Field label="Drop-off date" icon="calendar">
                <DateField min={today || undefined} value={ret} onChange={setRet} ariaLabel="Drop-off date" />
              </Field>
              <Field label="Drop-off time" icon="clock">
                <DateField type="time" value={dropoffTime} onChange={setDropoffTime} ariaLabel="Drop-off time" />
              </Field>
              <label className="sw-check">
                <input type="checkbox" checked={sameLocation} onChange={(e) => setSameLocation(e.target.checked)} />
                Return to the same location
              </label>
              {!sameLocation && (
                <Field label="Drop-off location" icon="pin">
                  <PlaceField id="cars-dropoff" label="Drop-off location" value={dropoff} onChange={setDropoff} placeholder="Drop-off city" />
                </Field>
              )}
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
            </>
          )}
          {tab === 'tours' && (
            <>
              <Field label="Destination" icon="pin">
                <PlaceField id="tours-dest" label="Destination" value={place} onChange={setPlace} placeholder="Where to?" />
              </Field>
              <Field label="Start date" icon="calendar">
                <DateField min={today || undefined} value={depart} onChange={setDepart} ariaLabel="Start date" />
              </Field>
              <Field label="End date" icon="calendar">
                <DateField min={today || undefined} value={ret} onChange={setRet} ariaLabel="End date" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
            </>
          )}
          {tab === 'cruises' && (
            <>
              <Field label="Departure region" icon="pin">
                <PlaceField id="cruises-region" label="Departure region" value={place} onChange={setPlace} placeholder="Caribbean, Mediterranean…" />
              </Field>
              <Field label="Departure month" icon="calendar">
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
              <Field label="From" icon="pin">
                <PlaceField id="buses-from" label="Traveling from" value={from} onChange={setFrom} placeholder="Departure city" />
              </Field>
              <Field label="To" icon="pin">
                <PlaceField id="buses-to" label="Traveling to" value={place} onChange={setPlace} placeholder="Destination city" />
              </Field>
              <Field label="Departure date" icon="calendar">
                <DateField min={today || undefined} value={depart} onChange={setDepart} ariaLabel="Departure date" />
              </Field>
              <Field label="Return date" icon="calendar">
                <DateField min={today || undefined} value={ret} onChange={setRet} ariaLabel="Return date" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Travelers" />
            </>
          )}
          {tab === 'taxis' && (
            <>
              <Field label="Pick-up" icon="pin">
                <PlaceField id="taxis-pickup" label="Pick-up" value={from} onChange={setFrom} placeholder="Pick-up place" />
              </Field>
              <Field label="Drop-off" icon="pin">
                <PlaceField id="taxis-dropoff" label="Drop-off" value={dropoff} onChange={setDropoff} placeholder="Drop-off place" />
              </Field>
              <Field label="Date" icon="calendar">
                <DateField min={today || undefined} value={depart} onChange={setDepart} ariaLabel="Date" />
              </Field>
              <Field label="Time" icon="clock">
                <DateField type="time" value={pickupTime} onChange={setPickupTime} ariaLabel="Time" />
              </Field>
              <TravelersSelect value={travelers} onChange={setTravelers} label="Passengers" />
            </>
          )}
          {/* Expedia rebuild (Nov 17, 2026): the bar ends in a circular
              navy button, magnifier only — the label stays in the HTML
              (visually hidden) and in aria-label, so the button keeps
              its name. */}
          <button type="submit" className="primary sw-search" aria-label={searchButtonLabel(tab)}>
            <span className="sw-search-icon" aria-hidden="true">
              <Icon name="search" size={20} />
            </span>
            <span className="sw-search-text">{searchButtonLabel(tab)}</span>
          </button>
        </div>
        )}
      </form>
      {note && (
        <p className="sw-note" role="status">
          {note}
        </p>
      )}
      {/* One honesty line for the homepage (UX direction, Nov 19
          2026 — P1-3): the per-card "planning estimate" repetition is
          gone, this line + the trust strip carry it. */}
      <p className="sw-honest">
        Prices are planning estimates until live suppliers connect —{' '}
        <a href="/faq#pricing">how pricing works →</a>
      </p>
    </div>
  );
}
