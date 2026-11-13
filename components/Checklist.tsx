// Pre-departure checklist (round 4 #2) — a tickable list generated
// from the trip itself (lib/checklist.ts), grouped by category, with
// the due date on every item that has one. Ticks persist on this
// device only (localStorage, keyed per trip) — the same key in the
// plan view and the Today view, so a tick in one shows in the other.
'use client';
import { useEffect, useState } from 'react';
import { CHECKLIST_CATEGORIES, type ChecklistItem } from '../lib/checklist';

export default function Checklist({
  items,
  storageKey,
  readOnly = false,
}: {
  items: ChecklistItem[];
  storageKey: string;
  readOnly?: boolean;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDone(new Set(JSON.parse(raw) as string[]));
      else setDone(new Set());
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const toggle = (id: string) => {
    if (readOnly) return;
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };
  const doneCount = items.filter((i) => done.has(i.id)).length;
  const categories = (Object.keys(CHECKLIST_CATEGORIES) as Array<keyof typeof CHECKLIST_CATEGORIES>).filter((c) =>
    items.some((i) => i.category === c)
  );
  if (!items.length) return null;
  return (
    <div>
      <p className="plan-line">
        {doneCount} of {items.length} done — generated from this trip, timed weeks ahead. Tick items off as you do them; ticks stay on this device.
      </p>
      {categories.map((cat) => (
        <div key={cat} style={{ marginTop: 10 }}>
          <strong style={{ fontSize: 14 }}>{CHECKLIST_CATEGORIES[cat]}</strong>
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
            {items
              .filter((i) => i.category === cat)
              .map((item) => (
                <li key={item.id} style={{ margin: '8px 0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    className="today-done"
                    aria-pressed={done.has(item.id)}
                    aria-label={done.has(item.id) ? `Mark ${item.label} not done` : `Mark ${item.label} done`}
                    onClick={() => toggle(item.id)}
                    disabled={readOnly}
                    style={{ flexShrink: 0, marginTop: 2 }}
                  >
                    {done.has(item.id) ? '✓' : ''}
                  </button>
                  <div style={{ opacity: done.has(item.id) ? 0.55 : 1 }}>
                    <strong style={{ fontSize: 14, textDecoration: done.has(item.id) ? 'line-through' : 'none' }}>{item.label}</strong>
                    {item.dueLabel && <span style={{ fontSize: 13, color: 'var(--muted)' }}> — {item.dueLabel}</span>}
                    {item.detail && <p className="plan-note" style={{ margin: '2px 0 0' }}>{item.detail}</p>}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
