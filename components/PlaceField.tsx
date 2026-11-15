// PlaceField — the professional type-ahead for one place field in the
// search widget (API phase round 1, Nov 14, 2026). Replaces the native
// <datalist id="fujin-places">, which only offered a hardcoded list
// with no live suggestions.
//
// Behavior:
// - Suggestions appear as the traveler types (debounced ~250ms, short
//   client cache), from GET /api/places — Travelpayouts autocomplete,
//   then Nominatim, then the known list (see lib/places.ts). Pasting
//   text fires the same debounced fetch as typing: the component
//   drives the paste itself (onPaste below) because a paste does not
//   always deliver a usable change event.
// - Keyboard: ArrowDown/ArrowUp cycle, Enter selects the highlighted
//   suggestion, Escape closes. Mouse: click (mousedown) selects.
// - ARIA: combobox on the input, listbox/option on the suggestions,
//   aria-expanded / aria-activedescendant wired.
// - Loading state ("Searching…") and an honest empty state ("No
//   matches — try another spelling"). A failed fetch is an empty list,
//   never an invented place — the field stays a usable plain input.
// - Selecting a suggestion fills the field with the suggestion's value
//   (for an airport, the city it serves) and the existing submit flow
//   resolves it exactly as a typed place today. Values set by selection
//   or by a destination-card prefill do NOT trigger a fetch — only
//   typing (and pasting) does. A selection closes the listbox for
//   good: the value change it causes must not re-open it.
'use client';
import { useEffect, useRef, useState } from 'react';
import {
  autocompleteKeyDown,
  fetchPlaceSuggestions,
  suggestionMeta,
  type PlaceSuggestion,
} from '../lib/places';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

export default function PlaceField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const listId = `${id}-suggestions`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // True only when the last value change came from typing or pasting
  // in this field — selection and destination-card prefill set the
  // value without typing, and must not pop the listbox open.
  const typedRef = useRef(false);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One debounced fetch for a typed or pasted value. The seq guard
  // drops whichever call is stale when a paste and a keystroke (or
  // two schedules of the same value) overlap.
  const scheduleFetch = (q: string) => {
    const seq = ++seqRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      setActive(-1);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const places = await fetchPlaceSuggestions(q);
      if (seq !== seqRef.current) return; // a newer keystroke won
      setSuggestions(places);
      setSearched(true);
      setLoading(false);
      setOpen(true);
      setActive(-1);
    }, DEBOUNCE_MS);
  };

  useEffect(() => {
    // Any value change invalidates a pending debounced fetch.
    if (!typedRef.current) return;
    scheduleFetch(value);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value]);

  const select = (s: PlaceSuggestion) => {
    // The value change below must NOT re-trigger the fetch: the
    // traveler picked a place, they are done typing. typedRef is
    // cleared first, so the value effect returns early and the
    // listbox stays closed (defect, Nov 15 2026: the dropdown
    // reopened ~250ms after a selection and covered the "All-in
    // prices…" disclaimer under the search card).
    typedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    onChange(s.value);
    setOpen(false);
    setActive(-1);
    setSuggestions([]);
    setSearched(false);
    setLoading(false);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    // Paste fires the same debounced fetch as typing. The component
    // drives the paste itself — prevent the native insert, compute
    // the pasted value, push it through the normal onChange path —
    // because some paste paths (context-menu paste, browser
    // extensions, automation) do not deliver a usable change event,
    // and a paste that never fetches looks broken (defect, Nov 15
    // 2026: pasting never opened suggestions).
    e.preventDefault();
    typedRef.current = true;
    const pasted = e.clipboardData.getData('text');
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + pasted + el.value.slice(end);
    onChange(next);
    scheduleFetch(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const { state, selected } = autocompleteKeyDown({ open, active }, e.key, suggestions.length);
    if (selected !== null) {
      e.preventDefault();
      select(suggestions[selected]);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape') {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(state.open);
      setActive(state.active);
    }
  };

  return (
    <>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          typedRef.current = true;
          onChange(e.target.value);
        }}
        onPaste={onPaste}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
      />
      {open && (
        <div className="sw-suggestions" id={listId}>
          {loading ? (
            <p className="sw-sug-status" role="status">
              Searching…
            </p>
          ) : suggestions.length === 0 ? (
            <p className="sw-sug-status" role="status">
              No matches — try another spelling
            </p>
          ) : (
            <ul role="listbox" aria-label={`${label} suggestions`}>
              {suggestions.map((s, i) => (
                <li
                  key={`${s.kind}:${s.name}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`sw-suggestion${i === active ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    // Mousedown (not click): the input must not blur
                    // before the selection lands.
                    e.preventDefault();
                    select(s);
                  }}
                >
                  <span className="sw-sug-name">{s.name}</span>
                  <span className="sw-sug-meta">{suggestionMeta(s)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
