// Airline logo for the rich fare cards (Nov 15, 2026): the
// operating airline's logo next to its name, from Kiwi's public
// airline logo set — verified live Nov 15 (BA/AA/TP/LH/EK return
// HTTP 200 image/png at 64x64; an unknown code 303s to Kiwi's
// generic placeholder image). The URL is built from the carrier
// code only, never hardcoded per airline. Fallback is an initials
// tile — the same pattern as SafeImg — when there is no code, the
// logo fails to load, or the carrier is Duffel's fictional test
// carrier ("Duffel Airways" has no real logo, so it never gets a
// fetched one). A broken-image icon is never shown.
'use client';
import { useEffect, useRef, useState } from 'react';
import { airlineInitials, airlineLogoUrl, isTestCarrier } from '../lib/duffel';

export function AirlineLogo({ code, name, size = 32 }: { code?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // A cached image that finished loading before hydration fires no
  // load event — the mount effect closes that race the same way
  // SafeImg does: complete + no width means the logo did not decode.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth === 0) setFailed(true);
  }, []);
  if (!code || isTestCarrier(name) || failed) {
    return (
      <span className="airline-logo-fallback" style={{ width: size, height: size }} role="img" aria-label={name}>
        {airlineInitials(name)}
      </span>
    );
  }
  return (
    <img
      ref={imgRef}
      className="airline-logo"
      src={airlineLogoUrl(code)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
