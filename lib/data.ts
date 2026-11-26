export type Destination = {
  name: string;
  country: string;
  tag: string;
  blurb: string;
  trend: string;
  priceFrom: string;
  image: string;
  itinerary: string[];
};

export const HIDDEN_GEMS: Destination[] = [
  {
    name: 'St. George',
    country: 'Utah, USA',
    tag: 'Hidden gem · Red rock',
    blurb: 'Zion without the crowds or the prices — red-rock canyons, desert trails and small-town stays.',
    trend: 'Our fastest-growing US hidden gem.',
    priceFrom: 'from $89 / night',
    image: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=900&q=70',
    itinerary: ['Day 1 — Snow Canyon: lava tubes and red-rock trails', 'Day 2 — Zion’s quieter east side, then a local brewery', 'Day 3 — Sand Hollow reservoir and a desert sunset'],
  },
  {
    name: 'Tacoma',
    country: 'Washington, USA',
    tag: 'Hidden gem · Mountains + coast',
    blurb: 'A cheaper, calmer gateway to Mount Rainier and Puget Sound — glass art, waterfront and forests.',
    trend: 'Mount Rainier without the Seattle prices.',
    priceFrom: 'from $110 / night',
    image: 'https://images.unsplash.com/photo-1502175353174-a7a70e73b362?auto=format&fit=crop&w=900&q=70',
    itinerary: ['Day 1 — Museum of Glass and the waterfront', 'Day 2 — Mount Rainier day trip, wildflower meadows', 'Day 3 — Point Defiance park and a harbour walk'],
  },
  {
    name: 'Hilo',
    country: 'Hawaii (Big Island), USA',
    tag: 'Hidden gem · Volcanoes',
    blurb: 'Volcanoes, waterfalls and black-sand beaches — the Big Island’s quiet side, far from Waikiki crowds.',
    trend: 'Volcanoes and waterfalls, without the resort crowds.',
    priceFrom: 'from $129 / night',
    image: 'https://images.unsplash.com/photo-1542259009477-d625272157b7?auto=format&fit=crop&w=900&q=70',
    itinerary: ['Day 1 — Volcanoes National Park: lava fields at dusk', 'Day 2 — Akaka Falls and the Hamakua coast', 'Day 3 — Black-sand beach and a farmers’ market'],
  },
];

