import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';

/**
 * POST /api/flight-status — live flight status for on-trip disruption
 * help (competitor learning, Nov 11 #5: TripIt Pro / Romie / Layla).
 *
 * Body: { flight, date, origin?, destination? } — flight is an ICAO
 * number such as UAL123, date is the local departure date (YYYY-MM-DD).
 *
 * The status comes from FlightAware's managed CLI
 * (/opt/hatch/bin/flightaware), which is present on this VM — the
 * development server — but NOT on the DigitalOcean App Platform
 * server. So the route tries the CLI when it is present and otherwise
 * returns a graceful live:false ("live status isn't connected on this
 * server") with a plain-language message, never a faked status.
 *
 * A cancellation is confirmed only when the cancelled flag and the
 * status text agree (or the evidence classification says so); a
 * conflicting-provider-fields result is reported as UNCONFIRMED and
 * the traveler is told to check with the airline. FlightAware does
 * not cover baggage handling beyond the claim number, airline
 * policies, or customer service — those are not in this response.
 */

const CLI = '/opt/hatch/bin/flightaware';
const IDENT_RE = /^[A-Z]{2,3}\d{1,4}[A-Z]?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type FAFlight = {
  ident?: string;
  ident_iata?: string;
  operator?: string;
  flight_number?: string;
  status?: string;
  cancelled?: boolean;
  diverted?: boolean;
  blocked?: boolean;
  departure_delay?: number;
  arrival_delay?: number;
  origin?: { code_iata?: string; city?: string; name?: string };
  destination?: { code_iata?: string; city?: string; name?: string };
  scheduled_gate_departure_at?: { user_local?: string; utc?: string };
  estimated_gate_departure_at?: { user_local?: string; utc?: string };
  actual_out?: string | null;
  scheduled_gate_arrival_at?: { user_local?: string; utc?: string };
  estimated_gate_arrival_at?: { user_local?: string; utc?: string };
  actual_in?: string | null;
  gate_origin?: string | null;
  gate_destination?: string | null;
  terminal_origin?: string | null;
  terminal_destination?: string | null;
  baggage_claim?: string | null;
  fa_flight_id?: string;
  muse_cancellation_evidence?: { classification?: string };
};

