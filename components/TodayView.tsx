// On-trip "Today" view (community round, design §7) — the plan in the
// traveler's pocket while they execute the trip.
//
// One screen, top to bottom, thumb-reachable:
//  1. Now / Next card — the day's next step first, not the trip title.
//  2. Today's timeline — the day's blocks (suggested times, labeled as
//     such), with a done toggle per block that persists on this device.
//  3. The essentials strip — tonight's stay (no invented hotel name),
//     the next flight, the trip total, the days left.
//  4. The day's map as a small strip (tap to expand) — the full route
//     stays on the main map behind the panel.
//  5. "Save for offline" + "Send this plan to my phone" — the plan
//     travels with the traveler: a local snapshot for offline on this
//     device, and a share link that opens the same Today view on another
//     device (a copy; edits stay on this device).
//
// The on-trip chat is the same Chat panel this view sits in — its input
// is directly above, so the traveler asks Fujin AI while looking at
// today. The evening block's "Where to eat tonight?" triggers the
// chat's live "tonight, near you" fetch.
'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { TripCard } from '../lib/tripCard';
import { cityCoords } from '../lib/tripCard';
import {
  dayBlocks,
  doneKeyFor,
  essentialsFor,
  mapsDirectionsUrl,
  offlineKeyFor,
  snapshotFor,
  todaySummary,
} from '../lib/today';

