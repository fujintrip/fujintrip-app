// Server-side airport-code resolution — the single place a city
// name becomes the IATA code a fare search needs.
//
// SERVER-ONLY: this module imports the generated dataset
// (~3,300 cities, lib/airportCodes.generated.ts). Never import it
// from a client component — the dataset must stay out of the client
// bundle. API routes (and the chat engine route) resolve here and
// pass the code into the fare functions as an explicit option.
//
// Resolution order — a passed code is source-provided (the place
// picker returned it), never guessed:
//   1. a passed code, when it is a clean 3-letter IATA code;
//   2. the hand-maintained CITY_IATA (lib/duffel.ts) — existing
//      entries win over the generated map, exactly as before;
//   3. the generated map (Travelpayouts cities data);
//   4. the same lookups on a normalized name (case, accents and
//      extra spaces ignored), so 'sao paulo' and 'São Paulo' both
//      find the dataset's 'Sao Paulo'.
// A place with genuinely no airport (a town with no commercial
// service, an ambiguous name like San Jose, a region name) resolves
// to null — the caller keeps the honest 'no_airport_code' message.
import { CITY_IATA, cleanIataCode } from './duffel';
import { AIRPORT_CODES } from './airportCodes.generated';

// Case, accents and spacing ignored — the match the picker and the
// chat's parsed names need ('São Paulo' → 'sao paulo').
export function normalizeCityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// One normalized index over both maps, hand entries first — so a
// normalized lookup still prefers CITY_IATA over the generated map.
const normalizedIndex = new Map<string, string>();
for (const [name, code] of Object.entries(CITY_IATA)) {
  const n = normalizeCityName(name);
  if (!normalizedIndex.has(n)) normalizedIndex.set(n, code);
}
for (const [name, code] of Object.entries(AIRPORT_CODES)) {
  const n = normalizeCityName(name);
  if (!normalizedIndex.has(n)) normalizedIndex.set(n, code);
}

export function airportCodeForCity(name: string): string | null {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  return CITY_IATA[trimmed] ?? AIRPORT_CODES[trimmed] ?? normalizedIndex.get(normalizeCityName(trimmed)) ?? null;
}

// The full resolution: a passed (picker) code wins; otherwise the
// city name resolves through the maps above.
export function resolveAirportCode(name: string, passedCode?: string | null): string | null {
  return cleanIataCode(passedCode) ?? airportCodeForCity(name);
}
