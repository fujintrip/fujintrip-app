// Photo carousel (interface round S3): Layla's destination cards swipe
// through photos with a counter. Ours shows a carousel only when a
// template has more than one photo — a single photo renders as a plain
// image (no counter, no thumbs), and a template with no photo renders
// the destination name on the fallback gradient. The thumbs are the
// numbered buttons from ReelCard; the counter is a badge on the photo.
// A failed photo falls back to the gradient, like SafeImg.
'use client';
import { useState } from 'react';

export default function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (photos.length === 0 || failed) {
    return (
      <div className="img-fallback" role="img" aria-label={alt}>
        <span>{alt}</span>
      </div>
    );
  }
  const src = photos[Math.min(idx, photos.length - 1)];
  return (
    <div className="photocarousel">
      <div className="photocarousel-media">
        {!loaded && (
          <div className="img-loading skeleton" style={{ position: 'absolute', inset: 0 }} role="img" aria-label={alt}>
            <span>{alt}</span>
          </div>
        )}
        {/* Never display:none while loading: a lazy image with no
            layout box never intersects the viewport, so it never
            fetches and the shimmer shows forever (defect, Nov 14
            2026 — the template cards' photos never decoded). The
            image stays in flow at opacity 0; the shimmer overlays
            its box. .photocarousel-media is already position:relative. */}
        <img src={src} alt={alt} loading="lazy" style={loaded ? undefined : { opacity: 0 }} onError={() => setFailed(true)} onLoad={() => setLoaded(true)} />
        {photos.length > 1 && (
          <span className="photocarousel-count" aria-label={`Photo ${idx + 1} of ${photos.length}`}>
            {idx + 1} / {photos.length}
          </span>
        )}
      </div>
      {photos.length > 1 && (
        <div className="carousel-thumbs" role="group" aria-label={`More photos of ${alt}`}>
          {photos.map((p, i) => (
            <button
              key={p}
              type="button"
              className={i === idx ? 'selected' : ''}
              aria-pressed={i === idx}
              onClick={() => {
                setFailed(false);
                setLoaded(false);
                setIdx(i);
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
