// Theme (Layla-interface direction §6): light by default, dark by
// preference — never forced. The inline script in layout.tsx sets
// data-theme on <html> BEFORE first paint, so there is no flash;
// everything below keeps that same decision in sync.
//
//   Stored choice (localStorage 'fujin-trip-theme') beats the OS
//   preference, because the traveler chose it on purpose.

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'fujintrip-theme';

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // storage unavailable — fall through to the OS preference
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
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
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('light');
  useEffect(() => {
    setThemeState(readTheme());
    const onChange = (e: Event) => {
      const t = (e as CustomEvent<Theme>).detail;
      if (t === 'light' || t === 'dark') setThemeState(t);
    };
    window.addEventListener('fujintrip:theme', onChange);
    return () => window.removeEventListener('fujintrip:theme', onChange);
  }, []);
  return [theme, (t: Theme) => { applyTheme(t); setThemeState(t); }];
}
