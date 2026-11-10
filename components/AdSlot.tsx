'use client';
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

let scriptLoaded = false;

function loadAdSenseScript(publisherId: string) {
  if (scriptLoaded || typeof document === 'undefined') return;
  scriptLoaded = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
}

/**
 * Google AdSense slot — DORMANT by default.
 *
 * Renders nothing at all unless a publisher ID is configured via
 * NEXT_PUBLIC_ADSENSE_ID *and* a slot ID is passed in. No ad unit is
 * requested without both, and the AdSense script is never loaded while
 * dormant. If ads are blocked or fail, the slot stays quiet and never
 * breaks the page.
 *
 * Placement rule: only ever use this in content areas below the fold
 * (between destination sections, above the footer). Never in the hero,
 * the search panel, the Fujin AI chat/planner, My Trips, or any
 * checkout flow.
 */
export default function AdSlot({ slot }: { slot: string }) {
  const publisherId = process.env.NEXT_PUBLIC_ADSENSE_ID;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!publisherId || !slot) return;
    loadAdSenseScript(publisherId);
    setReady(true);
  }, [publisherId, slot]);

  useEffect(() => {
    if (!ready) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ads blocked or not yet ready — stay quiet, never break the page.
    }
  }, [ready]);

  if (!publisherId || !slot) return null;

  return (
    <div className="adslot" aria-label="Advertisement">
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={publisherId}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
