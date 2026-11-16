// Share-out helpers (social/community, Nov 15 2026) — pure functions,
// so the share menu and the tests share them. Nothing here posts
// anything: every network link opens the network's own share dialog,
// and the traveler posts it there. FujinTrip never posts for the
// traveler, and no share button ever claims a post was published.
//
// Shared links must be real public URLs on fujintrip.com:
//  - reel: /reels/:id (the post's own page)
//  - plan: /plan/:id (the plan-share copy)
//  - package: /#packages (the ready-made packages grid — the share
//    text names the package and its from-price; there is no per-package
//    page, so the link lands on the grid, never on a dead page)
//  - destination: /?tab=hotels&dest=<name> (a real stays search for
//    that destination — the hotels tab needs only a destination, so
//    the link always renders sensibly)

export type ShareKind = 'reel' | 'plan' | 'package' | 'destination';

export function sharePathFor(kind: ShareKind, id: string): string {
  switch (kind) {
    case 'reel':
      return `/reels/${id}`;
    case 'plan':
      return `/plan/${id}`;
    case 'package':
      return '/#packages';
    case 'destination':
      return `/?tab=hotels&dest=${encodeURIComponent(id)}`;
  }
}

export function shareUrlFor(origin: string, kind: ShareKind, id: string): string {
  const path = sharePathFor(kind, id);
  const base = origin.replace(/\/$/, '');
  return `${base}${path}`;
}

// The share text per kind. Prices in the text come from the caller —
// never invented here.
export function shareTextFor(kind: ShareKind, label: string, extra?: string): string {
  switch (kind) {
    case 'reel':
      return `${label} — a trip shared on FujinTrip`;
    case 'plan':
      return `${label} — planned with FujinTrip`;
    case 'package':
      return `${label} — a ready-made FujinTrip package${extra ? ` · ${extra}` : ''}`;
    case 'destination':
      return `${label} — plan a trip on FujinTrip`;
  }
}

export type ShareTargets = {
  x: string;
  facebook: string;
  whatsapp: string;
  telegram: string;
};

// The network share URLs. X/Facebook/WhatsApp are the ones the reels
// card already used; Telegram follows the same pattern (t.me/share).
export function shareTargets(url: string, text: string): ShareTargets {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
  };
}

// Web Share is a device capability, not a promise: present on mobile
// browsers, absent on most desktops. The menu checks it at click time
// and falls back to copy link + network links when it is not there.
// `nav` is injectable so the branches are testable without a browser.
export function hasWebShare(nav: unknown): boolean {
  if (!nav || typeof nav !== 'object') return false;
  const share = (nav as { share?: unknown }).share;
  return typeof share === 'function';
}
