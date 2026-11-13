/**
 * Traveler preference profile (round 3 #2, competitor learning §3 —
 * Mindtrip's core idea): seat, direct-vs-cheap, food style, pace,
 * "local gems only", dietary — stated by the traveler, carried across
 * trips on this device (localStorage, no accounts).
 *
 * Hard rule: a profile holds ONLY what the traveler stated or picked.
 * An empty profile says nothing, and the summary never invents a
 * preference — every phrase below comes from a field that is set.
 */

export type Dietary = 'none' | 'vegetarian' | 'vegan' | 'halal' | 'gluten-free' | 'other';

export const DIETARY_OPTIONS: Array<{ value: Dietary; label: string }> = [
  { value: 'none', label: 'No dietary needs' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'halal', label: 'Halal' },
  { value: 'gluten-free', label: 'Gluten-free' },
  { value: 'other', label: 'Other' },
];

export const DIETARY_LABELS: Record<Dietary, string> = {
  none: 'no dietary needs',
  vegetarian: 'vegetarian',
  vegan: 'vegan',
  halal: 'halal',
  'gluten-free': 'gluten-free',
  other: 'other dietary needs',
};

export type TravelerProfile = {
  flightStyle?: 'direct' | 'cheapest';
  seat?: 'window' | 'aisle';
  foodStyle?: 'street' | 'fine' | 'local';
  pace?: 'slow' | 'relaxed' | 'fast';
  localGemsOnly?: boolean;
  dietary?: Dietary;
  // Pace guard (round 4 #1): the energy slots. latestStart is the
  // earliest the traveler starts the day, 'HH:MM' 24-hour; maxSightsPerDay
  // (1–10) overrides the pace default; napWindow protects a rest block
  // after lunch for families with a child under 5.
  latestStart?: string;
  maxSightsPerDay?: number;
  napWindow?: boolean;
};

// Dietary needs, from the traveler's own words. 'none' is a real
// answer (no restrictions) — it is set, never assumed. 'other' is only
// ever set by the chip, never guessed from text.
export function parseDietary(text: string): Dietary | null {
  const lower = (text ?? '').toLowerCase();
  if (/\bvegan\b/.test(lower)) return 'vegan';
  if (/\bvegetarian\b|\bveggie\b/.test(lower)) return 'vegetarian';
  if (/\bhalal\b/.test(lower)) return 'halal';
  if (/gluten[-\s]?free|\bceliac\b|\bcoeliac\b/.test(lower)) return 'gluten-free';
  if (/\bno dietary (needs|restrictions)\b|\bno food restrictions\b|\beat everything\b|\bno allergies\b/.test(lower)) return 'none';
  return null;
}

