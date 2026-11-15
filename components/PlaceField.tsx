// PlaceField — the professional type-ahead for one place field in the
// search widget (API phase round 1, Nov 14, 2026). Replaces the native
// <datalist id="fujin-places">, which only offered a hardcoded list
// with no live suggestions.
//
// Behavior:
// - Suggestions appear as the traveler types (debounced ~250ms, short
//   client cache), from GET /api/places — Travelpayouts autocomplete,
//   then Nominatim, then the known list (see lib/places.ts).
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
//   typing does.
'use client';
import { useEffect, useRef, useState } from 'react';
import {
  autocompleteKeyDown,
  fetchPlaceSuggestions,
  type PlaceSuggestion,
} from '../lib/places';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

function kindLabel(kind: PlaceSuggestion['kind']): string {
  return kind === 'airport' ? 'Airport' : kind === 'region' ? 'Region' : 'City';
}

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
  // True only when the last value change came from typing in this
  // field — selection and destination-card prefill set the value
  // without typing, and must not pop the listbox open.
  const typedRef = useRef(false);
  const seqRef = useRef(0);

  useEffect(() => {
    // Any value change invalidates a pending debounced fetch.
    const seq = ++seqRef.current;
    if (!typedRef.current) return;
    if (value.trim().length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      setActive(-1);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const places = await fetchPlaceSuggestions(value);
      if (seq !== seqRef.current) return; // a newer keystroke won
      setSuggestions(places);
      setSearched(true);
      setLoading(false);
      setOpen(true);
      setActive(-1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const select = (s: PlaceSuggestion) => {
    onChange(s.value);
    setOpen(false);
    setActive(-1);
    setSuggestions([]);
    setSearched(false);
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
                  <span className="sw-sug-meta">
                    {kindLabel(s.kind)}
                    {s.country ? ` · ${s.country}` : ''}
                    {s.iata ? ` (${s.iata})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
