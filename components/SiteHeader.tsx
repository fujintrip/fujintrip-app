// Direction v3 site header (Nov 14, 2026): the sticky header,
// Booking pattern — logo, category nav, ONE "Plan with AI" pill,
// sign in, My Trips, theme toggle. The pill is the ONLY AI entry
// point on the site: it links to /chat and is never duplicated
// anywhere else (no hero AI button, no AI button in results or
// footer, no "Ask Fujin AI" link).
'use client';
import { useState } from 'react';
import { HOME_TABS, type HomeTabId } from '../lib/homeTabs';
import { AccountButton } from './AccountGate';

export default function SiteHeader({
  theme,
  onThemeToggle,
  onSelectCategory,
  myTripsHref = '#mytrips',
}: {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  // On the homepage the nav selects the category in the hero search
  // widget (and scrolls to it) instead of navigating. Everywhere
  // else the links are plain deep links to /?tab=<id>.
  onSelectCategory?: (id: HomeTabId) => void;
  myTripsHref?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const navClick = (id: HomeTabId) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onSelectCategory) return;
    e.preventDefault();
    closeMenu();
    onSelectCategory(id);
  };
  return (
    <header className="site-header">
      <a href="/" className="logo">
        Fujin<span>Trip</span>
      </a>
      <nav className="site-nav" aria-label="Book by category">
        {HOME_TABS.map((t) => (
          <a key={t.id} href={`/?tab=${t.id}`} onClick={navClick(t.id)}>
            {t.label}
          </a>
        ))}
      </nav>
      <div className="site-actions">
        <a href="/chat" className="ai-pill">
          <span className="ai-pill-icon" aria-hidden="true">
            ✦
          </span>
          <span className="ai-pill-full">Plan with AI</span>
          <span className="ai-pill-short">AI</span>
        </a>
        <span className="site-account-desktop">
          <AccountButton />
        </span>
        <a href={myTripsHref} className="site-link site-link-desktop">
          My Trips
        </a>
        <button
          type="button"
          className="ghost site-theme"
          aria-pressed={theme === 'dark'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onThemeToggle}
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
        <button
          type="button"
          className="ghost hamburger"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>
      {menuOpen && (
        <div className="site-menu" role="menu" aria-label="Site menu">
          {HOME_TABS.map((t) => (
            <a key={t.id} href={`/?tab=${t.id}`} role="menuitem" onClick={navClick(t.id)}>
              {t.icon} {t.label}
            </a>
          ))}
          <a href={myTripsHref} role="menuitem" onClick={closeMenu}>
            My Trips
          </a>
          <span className="site-account-mobile" onClick={closeMenu}>
            <AccountButton />
          </span>
        </div>
      )}
    </header>
  );
}
