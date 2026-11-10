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
    trend: '+125% accommodation searches, summer 2026 — the fastest-growing US destination on Expedia’s list.',
    priceFrom: 'from $89 / night',
    image: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=900&q=70',
    itinerary: ['Day 1 — Snow Canyon: lava tubes and red-rock trails', 'Day 2 — Zion’s quieter east side, then a local brewery', 'Day 3 — Sand Hollow reservoir and a desert sunset'],
  },
  {
    name: 'Tacoma',
    country: 'Washington, USA',
    tag: 'Hidden gem · Mountains + coast',
    blurb: 'A cheaper, calmer gateway to Mount Rainier and Puget Sound — glass art, waterfront and forests.',
    trend: '+120% accommodation searches, summer 2026 — outshining Seattle.',
    priceFrom: 'from $110 / night',
    image: 'https://images.unsplash.com/photo-1502175353174-a7a70e73b362?auto=format&fit=crop&w=900&q=70',
    itinerary: ['Day 1 — Museum of Glass and the waterfront', 'Day 2 — Mount Rainier day trip, wildflower meadows', 'Day 3 — Point Defiance park and a harbour walk'],
  },
  {
    name: 'Hilo',
    country: 'Hawaii (Big Island), USA',
    tag: 'Hidden gem · Volcanoes',
    blurb: 'Volcanoes, waterfalls and black-sand beaches — the Big Island’s quiet side, far from Waikiki crowds.',
    trend: 'Fastest-trending US destination for spring break 2026 (Google Flights).',
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

export const LOCAL_TRIPS: Record<string, { name: string; distance: string; price: string; activity: string }[]> = {
  default: [
    { name: 'Riverside walk + local market', distance: 'Near you', price: 'from $12', activity: 'A slow morning, local food and a park picnic' },
    { name: 'Nearby nature trail', distance: 'Under an hour away', price: 'from $0', activity: 'Hiking, viewpoints and a sunset spot' },
    { name: 'Old town food crawl', distance: 'In town', price: 'from $25', activity: 'Family-run cafés and street food' },
  ],
  'New York': [
    { name: 'Hudson Valley day trip', distance: '1.5 hrs away', price: 'from $35', activity: 'Farms, hikes and a small-town main street' },
    { name: 'Coney Island + boardwalk', distance: 'In the city', price: 'from $15', activity: 'Beach, rides and local eats' },
    { name: 'Central Park picnic', distance: 'In the city', price: 'from $10', activity: 'Boats, lawns and a free museum hour' },
  ],
  'Los Angeles': [
    { name: 'Malibu coast drive', distance: '45 min away', price: 'from $20', activity: 'Beaches, viewpoints and seafood shacks' },
    { name: 'Griffith Park hike', distance: 'In the city', price: 'from $0', activity: 'City views and the observatory' },
    { name: 'Pasadena food walk', distance: '30 min away', price: 'from $28', activity: 'Cafés, bookshops and old-town streets' },
  ],
};

export const TABS = ['Fujin AI', 'Flights', 'Hotels', 'Cruises', 'Car rental', 'Buses', 'Taxis & transfers', 'Sightseeing'] as const;
export type Tab = (typeof TABS)[number];
