// The shared share menu (social/community, Nov 15 2026) — one menu
// for reels, plans, packages and destinations, so the share behavior
// is the same everywhere it appears.
//
// Behavior, in order:
//  1. Web Share (navigator.share) when the device has it — the
//     traveler's own share sheet, on their device.
//  2. Otherwise (or on any non-cancel failure) the fallback menu:
//     copy link + X / Facebook / WhatsApp / Telegram links.
// A cancelled share sheet (AbortError) is the traveler changing
// their mind — nothing opens and nothing is reported as shared.
// Nothing here ever claims a post was published: the honest note
// under the links says the traveler posts it on the network they
// choose. `url` may be a path — it is resolved against this origin
// at click time, so server-rendered pages never need window.
'use client';
import { useState } from 'react';
import { hasWebShare, shareTargets } from '../lib/share';

export default function ShareMenu({
  url,
  text,
  title,
  label = 'Share',
}: {
  url: string;
  text: string;
  title?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');

  const absoluteUrl = () => {
    if (/^https?:\/\//i.test(url)) return url;
    if (typeof window === 'undefined') return url;
    return `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
  };

  const share = async () => {
    const full = absoluteUrl();
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (hasWebShare(nav)) {
      try {
        await (nav as Navigator & { share: (data: ShareData) => Promise<void> }).share({
          title: title ?? text,
          text,
          url: full,
        });
        return;
      } catch (e) {
        // The traveler closed the sheet — nothing to do.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // Any other failure falls through to the link menu.
      }
    }
    setOpen((o) => !o);
  };

  const copyLink = async () => {
    const full = absoluteUrl();
    try {
      await navigator.clipboard.writeText(full);
      setMsg('Link copied.');
    } catch {
      setMsg(`Copy this link: ${full}`);
    }
  };

  const targets = shareTargets(absoluteUrl(), text);

  return (
    <>
      <button type="button" className="ghost" onClick={() => void share()} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="reel-share share-panel" role="group" aria-label="Share options">
          <button type="button" className="ghost" onClick={() => void copyLink()}>
            Copy link
          </button>{' '}
          <a className="ghost" href={targets.x} target="_blank" rel="noreferrer">
            X
          </a>{' '}
          <a className="ghost" href={targets.facebook} target="_blank" rel="noreferrer">
            Facebook
          </a>{' '}
          <a className="ghost" href={targets.whatsapp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>{' '}
          <a className="ghost" href={targets.telegram} target="_blank" rel="noreferrer">
            Telegram
          </a>
          <p className="plan-note" style={{ marginTop: 8 }}>
            You post it on the network you choose — FujinTrip never posts for you.
          </p>
          {msg && <p className="plan-note">{msg}</p>}
        </div>
      )}
    </>
  );
}
