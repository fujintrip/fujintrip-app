// Generate lib/airportCodes.generated.ts from a real dataset —
// Travelpayouts' cities data (https://api.travelpayouts.com/data/en/
// cities.json), the same source family as the place picker's
// autocomplete. One entry per city: the city's IATA metro code
// (NYC, LON, PAR — accepted by Duffel, Ignav, LetsFG and
// Travelpayouts for fare search, verified Nov 25 2026).
//
// Rules (never guess a code):
// - Only cities with has_flightable_airport === true (scheduled
//   commercial service, per Travelpayouts' own flag).
// - A name that maps to more than one code (San Jose, Lima, Kochi,
//   Columbus, ...) is SKIPPED entirely — the picker's passed code
//   still covers it; the map never picks a winner.
// - Names already in the hand-maintained CITY_IATA (lib/duffel.ts)
//   are SKIPPED — existing entries stay untouched and win at lookup.
// - Two different names that normalize to the same key with different
//   codes are both skipped (never guess which spelling a traveler
//   means).
// - Codes must be 3 uppercase letters.
//
// Run: node scripts/generate-airport-codes.mjs [path/to/cities.json]
// (defaults to /tmp/cities.json). The output file carries a header
// with the source, date and counts; never hand-edit it — re-run this.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? '/tmp/cities.json';
const data = JSON.parse(readFileSync(src, 'utf8'));

function normalize(name) {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The hand-maintained map's keys, parsed from the source so the
// generator never drifts from it. Keys are quoted when they contain
// a space ('New York') and bare otherwise (London) — match both.
const duffelSrc = readFileSync(join(root, 'lib', 'duffel.ts'), 'utf8');
const cityBlock = duffelSrc.slice(
  duffelSrc.indexOf('export const CITY_IATA'),
  duffelSrc.indexOf('};', duffelSrc.indexOf('export const CITY_IATA'))
);
const existing = new Set(
  [...cityBlock.matchAll(/(?:'([^']+)'|([A-Za-z][\w.]*))\s*:/g)].map((m) => m[1] ?? m[2])
);

const byName = new Map();
let total = 0;
for (const d of data) {
  total++;
  if (d?.has_flightable_airport !== true) continue;
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  const code = typeof d.code === 'string' ? d.code.trim() : '';
  if (!name || !/^[A-Z]{3}$/.test(code)) continue;
  if (!byName.has(name)) byName.set(name, new Set());
  byName.get(name).add(code);
}

let ambiguous = 0;
let skippedExisting = 0;
let skippedNormalizedCollision = 0;
const entries = [];
const seenNormalized = new Map();
for (const [name, codes] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (codes.size > 1) {
    ambiguous++;
    continue;
  }
  if (existing.has(name)) {
    skippedExisting++;
    continue;
  }
  const code = [...codes][0];
  const norm = normalize(name);
  const prev = seenNormalized.get(norm);
  if (prev && prev.code !== code) {
    // Two spellings normalize to one key with different codes —
    // drop both rather than guess.
    skippedNormalizedCollision += 2;
    entries.splice(
      entries.findIndex(([n]) => n === prev.name),
      1
    );
    seenNormalized.set(norm, { name, code, dropped: true });
    continue;
  }
  if (prev?.dropped) {
    skippedNormalizedCollision++;
    continue;
  }
  seenNormalized.set(norm, { name, code });
  entries.push([name, code]);
}

const date = new Date().toISOString().slice(0, 10);
const header = `// GENERATED — do not hand-edit. Re-run scripts/generate-airport-codes.mjs.
// Source: Travelpayouts cities data (https://api.travelpayouts.com/data/en/cities.json),
// downloaded ${date}. The same source family as the place picker's autocomplete,
// so keys are the city names the picker returns.
// Scope: cities with has_flightable_airport === true (scheduled commercial
// service, per Travelpayouts' own flag): ${byName.size} distinct names.
// Skipped, never guessed: ${ambiguous} ambiguous names (one name, several codes —
// e.g. San Jose, Lima, Kochi), ${skippedExisting} names already in the hand-maintained
// CITY_IATA (lib/duffel.ts — those entries win), ${skippedNormalizedCollision} names lost
// to normalized-spelling collisions.
// Emitted: ${entries.length} entries. Values are IATA metro codes (NYC, LON, PAR),
// accepted for fare search by Duffel, Ignav, LetsFG and Travelpayouts (verified
// Nov 25, 2026). A place with genuinely no airport is absent here on purpose —
// the honest 'no_airport_code' message stays for it.
export const AIRPORT_CODES: Record<string, string> = {
`;
const body = entries.map(([n, c]) => `  '${n.replace(/'/g, "\\'")}': '${c}',`).join('\n');
writeFileSync(join(root, 'lib', 'airportCodes.generated.ts'), `${header}${body}\n};\n`);
console.log(`total dataset entries: ${total}`);
console.log(`flyable distinct names: ${byName.size}`);
console.log(`ambiguous names skipped: ${ambiguous}`);
console.log(`names already in CITY_IATA skipped: ${skippedExisting}`);
console.log(`normalized-collision names skipped: ${skippedNormalizedCollision}`);
console.log(`emitted: ${entries.length}`);
