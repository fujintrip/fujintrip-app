// Hotel photo gallery (interface round, Nov 16 2026 — P1 #12):
// the client island on the server-rendered hotel detail page —
// the main photo plus a thumbnail row; tapping a thumb switches
// the main photo. The page itself is a server component (the
// sandbox search runs server-side, so the link renders content
// without JavaScript); only the photo switcher needs the client.
'use client';
import { useState } from 'react';
import { SafeImg } from './FujinChat';

export default function HotelGallery({ images, name }: { images: string[]; name: string }) {
  const [activePhoto, setActivePhoto] = useState(0);
  if (images.length === 0) return null;
  return (
    <div className="result-gallery" style={{ marginBottom: 16 }}>
      <SafeImg
        src={images[Math.min(activePhoto, images.length - 1)]}
        alt={name}
        label={name}
        className="result-photo"
      />
      {images.length > 1 && (
        <div className="gallery-thumbs" role="group" aria-label={`Photos of ${name}`}>
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              className={`gallery-thumb${i === activePhoto ? ' selected' : ''}`}
              onClick={() => setActivePhoto(i)}
              aria-label={`Photo ${i + 1} of ${images.length}`}
              aria-pressed={i === activePhoto}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
