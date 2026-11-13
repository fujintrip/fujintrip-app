// Emergency (SOS) sheet — the emergency-button build (user, Nov 12).
//
// One red SOS button opens this sheet from the trip panel, the Today
// view, and the map bar (all S1/S2 — never the empty S0 screen). The
// sheet does three honest things and says plainly what it cannot do:
//
//   1. Call for help — tel: links to the VERIFIED number for every
//      country on the route (lib/emergency.ts, checked 2026-11-13).
//      An unverified country says so, never a guessed number. The
//      call goes through the phone's own Phone app.
//   2. Alert your people — the saved My Trips emergency contact gets
//      a pre-filled message (trip + location if the traveler shares
//      it) via SMS / WhatsApp / share. The traveler taps send in
//      their own app; nothing here sends anything by itself.
//   3. Check-in timer — set a time; if missed while the app is open,
//      the sheet surfaces with the alert ready. It does nothing while
//      the app is closed, and the copy says so.
//
// The embassy/consulate number is the traveler's own, typed in My
// Trips — never looked up, never invented.
'use client';
import { useEffect, useState } from 'react';
import {
  EMERGENCY_NUMBERS_CHECKED,
  buildAlertMessage,
  checkInMissed,
  emergencyForCountries,
  formatCheckIn,
  nextCheckInAt,
  smsHref,
  telHref,
  whatsappHref,
  type CheckIn,
} from '../lib/emergency';

export function SosButton({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      className={compact ? 'sos-btn sos-btn-compact' : 'sos-btn'}
      onClick={onOpen}
      aria-label="Emergency — open the SOS sheet"
    >
      🚨 SOS
    </button>
  );
}