// Preference signals, from the traveler's own words — the same
// vocabulary the profile editor offers, so a typed sentence and a chip
// tap land in the same fields.
export function parsePreferenceSignals(text: string): Partial<TravelerProfile> {
  const lower = (text ?? '').toLowerCase();
  const out: Partial<TravelerProfile> = {};
  if (/\bdirect flights?\b|\bnonstop\b|\bnon-stop\b/.test(lower)) out.flightStyle = 'direct';
  else if (/\bcheapest flights?\b|\blowest fare\b|\bbudget flights?\b/.test(lower)) out.flightStyle = 'cheapest';
  if (/\bwindow seat\b/.test(lower)) out.seat = 'window';
  else if (/\baisle seat\b/.test(lower)) out.seat = 'aisle';
  if (/\bstreet food\b/.test(lower)) out.foodStyle = 'street';
  else if (/\bfine dining\b/.test(lower)) out.foodStyle = 'fine';
  else if (/\blocal (food|spots|places|eats)\b|\beat like a local\b|\bwhere locals eat\b/.test(lower)) out.foodStyle = 'local';
  if (/\bslow (pace|travel|trip)\b|\btake it slow\b/.test(lower)) out.pace = 'slow';
  else if (/\brelaxed\b|\blaid[- ]back\b|\beasygoing\b/.test(lower)) out.pace = 'relaxed';
  else if (/\bfast[- ]paced\b|\bsee as much as possible\b|\bpacked (days|itinerary)\b/.test(lower)) out.pace = 'fast';
  if (/\blocal gems only\b|\bhidden gems\b|\boff the beaten (path|track)\b|\bavoid tourist traps\b/.test(lower)) out.localGemsOnly = true;
  const dietary = parseDietary(lower);
  if (dietary) out.dietary = dietary;
  // Pace guard (round 4 #1): the energy slots, from the traveler's own
  // words — "don't start before 10", "at most 3 sights a day", "nap
  // after lunch". Times are 24-hour 'HH:MM'; a bare hour without am/pm
  // is a morning hour (a day never starts at 10pm). Clamped to sane
  // ranges, never guessed past the words.
  const startMatch = lower.match(/(?:start(?:ing)?|begin)(?: no earlier than| after| at| from)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|don'?t start before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|no earlier than\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (startMatch) {
    const hour = Number(startMatch[1] ?? startMatch[4] ?? startMatch[7] ?? 0);
    const mins = Number(startMatch[2] ?? startMatch[5] ?? startMatch[8] ?? 0);
    const meridiem = startMatch[3] ?? startMatch[6] ?? startMatch[9];
    if (hour >= 1 && hour <= 12 && mins >= 0 && mins <= 59) {
      let h24 = hour % 12;
      if (meridiem === 'pm') h24 += 12;
      // A bare "start at 10" is 10am; "start at 2" without am/pm is
      // 2pm only when the traveler says so — otherwise it is 2am and
      // out of range, so it is dropped below by the clamp.
      if (h24 >= 5 && h24 <= 12) {
        out.latestStart = `${String(h24).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      }
    }
  }
  const sightsMatch = lower.match(/(?:at most|max|no more than)\s+(\d{1,2})\s+(?:main\s+)?(?:sights?|attractions?|activities?)\s+(?:a|per|each)\s+day/);
  if (sightsMatch) {
    const n = Number(sightsMatch[1]);
    if (n >= 1 && n <= 10) out.maxSightsPerDay = n;
  }
  if (/\bnap\b/.test(lower) && /(?:after lunch|window|protect|nap time)/.test(lower)) out.napWindow = true;
  return out;
}

export function mergeProfile(base: TravelerProfile, update: Partial<TravelerProfile>): TravelerProfile {
  return { ...base, ...update };
}

// Validate an unknown value (localStorage, server tripState) into a
// profile — unknown keys and values are dropped, never kept.
export function parseProfile(value: unknown): TravelerProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const out: TravelerProfile = {};
  if (o.flightStyle === 'direct' || o.flightStyle === 'cheapest') out.flightStyle = o.flightStyle;
  if (o.seat === 'window' || o.seat === 'aisle') out.seat = o.seat;
  if (o.foodStyle === 'street' || o.foodStyle === 'fine' || o.foodStyle === 'local') out.foodStyle = o.foodStyle;
  if (o.pace === 'slow' || o.pace === 'relaxed' || o.pace === 'fast') out.pace = o.pace;
  if (o.localGemsOnly === true) out.localGemsOnly = true;
  if (typeof o.dietary === 'string' && (DIETARY_OPTIONS as Array<{ value: string }>).some((d) => d.value === o.dietary)) {
    out.dietary = o.dietary as Dietary;
  }
  // Pace guard (round 4 #1): the energy slots, validated like the rest
  // — a malformed time or an out-of-range count is dropped, never kept.
  if (typeof o.latestStart === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.latestStart)) out.latestStart = o.latestStart;
  if (typeof o.maxSightsPerDay === 'number' && Number.isInteger(o.maxSightsPerDay) && o.maxSightsPerDay >= 1 && o.maxSightsPerDay <= 10) {
    out.maxSightsPerDay = o.maxSightsPerDay;
  }
  if (o.napWindow === true) out.napWindow = true;
  return out;
}

// The human-readable summary — ONLY the fields that are set, in a
// fixed order. Empty profile → empty string (the profile says nothing).
export function profileSummary(profile: TravelerProfile): string {
  const bits: string[] = [];
  if (profile.flightStyle === 'direct') bits.push('direct flights');
  else if (profile.flightStyle === 'cheapest') bits.push('cheapest flights');
  if (profile.seat === 'window') bits.push('window seat');
  else if (profile.seat === 'aisle') bits.push('aisle seat');
  if (profile.foodStyle === 'street') bits.push('street food over fine dining');
  else if (profile.foodStyle === 'fine') bits.push('fine dining');
  else if (profile.foodStyle === 'local') bits.push('local spots over tourist traps');
  if (profile.pace === 'slow') bits.push('slow pace');
  else if (profile.pace === 'relaxed') bits.push('relaxed pace');
  else if (profile.pace === 'fast') bits.push('fast pace');
  if (profile.localGemsOnly) bits.push('local gems only');
  if (profile.dietary && profile.dietary !== 'none') bits.push(DIETARY_LABELS[profile.dietary]);
  // Pace guard (round 4 #1): only the slots that are set.
  if (profile.latestStart) bits.push(`starts no earlier than ${profile.latestStart}`);
  if (profile.maxSightsPerDay) bits.push(`max ${profile.maxSightsPerDay} sights a day`);
  if (profile.napWindow) bits.push('nap window after lunch');
  return bits.join(', ');
}

// The line Fujin says on a new trip, when the profile is non-empty.
export function profileLine(profile: TravelerProfile): string {
  const summary = profileSummary(profile);
  if (!summary) return '';
  return `Using what you told me last time — ${summary} — tell me if that's changed.`;
}

// The prompt block for the live model: stated preferences only.
export function preferencesBlock(profile: TravelerProfile): string {
  const summary = profileSummary(profile);
  if (!summary) return '';
  return `The traveler told us before: ${summary}. Honor these unless they say otherwise. Never invent a preference they never stated.`;
}

// The dietary block for the live model (round 3 #3): food answers
// respect the dietary need, and no place is ever called "safe" for
// allergies — Wikivoyage listings do not verify dietary safety, so
// unknowns are marked unknown. "Likely halal ≠ certified halal."
export function dietaryBlock(dietary: Dietary): string {
  if (dietary === 'none') return 'The traveler has no dietary needs.';
  const label = DIETARY_LABELS[dietary];
  return `The traveler is ${label}. Only suggest restaurants and dishes that fit ${label}; when a listing does not say, mark it as unknown — never call a place "safe" for allergies or dietary needs. A place that looks halal-friendly is "likely halal", never "certified halal", unless the listing says it is certified.`;
}