function runCli(args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const flight = typeof raw.flight === 'string' ? raw.flight.trim().toUpperCase().replace(/\s+/g, '') : '';
  const date = typeof raw.date === 'string' ? raw.date.trim() : '';
  const origin = typeof raw.origin === 'string' ? raw.origin.trim().toUpperCase() : '';
  const destination = typeof raw.destination === 'string' ? raw.destination.trim().toUpperCase() : '';

  if (!IDENT_RE.test(flight) || !DATE_RE.test(date)) {
    return NextResponse.json({
      live: false,
      reason: 'invalid_input',
      flight,
      date,
      message: 'Give a flight number like UAL123 and a date (YYYY-MM-DD) to check a flight.',
    });
  }

  // Live lookup covers flights departing within two days. A date more
  // than a day in the past or more than two days out cannot be looked
  // up live — say so instead of returning an empty result as if the
  // flight did not exist. One day of grace covers the server/user
  // timezone skew.
  const dayMs = 86400000;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const wanted = new Date(`${date}T00:00:00Z`);
  const diffDays = Math.round((wanted.getTime() - today.getTime()) / dayMs);
  if (Number.isNaN(wanted.getTime()) || diffDays < -1 || diffDays > 2) {
    return NextResponse.json({
      live: false,
      reason: 'date_too_far',
      flight,
      date,
      message: `Live status covers flights departing within two days — ${date} is outside that window. Check the flight closer to departure, or ask the airline.`,
    });
  }

  let stdout: string;
  try {
    stdout = await runCli(['flight', flight, '--date', date, '--compact']);
  } catch (err) {
    // The CLI is not on this server (production) or it failed — the
    // graceful degradation, never a faked status.
    const code = (err as NodeJS.ErrnoException)?.code;
    return NextResponse.json({
      live: false,
      reason: 'not_connected',
      flight,
      date,
      message:
        code === 'ENOENT'
          ? `Live flight status isn't connected on this server — check ${flight} on ${date} on your airline's flight status page.`
          : `FlightAware couldn't be reached right now — check ${flight} on ${date} on your airline's flight status page and try again in a moment.`,
    });
  }

  let flights: FAFlight[] = [];
  try {
    const json = JSON.parse(stdout) as { body?: { flights?: FAFlight[] } };
    flights = json.body?.flights ?? [];
  } catch {
    return NextResponse.json({
      live: false,
      reason: 'error',
      flight,
      date,
      message: `FlightAware returned an answer I couldn't read for ${flight} on ${date} — check your airline's flight status page.`,
    });
  }

  if (!flights.length) {
    return NextResponse.json({
      live: false,
      reason: 'flight_not_found',
      flight,
      date,
      message: `No ${flight} flight was found departing around ${date} — check the flight number and date, or ask the airline.`,
    });
  }

  // Match the dated leg: the requested departure date first, then the
  // origin/destination when the traveler gave them — a flight number
  // alone can return several legs over two days.
  const onDate = flights.filter((f) => (f.scheduled_gate_departure_at?.user_local ?? '').slice(0, 10) === date);
  const dated = onDate.length ? onDate : flights;
  const byRoute = dated.filter(
    (f) =>
      (!origin || f.origin?.code_iata === origin) &&
      (!destination || f.destination?.code_iata === destination)
  );
  const leg = (byRoute.length ? byRoute : dated)[0];
  if (!leg || leg.blocked) {
    return NextResponse.json({
      live: false,
      reason: leg?.blocked ? 'blocked' : 'flight_not_found',
      flight,
      date,
      message: leg?.blocked
        ? `${flight} can't be tracked publicly — the aircraft is blocked from public tracking. Check your airline's flight status page.`
        : `No ${flight} flight was found departing around ${date} — check the flight number and date, or ask the airline.`,
    });
  }

  // A cancellation is confirmed only when the cancelled flag and the
  // status text agree. A conflicting-provider-fields result is NOT a
  // confirmed cancellation — it is unconfirmed, and the traveler is
  // told to check with the airline.
  const statusText = leg.status ?? '';
  const cancelledFlag = leg.cancelled === true;
  const evidence = leg.muse_cancellation_evidence?.classification;
  const conflicting = evidence === 'conflicting_provider_fields';
  const cancellationConfirmed = cancelledFlag && !conflicting && /cancel/i.test(statusText);
  const cancellationUnconfirmed = (cancelledFlag || conflicting) && !cancellationConfirmed;

  const at = (x?: { user_local?: string }) => x?.user_local ?? null;
  return NextResponse.json({
    live: true,
    reason: undefined,
    flight: leg.ident ?? flight,
    date,
    status: statusText,
    cancellationConfirmed,
    cancellationUnconfirmed,
    cancellationNote: cancellationUnconfirmed
      ? 'FlightAware’s data conflicts on this flight, so the cancellation is NOT confirmed — check with the airline before you change your plans.'
      : undefined,
    delayedMinutes: typeof leg.departure_delay === 'number' ? leg.departure_delay : 0,
    diverted: leg.diverted === true,
    origin: { iata: leg.origin?.code_iata ?? '', city: leg.origin?.city ?? '', name: leg.origin?.name ?? '' },
    destination: { iata: leg.destination?.code_iata ?? '', city: leg.destination?.city ?? '', name: leg.destination?.name ?? '' },
    scheduledDeparture: at(leg.scheduled_gate_departure_at),
    estimatedDeparture: at(leg.estimated_gate_departure_at),
    actualDeparture: leg.actual_out ?? null,
    scheduledArrival: at(leg.scheduled_gate_arrival_at),
    estimatedArrival: at(leg.estimated_gate_arrival_at),
    actualArrival: leg.actual_in ?? null,
    gateOrigin: leg.gate_origin ?? null,
    gateDestination: leg.gate_destination ?? null,
    terminalOrigin: leg.terminal_origin ?? null,
    terminalDestination: leg.terminal_destination ?? null,
    baggageClaim: leg.baggage_claim ?? null,
  });
}
