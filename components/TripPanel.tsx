// Trip panel (app-shell round, Nov 12, 2026): the trip as a live,
// directly editable object — Layla's core mechanic. The middle zone
// of the app shell, between the chat and the map. It renders ONLY from
// the trip the chat already holds (the trip card + the built plan):
// it never computes prices or nights itself. Every edit goes through
// the same revision machinery as the chat (applyRevision in
// lib/planner.ts) via onEditStop / onTier / onTravelers / onMonth, so
// the panel, the trip card, the map and the chat can never disagree.
// No hotel names, ratings, review counts or per-leg durations are
// invented here — transport rows stay mode/date/price + the
// live-inventory note, exactly as the plan view renders them.
'use client';
import Expandable from './Expandable';
import { MONTH_NAMES } from '../lib/planner';
import type { Plan } from '../lib/planner';
import type { BestTime } from '../lib/bestTime';
import type { TripCard } from '../lib/tripCard';

export type PanelStopEdit =
  | { kind: 'nights'; city: string; nights: number }
  | { kind: 'remove'; city: string }
  | { kind: 'move'; city: string; dir: 'up' | 'down' };

const TIER_NAMES = ['Cheapest', 'Best value', 'Premium'];

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function TripPanel({
  card,
  plan,
  choice,
  onTier,
  travelers,
  onTravelers,
  month,
  onMonth,
  bestTime,
  kids,
  onEditStop,
  notice,
  onBuild,
  onBook,
  busy,
}: {
  card: TripCard | null;
  plan: Plan | null;
  choice: number;
  onTier: (i: number) => void;
  travelers: number;
  onTravelers: (n: number) => void;
  month: number;
  onMonth: (m: number) => void;
  bestTime: BestTime | null;
  kids: number[];
  onEditStop: (edit: PanelStopEdit) => void;
  notice: string;
  onBuild: () => void;
  onBook: () => void;
  busy: boolean;
}) {
  const stops = card?.stops ?? [];
  const totalNights = stops.reduce((s, x) => s + x.nights, 0);
  const chosen = plan ? plan.options[choice] : null;
  const perPerson = chosen && travelers > 0 ? Math.round(chosen.total / travelers) : 0;
  const familyNote = kids.length ? ` · ${kids.length} kid${kids.length > 1 ? 's' : ''} (ages ${kids.join(', ')})` : '';
  return (
    <section className="trippanel" aria-label="Your trip — live itinerary">
      <div className="trippanel-head">
        <div>
          <h2 className="trippanel-title">{card ? card.destination : 'Your trip'}</h2>
          {card ? (
            <p className="trippanel-sub">
              {fmtDate(card.startDate)} – {fmtDate(card.endDate)} · {card.days} days · {totalNights} nights · {travelers} traveler{travelers > 1 ? 's' : ''}
              {familyNote}
            </p>
          ) : (
            <p className="trippanel-sub">No trip yet — tell Fujin AI where to go, or pick a template below.</p>
          )}
        </div>
        {chosen && (
          <div className="trippanel-total" aria-label={`Total ${chosen.total} dollars, ${chosen.name}`}>
            <strong>${chosen.total.toLocaleString()}</strong>
            <span>
              total · {chosen.name} · ≈ ${perPerson.toLocaleString()} per person
            </span>
          </div>
        )}
      </div>

      {/* Live Duffel fares (finish-the-web-version round): the card's
          flight legs are the same test fares the chat quoted — one line
          naming them, with the live-fare total beside the planning
          estimate and the service fee on its own. The header total
          above stays the planner total; this line is what reconciles
          the two. */}
      {card?.flight.live && (
        <p className="plan-note">
          ✈️ Flights are Duffel test fares — {card.flight.out.live ? `${card.flight.out.airline} $${card.flight.out.price.toLocaleString()} out` : `$${card.flight.out.price.toLocaleString()} out (estimate)`} ·{' '}
          {card.flight.back.live ? `${card.flight.back.airline} $${card.flight.back.price.toLocaleString()} back` : `$${card.flight.back.price.toLocaleString()} back (estimate)`} · + ${card.flight.serviceFee.toLocaleString()} service fee · total with live fares ${card.total.toLocaleString()} (planning estimate ${card.plannerTotal.toLocaleString()}). Test fares are not live quotes.
        </p>
      )}

      {notice && (
        <p className="panel-notice" role="status">
          {notice}
        </p>
      )}

      {card && (
        <>
          {/* Tier: the same three tiers as the plan view's boxes — one
              state (choice), switched here or there. */}
          <div className="panel-tier" role="radiogroup" aria-label="Choose your plan tier">
            {TIER_NAMES.map((name, i) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={i === choice}
                className={`panel-tier-btn${i === choice ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => onTier(i)}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="panel-slots">
            <label className="panel-slot">
              <span>Travelers</span>
              <span className="panel-stepper">
                <button type="button" aria-label="One fewer traveler" disabled={busy || travelers <= 1} onClick={() => onTravelers(travelers - 1)}>
                  −
                </button>
                <strong aria-live="polite">{travelers}</strong>
                <button type="button" aria-label="One more traveler" disabled={busy || travelers >= 12} onClick={() => onTravelers(travelers + 1)}>
                  +
                </button>
              </span>
            </label>
            <label className="panel-slot">
              <span>Month</span>
              <select
                aria-label="Travel month"
                value={month || ''}
                disabled={busy}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  if (m >= 1 && m <= 12) onMonth(m);
                }}
              >
                <option value="" disabled>
                  Pick a month
                </option>
                {MONTH_NAMES.map((name, i) => {
                  const m = i + 1;
                  const info = bestTime?.months.find((x) => x.month === m);
                  const best = bestTime?.bestMonth === m ? ' ★ Best month' : '';
                  const season = info ? ` · ${info.season}` : '';
                  return (
                    <option key={name} value={m}>
                      {name}
                      {season}
                      {best}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {/* Timeline: stops in order, with the transport into each next
              stop between them (mode / date / price — no durations
              invented) and the flight home at the end. Nights, order and
              stops are editable in place; the route line under the
              header updates with every edit. */}
          <ol className="panel-timeline">
            {stops.map((stop, si) => (
              <li key={stop.city} className="panel-stop">
                <div className="panel-stop-row">
                  <span className="panel-stop-num" aria-hidden="true">
                    {si + 1}
                  </span>
                  <span className="panel-stop-city">
                    <strong>{stop.city}</strong>
                    <span>
                      {stop.country} · {fmtDate(stop.startDate)} – {fmtDate(stop.endDate)}
                    </span>
                  </span>
                  <span className="panel-stepper panel-nights" aria-label={`Nights in ${stop.city}`}>
                    <button
                      type="button"
                      aria-label={`One fewer night in ${stop.city}`}
                      disabled={busy || stop.nights <= 1}
                      title={stop.nights <= 1 ? `${stop.city} is already 1 night — a stop can't have fewer` : `One fewer night in ${stop.city}`}
                      onClick={() => onEditStop({ kind: 'nights', city: stop.city, nights: stop.nights - 1 })}
                    >
                      −
                    </button>
                    <strong aria-live="polite">
                      {stop.nights}n
                    </strong>
                    <button
                      type="button"
                      aria-label={`One more night in ${stop.city}`}
                      disabled={busy}
                      onClick={() => onEditStop({ kind: 'nights', city: stop.city, nights: stop.nights + 1 })}
                    >
                      +
                    </button>
                  </span>
                  <span className="panel-stop-actions">
                    <button
                      type="button"
                      aria-label={`Move ${stop.city} earlier`}
                      title={`Move ${stop.city} earlier`}
                      disabled={busy || si === 0}
                      onClick={() => onEditStop({ kind: 'move', city: stop.city, dir: 'up' })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${stop.city} later`}
                      title={`Move ${stop.city} later`}
                      disabled={busy || si === stops.length - 1}
                      onClick={() => onEditStop({ kind: 'move', city: stop.city, dir: 'down' })}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${stop.city} from the trip`}
                      title={`Remove ${stop.city} from the trip`}
                      disabled={busy}
                      onClick={() => onEditStop({ kind: 'remove', city: stop.city })}
                    >
                      ×
                    </button>
                  </span>
                </div>
                <Expandable
                  className="panel-stop-detail"
                  summary={
                    <>
                      Stay from ${stop.stayEstimate.toLocaleString()} · {stop.days.length} day{stop.days.length !== 1 ? 's' : ''} · {stop.days[0] ? stop.days[0].title : ''}
                    </>
                  }
                >
                  <p className="plan-line">{stop.intro}</p>
                  {stop.sourceTip && <p className="plan-note">From your link: “{stop.sourceTip}”</p>}
                  <p className="plan-line">
                    <b>Arrive:</b> {stop.transportIn.mode} {stop.transportIn.from} → {stop.city} · {fmtDate(stop.startDate)} · from $
                    {stop.transportIn.price.toLocaleString()}{' '}
                    {si === 0 && card.flight.out.live ? `(Duffel test fare — ${card.flight.out.airline})` : '(planning estimate)'}
                  </p>
                  {si === 0 && card.flight.out.live ? (
                    <p className="plan-note">Duffel test fare — fetched from Duffel, not a live quote and not bookable yet.</p>
                  ) : (
                    <p className="plan-note">Live times arrive with live inventory — until then this is a planning estimate, not a live quote.</p>
                  )}
                  <p className="plan-line">
                    <b>Stay:</b> {stop.nights} night{stop.nights > 1 ? 's' : ''} · hostel / guesthouse estimate from ${stop.stayEstimate.toLocaleString()}
                  </p>
                  <p className="plan-note">Planning estimate — real named stays with ratings arrive with a hotel supplier. Nothing is booked until you confirm it.</p>
                  {stop.days.map((d) => (
                    <p key={d.day} className="plan-line">
                      Day {d.day} · {fmtDate(d.date)}
                      {d.weatherF ? ` · ${d.weatherF}°F typical` : ''} · {d.experiences} experience{d.experiences !== 1 ? 's' : ''} — {d.title}
                    </p>
                  ))}
                </Expandable>
                {si < stops.length - 1 && stops[si + 1] && (
                  <p className="panel-transport">
                    {stops[si + 1].transportIn.mode} {stops[si + 1].transportIn.from} → {stops[si + 1].city} · {fmtDate(stops[si + 1].startDate)} · from $
                    {stops[si + 1].transportIn.price.toLocaleString()}
                  </p>
                )}
                {si === stops.length - 1 && card.returnTransport && (
                  <p className="panel-transport">
                    {card.returnTransport.mode} {card.returnTransport.from} → home · from ${card.returnTransport.price.toLocaleString()}
                    {card.flight.back.live ? ` · Duffel test fare — ${card.flight.back.airline}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ol>

          {card.familyNote && <p className="plan-note">{card.familyNote}</p>}
          <p className="plan-note">{card.budgetTip}</p>
          <div className="panel-actions">
            {plan ? (
              <button type="button" className="primary" onClick={onBook}>
                Book — ${chosen ? chosen.total.toLocaleString() : ''} total
              </button>
            ) : (
              <button type="button" className="primary" onClick={onBuild}>
                Build my plan
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
