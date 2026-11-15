// Rotating homepage hero background (Nov 14, 2026): the hero cycles
// through destination photos already in the codebase and verified —
// the Kyoto Yasaka pagoda hero photo, the 12 CITY_PHOTOS, and the 3
// hidden-gem photos. Never invent a photo URL: every slide is built
// from lib/data.ts (GLOBAL_DESTINATIONS / CITY_PHOTOS / HIDDEN_GEMS),
// plus the hero Yasaka pagoda URL itself — it must stay identical to
// HERO_PHOTO in components/FujinChat.tsx (same photo ID, portrait crop
// w=900&h=1200 — the Kyoto template photo in GLOBAL_DESTINATIONS is
// the same photo with a landscape crop, so it is NOT the same URL).
// The unit test pins the two equal.
import { CITY_PHOTOS, HIDDEN_GEMS } from './data';

// The hero Yasaka pagoda photo, exactly as the hero rendered it before
// rotation — first slide, rendered eagerly.
const HERO_KYOTO = 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=900&h=1200&q=70';

export type HeroSlide = { src: string; alt: string; label: string };

// Subjects verified Nov 14, 2026 (lib/data.ts header comment):
// Prague Old Town Square, Lisbon Tram 28, Giza pyramids, Colosseum,
// Sagrada Familia spires, Wat Arun, Hagia Sophia, Koutoubia minaret,
// India Gate, Big Ben, Mexico City Zocalo, Lower Manhattan skyline.
const CITY_ALT: Record<string, string> = {
  Prague: 'Old Town Square in Prague',
  Lisbon: 'Tram 28 in Lisbon',
  Cairo: 'The Giza pyramids near Cairo',
  Rome: 'The Colosseum in Rome',
  Barcelona: 'Sagrada Familia spires in Barcelona',
  Bangkok: 'Wat Arun in Bangkok',
  Istanbul: 'Hagia Sophia in Istanbul',
  Marrakech: 'The Koutoubia minaret in Marrakech',
  Delhi: 'India Gate in Delhi',
  London: 'Big Ben in London',
  'Mexico City': 'The Zocalo in Mexico City',
  'New York': 'Lower Manhattan skyline in New York',
};

// First slide is the Kyoto hero photo — the Yasaka pagoda street at
// sunset (Unsplash photo-1493976040374-85c8e12f0c0e). The alt used to
// say "Torii gates at Fushimi Inari" — wrong subject (defect, Nov 14
// 2026); the photo shows the pagoda street, not the torii gates.
export const HERO_SLIDES: HeroSlide[] = [
  { src: HERO_KYOTO, alt: 'Yasaka pagoda street at sunset, Kyoto', label: 'Kyoto' },
  ...Object.entries(CITY_PHOTOS).map(([city, src]) => ({
    src,
    alt: CITY_ALT[city] ?? city,
    label: city,
  })),
  ...HIDDEN_GEMS.map((d) => ({ src: d.image, alt: `${d.name}, ${d.country}`, label: d.name })),
];

// New photo every ~7s; crossfade ~1s.
export const HERO_ROTATE_MS = 7000;
export const HERO_FADE_MS = 1000;

export function nextSlideIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return (index + 1) % total;
}

// Auto-rotation runs only when the traveler can see the tab and has
// not asked for reduced motion. Pure so the unit test can pin it.
export function rotationEnabled(reducedMotion: boolean, hidden: boolean): boolean {
  return !reducedMotion && !hidden;
}
