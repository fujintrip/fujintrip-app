/**
 * Pace guard (round 4 #1, UGC learning §3 — Suptravel / Cruise Critic /
 * the Tokyo case: "I planned 8 attractions in one day in Tokyo. I
 * managed to see 3. The rest of the trip was catching up on sleep.").
 *
 * The AI that says yes to everything is the failure mode travelers
 * name most after hallucination: it kept nodding yes to extra stops
 * without guarding the trip's core purpose. The guard is a planner
 * constraint, not a veto — a pace slot (relaxed / moderate / packed),
 * a latest start time, a max main sights per day, and a nap window for
 * families. A day over the pace gets a warning on its day card and a
 * "drop one, or add a day?" prompt when a revision breaks pace.
 *
 * Thresholds: relaxed 4, moderate 6, packed 8 main sights a day. The
 * "8+ activities" day from the report warns on the default (moderate)
 * pace and on relaxed; a packed pace allows 8. Every warning names the
 * day, the count and the max — never a bare "too packed".
 */

import type { TravelerProfile } from './preferences';

// The minimal card shape the guard needs — stops with their day
// titles and experience counts. A structural type, so tripCard.ts can
// call it while the card is still being built.

export type PaceLevel = 'relaxed' | 'moderate' | 'packed';

// Max main sights per day, per pace. The report's 8-attraction Tokyo
// day is over pace on relaxed and moderate, and exactly at the limit
// on packed — so the guard fires for the travelers who need it and
// stays quiet for the ones who asked for a packed trip.
export const PACE_MAX_SIGHTS: Record<PaceLevel, number> = {
  relaxed: 4,
  moderate: 6,
  packed: 8,
};

// The profile's pace vocabulary (slow / relaxed / fast, round 3) maps
// onto the guard's three levels; an unset pace is moderate.
export function paceFromProfile(profile?: TravelerProfile | null): PaceLevel {
  if (!profile) return 'moderate';
  if (profile.pace === 'slow') return 'relaxed';
  if (profile.pace === 'fast') return 'packed';
  return 'moderate';
}

// A traveler-set max (the "at most 3 sights a day" slot) overrides the
// pace default. Out-of-range values are ignored, never clamped into a
// surprise.
export function maxSightsFor(pace: PaceLevel, override?: number): number {
  if (typeof override === 'number' && Number.isInteger(override) && override >= 1 && override <= 10) return override;
  return PACE_MAX_SIGHTS[pace];
}

export function paceCheckDay(
  experiences: number,
  pace: PaceLevel,
  maxOverride?: number
): { ok: boolean; warning?: string } {
  const max = maxSightsFor(pace, maxOverride);
  if (experiences <= max) return { ok: true };
  return {
    ok: false,
    warning: `This day is too packed — ${experiences} experiences planned for a ${pace} pace (max ${max} main sights a day), with no buffer between them. Drop one, or add a day?`,
  };
}

export type PaceWarning = {
  day: number;
  city: string;
  title: string;
  experiences: number;
  max: number;
  warning: string;
};

export function paceWarningsForCard(
  card: { stops: Array<{ city: string; days: Array<{ day: number; title: string; experiences: number }> }> },
  pace: PaceLevel,
  maxOverride?: number
): PaceWarning[] {
  const out: PaceWarning[] = [];
  for (const stop of card.stops) {
    for (const d of stop.days) {
      const check = paceCheckDay(d.experiences, pace, maxOverride);
      if (!check.ok) {
        out.push({
          day: d.day,
          city: stop.city,
          title: d.title,
          experiences: d.experiences,
          max: maxSightsFor(pace, maxOverride),
          warning: check.warning ?? '',
        });
      }
    }
  }
  return out;
}

// The prompt the chat gives when a revision breaks pace — "drop Y or
// add a day?" per the report, naming the day, and (by the every-
// follow-up-is-an-edit rule) stating that everything else stays.
export function paceRevisionPrompt(warnings: PaceWarning[]): string {
  if (!warnings.length) return '';
  const w = warnings[0];
  return `Day ${w.day} in ${w.city} (${w.title}) is now over pace at ${w.experiences} experiences — drop one, or add a day? Everything else in the plan stays as it was.`;
}

// Nap / rest block (round 4 #1, family): when the trip has a child
// under 5 and the traveler set a nap window, the day gets a protected
// rest note — a slot, not an invented activity.
export function napNoteFor(kids: number[], napWindow?: boolean): string {
  if (!napWindow) return '';
  if (!kids.some((a) => a < 5)) return '';
  return 'Protected rest after lunch — nap window for the little ones.';
}
