/**
 * Curated local guides — researched traveler material, baked in per
 * destination. Only destinations with a researched guide are listed;
 * anything else returns null and the UI says so plainly.
 *
 * Everything here comes from the Kyoto research draft (researched from
 * traveler guides Nov 10, 2026): real dishes, real named places, typical
 * price ranges — NOT live quotes. No reviews, quotes, reviewer names or
 * scores are invented; the "what travelers say" block labels this source.
 * The live-fetch voices (lib/localVoices.ts) take precedence when they
 * exist; this guide is the fallback for destinations where the fetch
 * returns nothing.
 */

export type LocalGuide = {
  destination: string;
  source: string;
  dishes: string[];
  places: string[];
  sketch: string[];
};

const KYOTO: LocalGuide = {
  destination: 'Kyoto',
  source: 'Researched traveler guides, Nov 2026 — typical ranges, not live quotes',
  dishes: [
    'Obanzai — Kyoto home cooking: small seasonal plates with sake, ¥3,000–¥4,000/person, best on Pontocho and Gion side streets.',
    'Yudofu — silken tofu simmered in kombu dashi, dipped in ponzu; the heartland is the Nanzenji temple district. Set menus ~¥3,500–¥6,000.',
    'Nama yuba — fresh tofu skin, best in Nishiki Market, ¥200–¥500 a portion.',
    'Dashimaki tamago — Kyoto-style rolled dashi omelette; in Nishiki try Miki Keiran (since 1928) or Tanaka Keiran, ¥350–¥500.',
    'Tako tamago — baby octopus glazed in sweet soy-mirin, stuffed with a quail egg; a Nishiki signature, ¥500–¥600.',
    'Kyo-tsukemono — Kyoto pickles (senmaizuke, shibazuke, suguki); most shops offer free samples, small tubs ¥400–¥800.',
  ],
  places: [
    'Nishiki Market ("Kyoto’s Kitchen") — 400 m covered arcade; the quiet local window is 7:00–9:00 AM. Eat standing beside the stall you bought from.',
    'Tendon Makino, Teramachi — tempura donburi counter travelers keep naming; 11:00–20:30.',
    'Yamamoto Menzou, Okazaki — handmade Sanuki-style udon near Heian Jingu, ~¥1,400–¥1,700; Michelin Bib Gourmand.',
    'Cafe Yamamoto, Higashiyama — old-style kissaten (coffee house), 7:00–18:00, closed Tuesdays.',
    'Okutan Nanzenji — yudofu founded 1635, tatami seating over a garden, set menus ~¥3,500–¥4,500.',
    'Pontocho Alley — ~500 m stone-paved lane of machiya restaurants; May–September, book a kawayuka river-terrace deck over the Kamogawa.',
  ],
  sketch: [
    'Day 1 — Central: Nishiki Market 7:00–9:00 AM (yuba, tamagoyaki, pickles) → lunch Tendon Makino Teramachi → evening Pontocho alley, obanzai, walk the Kamogawa bank.',
    'Day 2 — East: morning Nanzenji — yudofu lunch at Okutan → afternoon Okazaki, udon at Yamamoto Menzou → evening Gion side streets.',
    'Day 3 — Slow local day: kissaten breakfast at Cafe Yamamoto → Gion/Higashiyama on foot or by bicycle → kaiseki lunch (half the dinner price) instead of dinner.',
  ],
};

const GUIDES: Record<string, LocalGuide> = { Kyoto: KYOTO };

export function guideFor(destination: string): LocalGuide | null {
  return GUIDES[destination] ?? null;
}
