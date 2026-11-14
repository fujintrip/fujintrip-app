// Theme (Layla-interface direction §6): light by default, dark by
// preference — never forced. The inline script in layout.tsx sets
// data-theme on <html> BEFORE first paint, so there is no flash;
// everything below keeps that same decision in sync.
//
//   Stored choice (localStorage 'fujin-trip-theme') beats the OS
//   preference, because the traveler chose it on purpose.

import { useEffect, useLayoutEffect, useState } from 'react';

// Layout effects run before first paint; passive effects run after it.
// The theme sync must land before paint (defect, Nov 14 2026: the
// first load paired a light page with a dark map and a wrong toggle
// label). On the server there is no layout effect, so the SSR-safe
// alias falls back to useEffect there.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'fujintrip-theme';

// Pure theme decision, shared by readTheme and the pre-paint script in
// layout.tsx: a stored choice beats the OS preference, because the
// traveler chose it on purpose; anything else (no stored value, or a
// stored value that is not 'light'/'dark') falls through to the OS.
export function resolveTheme(stored: string | null, osDark: boolean): Theme {
  if (stored === 'dark' || stored === 'light') return stored;
  return osDark ? 'dark' : 'light';
}

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    // storage unavailable — fall through to the OS preference
  }
  const osDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return resolveTheme(stored, Boolean(osDark));
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable — the attribute still applies for this page
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<Theme>('fujintrip:theme', { detail: theme }));
  }
}

// React hook: the current theme, kept in sync with applyTheme() calls
// from anywhere on the page (the app-bar toggle, another component).
//
// The first paint must already agree: the hook starts from the
// server's 'light' (so hydration matches), then the sync below runs
// as a LAYOUT effect — before the browser paints — and writes the
// resolved theme back to <html> when it differs. That write-back is
// what closes the Nov 14 defect: if the pre-paint script never ran
// (cached shell, blocked script), the attribute stayed unset while
// the state read 'dark' from storage, and the page, the toggle and
// the map disagreed until the next toggle click. After this effect
// the attribute, the state and the map are the same theme, always.
// The map is client-only and is created in a passive effect, which
// runs after this layout effect — so it mounts with the resolved
// theme, never with the pre-sync one.
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('light');
  useIsomorphicLayoutEffect(() => {
    const t = readTheme();
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== t) {
      applyTheme(t);
    }
    setThemeState(t);
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      if (next === 'light' || next === 'dark') setThemeState(next);
    };
    window.addEventListener('fujintrip:theme', onChange);
    return () => window.removeEventListener('fujintrip:theme', onChange);
  }, []);
  return [theme, (t: Theme) => { applyTheme(t); setThemeState(t); }];
}
