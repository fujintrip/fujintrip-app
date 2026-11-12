// Expandable row (Layla-dynamic round, Nov 12, 2026): Layla's hotel
// and day cards expand inline — the summary stays visible, the detail
// opens on tap. Same pattern here for the plan view's stop, stay,
// transport and day rows. A native <button> drives it (keyboard
// accessible: Tab reaches it, Space/Enter toggles, aria-expanded says
// the state), and the body opens with a grid-rows transition — smooth
// motion in small increments, and the global prefers-reduced-motion
// rule already turns all of it off. Print forces every body open
// (see globals.css), so the PDF plan never loses the day-by-day
// behind a collapsed row.
'use client';
import { useId, useState, type ReactNode } from 'react';

export default function Expandable({
  summary,
  children,
  defaultOpen = false,
  className = '',
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={`expandable ${className}${open ? ' open' : ''}`}>
      <button type="button" className="expandable-summary" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span className="expandable-chevron" aria-hidden="true">
          ›
        </span>
        <span className="expandable-summary-text">{summary}</span>
      </button>
      <div id={bodyId} className="expandable-body" aria-hidden={!open}>
        <div className="expandable-body-inner">{children}</div>
      </div>
    </div>
  );
}