const TripMap = dynamic(() => import('./TripMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
    </div>
  ),
});

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function TodayView({
  card,
  destination,
  travelers,
  days,
  month,
  origin,
  choice,
  onFindDinner,
  readOnly = false,
}: {
  card: TripCard;
  destination: string;
  travelers: number;
  days: number;
  month: number;
  origin: string;
  choice: number;
  onFindDinner?: () => void;
  readOnly?: boolean;
}) {
  const summary = useMemo(() => todaySummary(card, new Date()), [card]);
  const [selectedDay, setSelectedDay] = useState(summary.dayIndex);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  const [mapExpanded, setMapExpanded] = useState(false);
  const doneKey = doneKeyFor(destination, travelers, days);
  const offlineKey = offlineKeyFor(destination, travelers, days);

  // Done blocks + the offline snapshot restore from this device only —
  // they are the traveler's own state, not a sync.
  useEffect(() => {
    try {
      const d = localStorage.getItem(doneKey);
      if (d) setDone(new Set(JSON.parse(d) as string[]));
      const snap = localStorage.getItem(offlineKey);
      if (snap) {
        const parsed = JSON.parse(snap) as { savedAt?: unknown };
        if (typeof parsed.savedAt === 'string') setSavedAt(parsed.savedAt);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey, offlineKey]);

  const toggleDone = (id: string) => {
    if (readOnly) return;
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(doneKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const saveOffline = () => {
    if (readOnly) return;
    try {
      const snap = snapshotFor(card, { destination, travelers, days, month, origin, choice });
      localStorage.setItem(offlineKey, JSON.stringify(snap));
      setSavedAt(snap.savedAt);
    } catch {}
  };

  const sharePlan = async () => {
    if (readOnly || shareBusy) return;
    setShareBusy(true);
    setShareMsg('');
    try {
      const snap = snapshotFor(card, { destination, travelers, days, month, origin, choice });
      const r = await fetch('/api/plan-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snap),
      });
      const j = (await r.json()) as { id?: string; url?: string; message?: string };
      if (r.ok && j.id) {
        setShareUrl(`${window.location.origin}/plan/${j.id}`);
        setShareMsg('Link ready — open it on your phone and the same Today view appears there.');
      } else {
        setShareMsg(j.message ?? 'Couldn’t make the link right now — your plan is still saved on this device.');
      }
    } catch {
      setShareMsg('Couldn’t reach the server to make the link — your plan is still saved on this device.');
    } finally {
      setShareBusy(false);
    }
  };

  const blocks = useMemo(() => dayBlocks(card, selectedDay), [card, selectedDay]);
  const essentials = useMemo(() => essentialsFor(card, selectedDay, new Date()), [card, selectedDay]);
  const dayDate = useMemo(() => {
    const d = new Date(card.startDate);
    d.setDate(d.getDate() + selectedDay);
    return d;
  }, [card, selectedDay]);
  const dayCity = blocks[0]?.city ?? card.stops[0]?.city ?? destination;
  const isToday = summary.status === 'during' && selectedDay === summary.dayIndex;
  const statusLine =
    summary.status === 'before'
      ? `Your trip starts ${fmtDay(card.startDate)} — previewing Day 1.`
      : summary.status === 'after'
        ? `Your trip ended ${fmtDay(card.endDate)} — reviewing the last day.`
        : `Day ${selectedDay + 1} of ${card.days} · ${fmtDay(dayDate)}${isToday ? ' · today' : ''}`;

  return (
    <div className="today" aria-label="Today on your trip">
      <div className="today-head">
        <strong style={{ fontSize: 15 }}>Today on your trip</strong>
        <p className="plan-note">{statusLine}</p>
      </div>

      {/* Day selector — the traveler can look at any day, not just today. */}
      <div className="today-days" role="group" aria-label="Choose a day">
        {Array.from({ length: card.days }, (_, i) => {
          const d = new Date(card.startDate);
          d.setDate(d.getDate() + i);
          return (
            <button
              key={i}
              type="button"
              className={`today-day ${i === selectedDay ? 'selected' : ''}`}
              aria-pressed={i === selectedDay}
              onClick={() => setSelectedDay(i)}
            >
              Day {i + 1}
              <span>{fmtDay(d)}</span>
            </button>
          );
        })}
      </div>

      {/* Now / Next — the day's next step is the first thing on screen. */}
      {isToday && summary.nowBlock && (
        <div className="today-now">
          <span className="today-now-label">Now</span>
          <strong>{summary.nowBlock.title}</strong>
          <p className="plan-note">
            {summary.nowBlock.time} · {summary.nowBlock.detail}
          </p>
          {summary.nowBlock.lat !== null && summary.nowBlock.lng !== null && (
            <a href={mapsDirectionsUrl(summary.nowBlock.lat, summary.nowBlock.lng)} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
          )}
          {summary.nextBlock && (
            <p className="plan-note" style={{ marginTop: 8 }}>
              <b>Next:</b> {summary.nextBlock.title} · {summary.nextBlock.time}
            </p>
          )}
        </div>
      )}
      {isToday && !summary.nowBlock && summary.nextBlock && (
        <div className="today-now">
          <span className="today-now-label">Next up</span>
          <strong>{summary.nextBlock.title}</strong>
          <p className="plan-note">
            {summary.nextBlock.time} · {summary.nextBlock.detail}
            {summary.nextDayTitle ? ` · tomorrow: ${summary.nextDayTitle}` : ''}
          </p>
        </div>
      )}

      {/* The day's timeline — suggested times, labeled; tap a block done. */}
      <ul className="today-timeline" aria-label={`Day ${selectedDay + 1} timeline`}>
        {blocks.map((b) => (
          <li key={b.id} className={done.has(b.id) ? 'done' : ''}>
            <button
              type="button"
              className="today-done"
              aria-pressed={done.has(b.id)}
              aria-label={done.has(b.id) ? `Mark ${b.title} not done` : `Mark ${b.title} done`}
              onClick={() => toggleDone(b.id)}
              disabled={readOnly}
            >
              {done.has(b.id) ? '✓' : ''}
            </button>
            <div className="today-block">
              <span className="today-block-time">{b.time}</span>
              <strong>{b.title}</strong>
              <p className="plan-note">{b.detail}</p>
              {b.lat !== null && b.lng !== null && (
                <a href={mapsDirectionsUrl(b.lat, b.lng)} target="_blank" rel="noreferrer">
                  Open in Maps
                </a>
              )}
              {b.kind === 'dinner' && onFindDinner && (
                <p style={{ margin: '6px 0 0' }}>
                  <button className="ghost" onClick={onFindDinner}>
                    Where to eat tonight in {b.city}?
                  </button>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="plan-note">Times are suggested, not booked — adjust them in the plan. A ✓ marks a step done on this device.</p>

      {/* The day's map as a small strip — tap to expand. */}
      <div className="today-map" style={{ height: mapExpanded ? 420 : 180 }}>
        {(() => {
          const c = cityCoords(dayCity);
          return c ? (
            <TripMap stops={[{ city: dayCity, lat: c.lat, lng: c.lng }]} legs={[]} />
          ) : (
            <p className="plan-note">Map unavailable for {dayCity}.</p>
          );
        })()}
        <p className="no-print" style={{ marginTop: 8 }}>
          <button className="ghost" onClick={() => setMapExpanded((e) => !e)}>
            {mapExpanded ? 'Shrink the map' : 'Expand the map'}
          </button>
        </p>
      </div>

      {/* Essentials strip — tonight's stay, the next flight, the total. */}
      <div className="today-essentials">
        <p className="plan-line">
          <b>Tonight:</b> {essentials.tonightStayLine}
        </p>
        {essentials.nextFlightLine ? (
          <p className="plan-line">
            <b>Next flight:</b> {essentials.nextFlightLine}
          </p>
        ) : (
          <p className="plan-line">
            <b>Next flight:</b> none left — you&apos;re on your way home.
          </p>
        )}
        <p className="plan-line">
          <b>Trip total:</b> ${essentials.tripTotal.toLocaleString()} (planning estimate) · {essentials.daysLeft} day{essentials.daysLeft === 1 ? '' : 's'} left · {essentials.datesLine}
        </p>
        <p className="plan-note">Need help? Ask Fujin AI in the chat above — on-trip help, disruption help and tonight&apos;s food are built in.</p>
      </div>

      {/* Portable: save offline on this device, or send the plan to a phone. */}
      {!readOnly && (
        <div className="today-portable">
          <button className="ghost" onClick={saveOffline}>
            Save for offline
          </button>{' '}
          <button className="ghost" onClick={sharePlan} disabled={shareBusy}>
            {shareBusy ? 'Making the link…' : 'Send this plan to my phone'}
          </button>
          {savedAt && (
            <p className="plan-note" style={{ marginTop: 6 }}>
              Saved offline on this device · updated {new Date(savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
            </p>
          )}
          {shareUrl && (
            <p style={{ marginTop: 8 }}>
              <input readOnly value={shareUrl} aria-label="Share link for this plan" onFocus={(e) => e.target.select()} />
              <button
                className="ghost"
                style={{ marginTop: 8 }}
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl).catch(() => {});
                }}
              >
                Copy link
              </button>
            </p>
          )}
          {shareMsg && <p className="plan-note">{shareMsg}</p>}
          <p className="plan-note">The link opens a copy of this plan on another device — your done-toggles stay on this device. Links are stored on this server and do not survive a redeploy; accounts and real sync are still to come.</p>
        </div>
      )}
    </div>
  );
}
