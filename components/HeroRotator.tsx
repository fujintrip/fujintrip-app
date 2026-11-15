// Rotating homepage hero background (Nov 14, 2026): one destination
// photo at a time, crossfading every ~7s. Only photos already in the
// codebase and verified (lib/heroRotation.ts).
//
// - The first photo is the Kyoto torii, rendered eagerly exactly as
//   before — rotation starts after hydration, so the server HTML is
//   unchanged for the first paint.
// - The next photo is preloaded, so the fade never shows a blank or
//   a grey placeholder.
// - Rotation pauses when the tab is hidden and resumes on return;
//   a manual dot click resets the timer to a full interval.
// - Under prefers-reduced-motion there is no auto-rotation at all —
//   the first photo stays (the CSS also drops the fade).
// - The scrim (::after on .hero-booking-photo) paints above the
//   slides, so the headline and the white search card stay legible
//   over every photo; the dots sit above the scrim.
'use client';
import { useEffect, useState } from 'react';
import { SafeImg } from './FujinChat';
import {
  HERO_FADE_MS,
  HERO_ROTATE_MS,
  HERO_SLIDES,
  nextSlideIndex,
  rotationEnabled,
} from '../lib/heroRotation';

export default function HeroRotator() {
  const slides = HERO_SLIDES;
  const [index, setIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);

  // Reduced motion + tab visibility gates.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onMotionChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onMotionChange);
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mq.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Advance every HERO_ROTATE_MS while rotation is enabled. The
  // effect re-runs on every index change, so a manual dot click
  // resets the timer to a full interval, and returning to a visible
  // tab restarts it from a full interval too.
  useEffect(() => {
    if (!rotationEnabled(reducedMotion, visible)) return;
    const t = setInterval(() => {
      setPrevIndex(index);
      setIndex(nextSlideIndex(index, slides.length));
    }, HERO_ROTATE_MS);
    return () => clearInterval(t);
  }, [index, reducedMotion, visible, slides.length]);

  // The outgoing slide stays mounted for the fade, then unmounts.
  useEffect(() => {
    if (prevIndex === null) return;
    const t = setTimeout(() => setPrevIndex(null), HERO_FADE_MS);
    return () => clearTimeout(t);
  }, [prevIndex]);

  // Preload the next photo so the fade never shows a blank.
  useEffect(() => {
    const next = slides[nextSlideIndex(index, slides.length)];
    if (!next) return;
    const img = new Image();
    img.src = next.src;
  }, [index, slides]);

  const goTo = (i: number) => {
    if (i === index) return;
    setPrevIndex(index);
    setIndex(i);
  };

  return (
    <div className="hero-rotator">
      {prevIndex !== null && (
        <div className="hero-slide" key={`prev-${prevIndex}`} aria-hidden="true">
          <SafeImg src={slides[prevIndex].src} alt="" label={slides[prevIndex].label} />
        </div>
      )}
      <div className="hero-slide hero-slide-current" key={`current-${index}`}>
        <SafeImg
          src={slides[index].src}
          alt={slides[index].alt}
          label={slides[index].label}
          loading={index === 0 ? 'eager' : 'lazy'}
        />
      </div>
      <div className="hero-dots" role="group" aria-label="Choose hero photo">
        {slides.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`hero-dot${i === index ? ' active' : ''}`}
            aria-label={`Show ${s.label} photo`}
            aria-current={i === index ? true : undefined}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}
