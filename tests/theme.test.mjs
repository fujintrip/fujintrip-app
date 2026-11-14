// Theme resolution — one source of truth for light/dark.
// (Defect, Nov 14 2026: first load paired a light page with a dark
// map and a toggle reading "Switch to light theme" — the pre-paint
// script's decision, the React state and the map disagreed. The fix
// resolves the theme once, writes it back to <html> when it differs,
// and syncs in a layout effect, before first paint.)
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/theme.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, readTheme, applyTheme, THEME_KEY } from '../lib/theme.ts';

test('resolveTheme: a stored choice beats the OS preference', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});

test('resolveTheme: no stored choice (or a bogus one) falls through to the OS', () => {
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
  assert.equal(resolveTheme('banana', true), 'dark');
  assert.equal(resolveTheme('', false), 'light');
});

// Minimal browser stubs: the lib only touches document/window/
// localStorage at call time, never at import time.
function installStubs({ attr = null, stored = null, osDark = false } = {}) {
  const calls = { setAttr: [], setItem: [], dispatched: [] };
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
  };
  globalThis.document = {
    documentElement: {
      getAttribute: () => attr,
      setAttribute: (k, v) => calls.setAttr.push([k, v]),
    },
  };
  globalThis.window = {
    matchMedia: () => ({ matches: osDark }),
    dispatchEvent: (e) => calls.dispatched.push(e),
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.localStorage = {
    getItem: () => stored,
    setItem: (k, v) => calls.setItem.push([k, v]),
  };
  return {
    calls,
    restore() {
      if (saved.document === undefined) delete globalThis.document;
      else globalThis.document = saved.document;
      if (saved.window === undefined) delete globalThis.window;
      else globalThis.window = saved.window;
      if (saved.localStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = saved.localStorage;
    },
  };
}

test('readTheme: the <html> attribute wins when present', () => {
  const s = installStubs({ attr: 'dark', stored: 'light', osDark: false });
  try {
    assert.equal(readTheme(), 'dark');
  } finally {
    s.restore();
  }
  const s2 = installStubs({ attr: 'light', stored: 'dark', osDark: true });
  try {
    assert.equal(readTheme(), 'light');
  } finally {
    s2.restore();
  }
});

test('readTheme: no attribute falls back to the stored choice, then the OS', () => {
  const s = installStubs({ attr: null, stored: 'dark', osDark: false });
  try {
    assert.equal(readTheme(), 'dark');
  } finally {
    s.restore();
  }
  const s2 = installStubs({ attr: null, stored: null, osDark: true });
  try {
    assert.equal(readTheme(), 'dark');
  } finally {
    s2.restore();
  }
  const s3 = installStubs({ attr: null, stored: null, osDark: false });
  try {
    assert.equal(readTheme(), 'light');
  } finally {
    s3.restore();
  }
});

test('applyTheme: writes the attribute, persists the choice, and notifies listeners — so page, toggle and map can never disagree', () => {
  const s = installStubs({ attr: 'light', stored: 'light', osDark: false });
  try {
    applyTheme('dark');
    assert.deepEqual(s.calls.setAttr, [['data-theme', 'dark']]);
    assert.deepEqual(s.calls.setItem, [[THEME_KEY, 'dark']]);
    assert.equal(s.calls.dispatched.length, 1);
    assert.equal(s.calls.dispatched[0].type, 'fujintrip:theme');
    assert.equal(s.calls.dispatched[0].detail, 'dark');
  } finally {
    s.restore();
  }
});
