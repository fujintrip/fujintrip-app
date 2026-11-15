// Photo carousel (interface round S3): Layla's destination cards swipe
// through photos with a counter. Ours shows a carousel only when a
// template has more than one photo — a single photo renders as a plain
// image (no counter, no thumbs), and a template with no photo renders
// the destination name on the fallback gradient. The thumbs are the
// numbered buttons from ReelCard; the counter is a badge on the photo.
// A failed photo falls back to the gradient, like SafeImg.
'use client';
import { useEffect, useRef, useState } from 'react';

export default function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Same pre-hydration race as SafeImg (defect, Nov 14 2026): an image
  // that finishes loading before React attaches onLoad — cached from
  // an earlier page in the same session — would sit at opacity 0
  // forever behind its shimmer. If the img is already complete when
  // this mounts, trust its naturalWidth.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) setLoaded(true);
    else setFailed(true);
  }, []);
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
        <img ref={imgRef} src={src} alt={alt} loading="lazy" style={loaded ? undefined : { opacity: 0 }} onError={() => setFailed(true)} onLoad={() => setLoaded(true)} />
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
