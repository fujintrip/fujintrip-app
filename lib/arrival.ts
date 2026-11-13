/**
 * Arrival-time anchoring (round 4 #3, UGC learning §3 — Threads: the
 * traveler lands at 7am and the plan starts with a 3pm check-in).
 *
 * Day 1 is the day most plans get wrong first: the traveler lands
 * early and the itinerary begins with a hotel check-in that isn't
 * available yet. The anchor is the flight's landing time + a typical
 * transfer + the hotel check-in time — and the last day ends at the
 * airport. Flight times come from the traveler ("landing at 7am") or
 * from the plan view's time inputs; live fares carry no times, so no
 * time is ever taken from a fare. Check-in times are labeled honestly
 * as "typically 3pm — confirm with the stay" until live hotels exist.
 *
 * Every time here is a default with its source, or a stated time —
 * never an invented flight time. Without a landing time the anchor
 * says so and asks for it, instead of building a generic morning.
 */

export function toHHMM(hour: number, minute: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = ((Math.floor(minute) % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseHHMM(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(mins: number): string {
  return toHHMM(Math.floor(mins / 60), mins % 60);
}

// "landing at 7am", "we land 7:35", "arrive around 6pm", "touch down
// at 9:20" — a bare hour without am/pm is a morning hour (a landing
// at 7pm would say pm). Out-of-range hours are dropped, never kept.
export function parseLandingTime(text: string): string | null {
  const m = (text ?? '').match(
    /(?:land(?:s|ing)?|arrive(?:s|d)?|touch(?:es)? down|get in|flight (?:lands|arrives))\s+(?:at|around)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (!m) return null;
  const hour = Number(m[1]);
  const mins = Number(m[2] ?? 0);
  if (hour < 1 || hour > 12 || mins < 0 || mins > 59) return null;
  let h24 = hour % 12;
  if (m[3] === 'pm') h24 += 12;
  else if (!m[3] && hour === 12) h24 = 12; // a bare "12" is noon, not midnight
  return toHHMM(h24, mins);
}

// "flight home at 7:35am", "depart at 6pm", "we leave at 9:20" —
// the last day's departure. A bare hour is a morning hour, same rule.
export function parseDepartureTime(text: string): string | null {
  const m = (text ?? '').match(
    /(?:flight (?:home|back)|depart(?:s|ure)?|leave|leaving|take(?:s)? off)\s+(?:at|around)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (!m) return null;
  const hour = Number(m[1]);
  const mins = Number(m[2] ?? 0);
  if (hour < 1 || hour > 12 || mins < 0 || mins > 59) return null;
  let h24 = hour % 12;
  if (m[3] === 'pm') h24 += 12;
  else if (!m[3] && hour === 12) h24 = 12; // a bare "12" is noon, not midnight
  return toHHMM(h24, mins);
}

export type ArrivalInfo = {
  anchored: boolean;
  landingTime?: string; // 'HH:MM', as stated
  transferMins: number; // default airport → hotel transfer, minutes
  transferLabel: string;
  atHotel?: string; // 'HH:MM' the traveler is at the hotel
  checkIn: string; // '15:00' — the typical check-in, never a booked time
  checkInLabel: string;
  firstActivityFrom?: string; // 'HH:MM' Day 1's exploring starts
  line: string;
};

// The transfer default: about an hour from the airport to the hotel —
// a typical transfer, labeled as a default. The buffer after it (30
// minutes) is for bags and settling in. Check-in is typically 3pm.
export const TRANSFER_MINS_DEFAULT = 60;
export const BUFFER_MINS_DEFAULT = 30;
export const CHECK_IN_DEFAULT = '15:00';

export function arrivalAnchor(opts: { landingTime?: string | null; firstCity: string }): ArrivalInfo {
  const landingTime = parseHHMM(opts.landingTime ?? null);
  const transferLabel =
    'About 1 hour from the airport to the hotel — a typical transfer, confirm with your transfer.';
  const checkInLabel = 'Hotel check-in is typically 3pm — confirm with the stay.';
  if (!landingTime) {
    return {
      anchored: false,
      transferMins: TRANSFER_MINS_DEFAULT,
      transferLabel,
      checkIn: CHECK_IN_DEFAULT,
      checkInLabel,
      line: `Day 1 starts when you land — tell Fujin your landing time and the plan anchors to it. ${checkInLabel}`,
    };
  }
  const land = hhmmToMinutes(landingTime);
  const atHotel = minutesToHHMM(land + TRANSFER_MINS_DEFAULT);
  const firstActivityFrom = minutesToHHMM(land + TRANSFER_MINS_DEFAULT + BUFFER_MINS_DEFAULT);
  const beforeCheckIn = land + TRANSFER_MINS_DEFAULT + BUFFER_MINS_DEFAULT < hhmmToMinutes(CHECK_IN_DEFAULT);
  return {
    anchored: true,
    landingTime,
    transferMins: TRANSFER_MINS_DEFAULT,
    transferLabel,
    atHotel,
    checkIn: CHECK_IN_DEFAULT,
    checkInLabel,
    firstActivityFrom,
    line: beforeCheckIn
      ? `You land at ${landingTime} — about an hour to the hotel, so you're there around ${atHotel}. ${checkInLabel} Day 1 starts with exploring ${opts.firstCity} from about ${firstActivityFrom}, not with a 3pm check-in.`
      : `You land at ${landingTime} — about an hour to the hotel, so you're there around ${atHotel}. ${checkInLabel} Your room should be ready when you arrive.`,
  };
}

export type DepartureInfo = {
  leaveBy?: string; // 'HH:MM' to leave for the airport
  bufferMins: number; // 3h international, 2h domestic — a default
  line: string;
};

export function departureAnchor(opts: {
  departureTime?: string | null;
  lastCity: string;
  international: boolean;
}): DepartureInfo {
  const bufferMins = opts.international ? 180 : 120;
  const bufferLabel = opts.international ? 'international' : 'domestic';
  const departureTime = parseHHMM(opts.departureTime ?? null);
  if (!departureTime) {
    return {
      bufferMins,
      line: `Last day ends at the airport — leave for it ${bufferMins / 60} hours before your flight (${bufferLabel} — a default, confirm with your airline).`,
    };
  }
  const leaveBy = minutesToHHMM(hhmmToMinutes(departureTime) - bufferMins);
  return {
    leaveBy,
    bufferMins,
    line: `Your flight home leaves at ${departureTime} — leave for the airport by ${leaveBy} (${bufferMins / 60} hours before, ${bufferLabel} — a default, confirm with your airline).`,
  };
}
