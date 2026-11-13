// Interface state machine (Layla-interface direction §2 + §5).
//
// The screen starts almost empty and the trip grows as the user talks.
// Every zone renders only when its data exists — never display:none.
//   S0 — No trip: chat only, centered, ≤ 10 interactive elements.
//   S1 — Destination known: S0 + Trip Summary + map, ≤ 18.
//   S2 — Plan built: S1 + trip panel + totals + Book, ≤ 26.

export type InterfaceState = 'S0' | 'S1' | 'S2';

// The three zones gate on three different pieces of data:
//   S1 needs a parsed destination (lastParsed) — the map needs a route.
//   S2 needs a built plan — the panel needs a plan to edit.
// A map card alone (a preview before the trip is known) never creates
// a zone on its own; it is the trip that opens the map.
export function interfaceState(opts: {
  lastParsed?: { destination?: string } | null;
  plan?: unknown;
}): InterfaceState {
  if (opts.plan) return 'S2';
  if (opts.lastParsed?.destination) return 'S1';
  return 'S0';
}

// Busy budget (§4): interactive elements in the first viewport at
// 1919×998, counted in the dev-server suite — not by eye.
export function interactiveBudget(state: InterfaceState): number {
  return state === 'S0' ? 10 : state === 'S1' ? 18 : 26;
}

// ---------------------------------------------------------------------------
// WCAG contrast helpers (§6). Small text on accent must be ≥ 4.5:1 in
// BOTH themes. The accent itself (#f97316) is display-only; small text
// uses --accent-text (#c2410c light / #fb923c dark) — the tests below
// pin that rule so a later token change cannot silently break it.
// ---------------------------------------------------------------------------

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = channelLuminance((n >> 16) & 0xff);
  const g = channelLuminance((n >> 8) & 0xff);
  const b = channelLuminance(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsContrast(fg: string, bg: string, min = 4.5): boolean {
  return contrastRatio(fg, bg) >= min;
}