export const GLOBAL_DESTINATIONS: Destination[] = [
  { name: 'Santorini', country: 'Greece', tag: 'Islands', blurb: 'White villages, blue domes and caldera sunsets.', trend: 'Classic island escape', priceFrom: 'from $140 / night', image: 'https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?auto=format&fit=crop&w=900&q=70', itinerary: ['Day 1 — Oia sunset', 'Day 2 — Caldera cruise', 'Day 3 — Beach and wineries'] },
  { name: 'Kyoto', country: 'Japan', tag: 'Culture', blurb: 'Temples, bamboo groves and tea houses.', trend: 'Most-booked Japan city', priceFrom: 'from $95 / night', image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=900&q=70', itinerary: ['Day 1 — Fushimi Inari at dawn', 'Day 2 — Arashiyama bamboo grove', 'Day 3 — Gion walk and tea ceremony'] },
  { name: 'Bali', country: 'Indonesia', tag: 'Island', blurb: 'Surf, rice terraces and slow island mornings.', trend: 'Surf + food favourite', priceFrom: 'from $45 / night', image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=900&q=70', itinerary: ['Day 1 — Uluwatu surf and sunset', 'Day 2 — Ubud rice terraces', 'Day 3 — Island temples'] },
  { name: 'Caribbean', country: 'Multiple islands', tag: 'Beach', blurb: 'Turquoise water, slow days and island hopping.', trend: 'Winter sun', priceFrom: 'from $120 / night', image: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=900&q=70', itinerary: ['Day 1 — Beach and snorkelling', 'Day 2 — Island boat trip', 'Day 3 — Local markets'] },
  { name: 'Maldives', country: 'Indian Ocean', tag: 'Beach', blurb: 'Overwater calm and reef snorkelling.', trend: 'Honeymoon classic', priceFrom: 'from $220 / night', image: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&w=900&q=70', itinerary: ['Day 1 — Arrival and lagoon swim', 'Day 2 — Reef snorkelling', 'Day 3 — Sandbank picnic'] },
  { name: 'Paris', country: 'France', tag: 'City', blurb: 'Museums, cafés and long riverside walks.', trend: 'City break', priceFrom: 'from $130 / night', image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=70', itinerary: ['Day 1 — Louvre and Seine walk', 'Day 2 — Montmartre', 'Day 3 — Markets and cafés'] },
];

// Per-city photos for the discovery routes' first-stop cities (defect,
// Nov 14 2026: 11 of the 26 Popular destinations had no photo at all —
// the image map only covered the 6 global destinations + 3 hidden
// gems, so routes like Central Europe rendered the grey fallback with
// no <img> ever in the DOM). Wikimedia Commons thumbnails, 960px,
// freely licensed, hotlinkable. Every URL below was verified Nov 14,
// 2026: HTTP 200, image/jpeg, 100–250KB, and the subject viewed —
// Prague Old Town Square, Lisbon Tram 28, Giza pyramids, Colosseum,
// Sagrada Familia spires, Wat Arun, Hagia Sophia, Koutoubia minaret,
// India Gate, Big Ben, Mexico City Zocalo, Lower Manhattan skyline.
// A new route city needs an entry here or its card falls back.
export const CITY_PHOTOS: Record<string, string> = {
  Prague: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/44/Prague_07-2016_View_from_Old_Town_Hall_Tower_img3.jpg/960px-Prague_07-2016_View_from_Old_Town_Hall_Tower_img3.jpg',
  Lisbon: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Le_tram_28.jpg/960px-Le_tram_28.jpg',
  Cairo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/All_Gizah_Pyramids.jpg/960px-All_Gizah_Pyramids.jpg',
  Rome: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/53/Colosseum_in_Rome%2C_Italy_-_April_2007.jpg/960px-Colosseum_in_Rome%2C_Italy_-_April_2007.jpg',
  Barcelona: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Sagrada_Familia_Barcelona_2.jpg/960px-Sagrada_Familia_Barcelona_2.jpg',
  Bangkok: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/Templo_Wat_Arun%2C_Bangkok%2C_Tailandia%2C_2013-08-22%2C_DD_30.jpg/960px-Templo_Wat_Arun%2C_Bangkok%2C_Tailandia%2C_2013-08-22%2C_DD_30.jpg',
  Istanbul: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/22/Hagia_Sophia_Mars_2013.jpg/960px-Hagia_Sophia_Mars_2013.jpg',
  Marrakech: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/10/Koutoubia_minaret_from_the_city.JPG/960px-Koutoubia_minaret_from_the_city.JPG',
  Delhi: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/India_Gate_-_Delhi_%2837282946605%29.jpg/960px-India_Gate_-_Delhi_%2837282946605%29.jpg',
  London: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/Big_Ben_at_sunset_-_2014-10-27_17-30.jpg/960px-Big_Ben_at_sunset_-_2014-10-27_17-30.jpg',
  'Mexico City': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Plaza_de_la_Constituci%C3%B3n_-_Z%C3%B3calo_de_la_Ciudad_de_M%C3%A9xico_-_6.jpg/960px-Plaza_de_la_Constituci%C3%B3n_-_Z%C3%B3calo_de_la_Ciudad_de_M%C3%A9xico_-_6.jpg',
  'New York': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1e/Lower_Manhattan%2C_New_York_skyline_from_Liberty_Island_2021.jpg/960px-Lower_Manhattan%2C_New_York_skyline_from_Liberty_Island_2021.jpg',
  // Audit round Nov 17, 2026 — verified Nov 17 (HTTP 200, image/jpeg):
  // Tokyo Skytree (File:Tokyo_SkyTree.jpg), Vienna Schönbrunn Gloriette
  // (File:Wien.Schönbrunn26.jpg), Hanoi Turtle Tower on Hoàn Kiếm Lake
  // (File:Hanoi - Turtle Tower (Tháp Rùa), Hoàn Kiếm Lake.jpg).
  Tokyo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/45/Tokyo_SkyTree.jpg/960px-Tokyo_SkyTree.jpg',
  Vienna: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Wien.Sch%C3%B6nbrunn26.jpg/960px-Wien.Sch%C3%B6nbrunn26.jpg',
  Hanoi: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4d/Hanoi_-_Turtle_Tower_%28Th%C3%A1p_R%C3%B9a%29%2C_Ho%C3%A0n_Ki%E1%BA%BFm_Lake.jpg/960px-Hanoi_-_Turtle_Tower_%28Th%C3%A1p_R%C3%B9a%29%2C_Ho%C3%A0n_Ki%E1%BA%BFm_Lake.jpg',
  // UX direction round 2 (Nov 21, 2026 — P0-6b): Madrid, Plaza Mayor
  // (File:Plaza Mayor de Madrid - 01.jpg) — verified Nov 21 (HTTP 200,
  // image/jpeg, 960×720, ~184KB). The Spain route's third stop, so the
  // Spain card can show Madrid once Barcelona's Sagrada Familia is
  // claimed by the Barcelona voices card.
  Madrid: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Plaza_Mayor_de_Madrid_-_01.jpg/960px-Plaza_Mayor_de_Madrid_-_01.jpg',
  // Rendered-check fix (Nov 25, 2026): Chefchaouen, the blue city
  // (File:Chefchaouen (Blue City).jpg) — verified Nov 25 (HTTP 200,
  // image/jpeg, 960×540, ~158KB, subject viewed: blue-painted
  // street, no watermark, no brand signage). Morocco's lead photo:
  // the Marrakech Koutoubia photo carries a large BMCI bank sign in
  // its center, which reads as advertising on a trip card.
  Chefchaouen: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Chefchaouen_%28Blue_City%29.jpg/960px-Chefchaouen_%28Blue_City%29.jpg',
};

// A second photo for a city whose first photo is claimed by another
// card (UX direction round 2, Nov 21 2026 — P0-6b): the Tokyo voices
// card showed a blank grey tile because the Japan package claims the
// Skytree — Tokyo's only photo — first. Shibuya Scramble Crossing
// (File:Tokyo Shibuya Scramble Crossing 2018-10-09.jpg), verified
// Nov 21 (HTTP 200, image/jpeg, 960×640, ~203KB), gives the voices
// card its own Tokyo photo instead of the fallback. One photo per
// destination still holds: the two Tokyo photos are different URLs
// on different cards.
export const ALT_CITY_PHOTOS: Record<string, string> = {
  Tokyo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c5/Tokyo_Shibuya_Scramble_Crossing_2018-10-09.jpg/960px-Tokyo_Shibuya_Scramble_Crossing_2018-10-09.jpg',
};

// Audit round Nov 17, 2026: routes that share a first stop with
// another route — or with a standalone city card — get a different
// lead photo from a later stop, so no two cards on the homepage lead
// with the same photo. Europe shows Paris, not Lisbon (Portugal
// keeps the tram); Central Europe shows Vienna, not Prague (the
// Prague photo stays with the Local Voice); Japan shows Tokyo, not
// Kyoto (Kyoto keeps its own card); Southeast Asia shows Hanoi, not
// Bangkok (Thailand keeps Bangkok).
export const ROUTE_PHOTO_CITY: Record<string, string> = {
  Europe: 'Paris',
  'Central Europe': 'Vienna',
  Japan: 'Tokyo',
  'Southeast Asia': 'Hanoi',
  // Rendered-check fix (Nov 25, 2026): Morocco shows Chefchaouen,
  // not Marrakech — see the Chefchaouen note in CITY_PHOTOS above.
  Morocco: 'Chefchaouen',
};

// The lead photo for a trip (audit round, Nov 17, 2026): the
// route override first, then the first stop that has a photo (a
// route whose first stop has none — Japan's first stop is Tokyo,
// which had no photo until this round — used to fall back to a
// blank tile), then the destination's own photo. One rule for the
// packages shelf, the destination cards and the search results, so
// a package and its destination card never disagree.
export function leadPhotoFor(destination: string, stopCities: string[]): string | null {
  const byName = new Map<string, string>([
    ...GLOBAL_DESTINATIONS.map((d) => [d.name, d.image] as const),
    ...HIDDEN_GEMS.map((d) => [d.name, d.image] as const),
    ...Object.entries(CITY_PHOTOS),
  ]);
  const overrideCity = ROUTE_PHOTO_CITY[destination];
  if (overrideCity) {
    const p = byName.get(overrideCity);
    if (p) return p;
  }
  for (const c of stopCities) {
    const p = byName.get(c);
    if (p) return p;
  }
  return byName.get(destination) ?? null;
}

// One-photo-per-destination (UX direction, Nov 19 2026 — P2-4):
// assignPhotos hands each homepage card the photos it may show,
// first-claimant-wins in the order the cards are passed in, so no
// photo URL appears on two cards of the same page. The candidates
// for a card are its lead photo, its own photo (hidden gems carry
// theirs outside the city pool) and its stop photos, in that order
// — all from the already-verified pool (CITY_PHOTOS /
// GLOBAL_DESTINATIONS / HIDDEN_GEMS), never an invented URL and
// never a borrowed one. A card whose candidates are all claimed
// gets an empty list and renders the labeled fallback tile, not a
// borrowed photo. Claim order is the caller's priority: featured
// packages first (the Trip-of-the-week hero must be photo-led),
// then hidden gems, then Local Voices, then Popular destinations —
// the biggest band absorbs the fallbacks. Pure function: same
// input, same assignment.
export type PhotoCardInput = {
  key: string;
  destination: string;
  stopCities?: string[];
  ownPhoto?: string | null;
};

export function assignPhotos(cards: PhotoCardInput[]): Map<string, string[]> {
  const claimed = new Set<string>();
  const out = new Map<string, string[]>();
  for (const card of cards) {
    const stopCities = card.stopCities ?? [];
    // The second photo for a city (ALT_CITY_PHOTOS) is a candidate
    // after the lead photo and the stop photos — a card whose first
    // photo was claimed elsewhere gets its own second photo instead
    // of the fallback tile.
    const candidates = [...new Set(
      [
        leadPhotoFor(card.destination, stopCities),
        card.ownPhoto ?? null,
        ...stopCities.map((c) => CITY_PHOTOS[c] ?? null),
        ALT_CITY_PHOTOS[card.destination] ?? null,
      ].filter((x): x is string => Boolean(x)),
    )];
    const photos = candidates.filter((p) => !claimed.has(p));
    for (const p of photos) claimed.add(p);
    out.set(card.key, photos);
  }
  return out;
}

// Weekend-trip photos (review round, Nov 17 2026 — gap 7): the trips
// are generic local activities, not places, so each photo illustrates
// the activity from the existing verified pool — it is not a photo of
// the place itself. The New York trips use the real New York skyline.
const weekendPhoto = (name: string): string =>
  GLOBAL_DESTINATIONS.find((d) => d.name === name)?.image ?? '';

export const LOCAL_TRIPS: Record<string, { name: string; distance: string; price: string; activity: string; image: string }[]> = {
  default: [
    { name: 'Riverside walk + local market', distance: 'Near you', price: 'from $12', activity: 'A slow morning, local food and a park picnic', image: weekendPhoto('Paris') },
    { name: 'Nearby nature trail', distance: 'Under an hour away', price: 'from $0', activity: 'Hiking, viewpoints and a sunset spot', image: weekendPhoto('Bali') },
    { name: 'Old town food crawl', distance: 'In town', price: 'from $25', activity: 'Family-run cafés and street food', image: weekendPhoto('Kyoto') },
  ],
  'New York': [
    { name: 'Hudson Valley day trip', distance: '1.5 hrs away', price: 'from $35', activity: 'Farms, hikes and a small-town main street', image: CITY_PHOTOS['New York'] },
    { name: 'Coney Island + boardwalk', distance: 'In the city', price: 'from $15', activity: 'Beach, rides and local eats', image: CITY_PHOTOS['New York'] },
    { name: 'Central Park picnic', distance: 'In the city', price: 'from $10', activity: 'Boats, lawns and a free museum hour', image: CITY_PHOTOS['New York'] },
  ],
  'Los Angeles': [
    { name: 'Malibu coast drive', distance: '45 min away', price: 'from $20', activity: 'Beaches, viewpoints and seafood shacks', image: weekendPhoto('Caribbean') },
    { name: 'Griffith Park hike', distance: 'In the city', price: 'from $0', activity: 'City views and the observatory', image: weekendPhoto('Bali') },
    { name: 'Pasadena food walk', distance: '30 min away', price: 'from $28', activity: 'Cafés, bookshops and old-town streets', image: weekendPhoto('Kyoto') },
  ],
};

export const TABS = ['Fujin AI', 'Flights', 'Hotels', 'Cruises', 'Car rental', 'Buses', 'Taxis & transfers', 'Sightseeing'] as const;
export type Tab = (typeof TABS)[number];