export default function EmergencySheet({
  open,
  onClose,
  countries,
  destination,
  routeLine,
  travelers,
  days,
  datesLine,
  origin,
  contact,
  embassy,
  onEmbassyChange,
  checkIn,
  onSetCheckIn,
  onClearCheckIn,
}: {
  open: boolean;
  onClose: () => void;
  countries: string[];
  destination: string;
  routeLine: string;
  travelers: number;
  days: number;
  datesLine: string;
  origin: string;
  contact: { name: string; phone: string };
  embassy: string;
  onEmbassyChange: (v: string) => void;
  checkIn: CheckIn | null;
  onSetCheckIn: (due: number) => void;
  onClearCheckIn: () => void;
}) {
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locState, setLocState] = useState<'idle' | 'busy' | 'denied' | 'ok'>('idle');
  const [timeInput, setTimeInput] = useState('');
  const [shareMsg, setShareMsg] = useState('');

  // Esc closes; the page behind doesn't scroll while it is open —
  // the same pattern as the full-screen map dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const lookups = emergencyForCountries(countries);
  const missed = checkInMissed(checkIn);
  const message = buildAlertMessage({ destination, routeLine, travelers, days, datesLine, origin, location: loc });
  const sms = contact.phone ? smsHref(contact.phone, message) : '';
  const wa = contact.phone ? whatsappHref(contact.phone, message) : '';

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocState('denied');
      return;
    }
    setLocState('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocState('ok');
      },
      () => setLocState('denied'),
      { timeout: 10000 }
    );
  };

  const share = async () => {
    setShareMsg('');
    try {
      if (navigator.share) {
        await navigator.share({ text: message });
        setShareMsg('Shared — pick the app to send it from.');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        setShareMsg('Copied — paste it into any message.');
      } else {
        setShareMsg('Sharing isn’t available here — copy the text above.');
      }
    } catch {
      // The traveler closed the share sheet — not an error.
    }
  };

  return (
    <div className="sosdialog-backdrop" onClick={onClose}>
      <div className="sosdialog panel-update" role="dialog" aria-modal="true" aria-label="Emergency — get help" onClick={(e) => e.stopPropagation()}>
        <div className="sosdialog-bar">
          <strong>🚨 Emergency</strong>
          <button type="button" className="ghost" onClick={onClose} autoFocus aria-label="Close the emergency sheet" style={{ minHeight: 44 }}>
            × Close
          </button>
        </div>
        <p className="plan-note">
          Get help fast — call, or alert your contact. This opens your phone&apos;s own calling and messaging apps. FujinTrip cannot call or message for you, and it
          cannot alert anyone while the app is closed.
        </p>

        {missed && checkIn && (
          <div className="sos-missed" role="alert">
            <strong>You missed your check-in {formatCheckIn(checkIn.due)} — are you OK?</strong>
            <p style={{ margin: '6px 0 10px' }}>
              Call for help below, or alert {contact.name || 'your emergency contact'}. If you&apos;re fine, clear the check-in.
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onClearCheckIn();
                onClose();
              }}
            >
              I&apos;m OK — clear this check-in
            </button>
          </div>
        )}

        <h3 className="sos-section-title">Call for help</h3>
        {lookups.length === 0 && <p className="plan-note">No countries on this trip yet — the numbers appear once the route is set.</p>}
        {lookups.map(({ country, entry }) => (
          <div key={country} className="sos-country">
            <strong>{entry?.name ?? country}</strong>
            {entry ? (
              <>
                {entry.services.map((s) => (
                  <a key={s.label} className="sos-call" href={telHref(s.number)} aria-label={`Call ${s.label} in ${entry.name}: ${s.number}`}>
                    <span>{s.label}</span>
                    <strong>{s.number}</strong>
                  </a>
                ))}
                {entry.note && <p className="plan-note">{entry.note}.</p>}
              </>
            ) : (
              <p className="plan-note">No verified emergency number for this destination — ask locally, or call your embassy below.</p>
            )}
          </div>
        ))}
        <p className="plan-note">Emergency numbers checked {EMERGENCY_NUMBERS_CHECKED} — verify before you travel.</p>

        <h3 className="sos-section-title">Alert {contact.name || 'your emergency contact'}</h3>
        {contact.phone ? (
          <>
            <p className="plan-line">
              <b>{contact.name || 'Your contact'}</b> · {contact.phone}
            </p>
            <p className="plan-note sos-message">{message}</p>
            <div className="row">
              {sms && (
                <a className="ghost" href={sms}>
                  Text (SMS)
                </a>
              )}
              {wa && (
                <a className="ghost" href={wa} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
              <button type="button" className="ghost" onClick={() => void share()}>
                Share…
              </button>
            </div>
            <p style={{ marginTop: 8 }}>
              <button type="button" className="ghost" onClick={requestLocation} disabled={locState === 'busy'}>
                {locState === 'ok' ? '✓ Location included in the message' : locState === 'busy' ? 'Getting your location…' : 'Include my location in the message'}
              </button>
              {locState === 'denied' && <span className="plan-note"> Location not shared — your browser blocked it; the message still sends without it.</span>}
            </p>
            {shareMsg && <p className="plan-note">{shareMsg}</p>}
          </>
        ) : (
          <p className="plan-note">
            No emergency contact {contact.name ? 'phone number' : 'saved yet'} — add {contact.name ? 'a phone number' : 'one'} in My Trips below, on this
            page.
          </p>
        )}

        <h3 className="sos-section-title">Check-in timer</h3>
        {checkIn ? (
          <>
            <p className="plan-line">
              Check-in set for <b>{formatCheckIn(checkIn.due)}</b> — if you miss it, this sheet opens while the app is open. It does nothing while the app is
              closed.
            </p>
            <button type="button" className="ghost" onClick={onClearCheckIn}>
              Clear check-in
            </button>
          </>
        ) : (
          <>
            <p className="plan-note">Set a time to check in — if you miss it while the app is open, this sheet pops up with your contacts ready.</p>
            <div className="row">
              <button type="button" className="ghost" onClick={() => onSetCheckIn(Date.now() + 3600000)}>
                In 1 hour
              </button>
              <button type="button" className="ghost" onClick={() => onSetCheckIn(Date.now() + 7200000)}>
                In 2 hours
              </button>
              <button type="button" className="ghost" onClick={() => onSetCheckIn(Date.now() + 14400000)}>
                In 4 hours
              </button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input type="time" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} aria-label="Check-in time" />
              <button
                type="button"
                className="ghost"
                disabled={!nextCheckInAt(timeInput)}
                onClick={() => {
                  const due = nextCheckInAt(timeInput);
                  if (due) onSetCheckIn(due);
                }}
              >
                Set this time
              </button>
            </div>
          </>
        )}

        <h3 className="sos-section-title">Embassy / consulate</h3>
        <div className="row">
          <input value={embassy} onChange={(e) => onEmbassyChange(e.target.value)} placeholder="Your embassy number" aria-label="Embassy or consulate phone number" />
          {embassy.trim() && (
            <a className="ghost" href={telHref(embassy)}>
              Call {embassy.trim()}
            </a>
          )}
        </div>
        <p className="plan-note">Your number, saved on this device only — FujinTrip never looks it up for you.</p>

        <p className="plan-note" style={{ marginTop: 12 }}>
          Live SOS and automatic alerts need the mobile app and a backend behind it — that is still to come. What this button does is put the right number and
          the right people one tap away.
        </p>
      </div>
    </div>
  );
}
