// Trip card data + builder (Layla-style, Nov 11, 2026): the plan view with
// a map, per-city legs, flights, stays, day-by-day and the price
// comparison. Everything here is derived from the planner's
// buildPlan()/comparisonFor() numbers and the route stops — no prices,
// hotel names, ratings or review counts are invented. Stays are shown as
// planning estimates ("hostel / guesthouse estimate"), never as a named
// hotel with a fake price: real named stays arrive with a hotel supplier
// (Expedia / Duffel Stays, Phase 3). The same honesty rule covers the
// flights: the card shows the planner's estimated fare split, labeled as
// an estimate, until Duffel live fares connect.

import { allInFlightLine, buildPlan, comparisonFor, distributeNights, distributeNightsForStops, familyPaceLine, fareClassForTier, fareClassLine, MONTH_NAMES, ROUTE_STOPS, routeKeyForDestination, stopsForRoute, type Party, type RouteOverride } from './planner';

type CityDay = { t: string; n: number };
type CityInfo = {
  country: string;
  lat: number;
  lng: number;
  jan: number; // typical January daytime high, °F
  jul: number; // typical July daytime high, °F
  intro: string;
  days: CityDay[];
};

// Coordinates, typical temperatures and real day titles per city. Day
// titles name real sights (the same places the route prose names), never
// generic filler — the card's day-by-day should read like someone who
// knows the place. Experience counts are the plan's own shape (3-7 a day,
// like a real itinerary), not scraped data.
export const CITY_INFO: Record<string, CityInfo> = {
  Lisbon: { country: 'Portugal', lat: 38.72, lng: -9.14, jan: 59, jul: 82, intro: 'Tram 28, Alfama lanes, and pastéis de nata for breakfast.', days: [{ t: 'Alfama and Tram 28', n: 4 }, { t: 'Belém and the Riverfront', n: 5 }, { t: 'Bairro Alto and the Viewpoints', n: 4 }] },
  Madrid: { country: 'Spain', lat: 40.42, lng: -3.7, jan: 52, jul: 91, intro: 'The Prado, Retiro Park, and tapas bars that stay open late.', days: [{ t: 'Old Madrid and the Prado', n: 5 }, { t: 'Retiro Park and the Markets', n: 4 }, { t: 'Gran Vía and the Tapas Bars', n: 5 }] },
  Barcelona: { country: 'Spain', lat: 41.39, lng: 2.17, jan: 59, jul: 86, intro: 'Gaudí, the Gothic Quarter, and the best tapas crawl in Spain.', days: [{ t: 'Gothic Quarter and Tapas', n: 5 }, { t: 'Sagrada Família and Gaudí', n: 4 }, { t: 'Park Güell and Gràcia', n: 4 }] },
  Paris: { country: 'France', lat: 48.86, lng: 2.35, jan: 45, jul: 77, intro: 'The Seine, Montmartre, and morning markets in the Marais.', days: [{ t: 'The Seine and Île de la Cité', n: 5 }, { t: 'Montmartre and the Marais', n: 6 }, { t: 'Museums and the Left Bank', n: 5 }] },
  Rome: { country: 'Italy', lat: 41.9, lng: 12.5, jan: 55, jul: 88, intro: 'The Colosseum, Trastevere trattorias, and espresso standing up.', days: [{ t: 'Colosseum and the Forum', n: 5 }, { t: 'Vatican and Trastevere', n: 5 }, { t: 'Piazzas and Trattorias', n: 4 }] },
  Athens: { country: 'Greece', lat: 37.98, lng: 23.73, jan: 57, jul: 91, intro: 'The Acropolis, Plaka tavernas, and the sea an hour away.', days: [{ t: 'Acropolis and the Plaka', n: 5 }, { t: 'Museums and the Markets', n: 4 }, { t: 'Day Trip to the Coast', n: 3 }] },
  Prague: { country: 'Czech Republic', lat: 50.08, lng: 14.44, jan: 37, jul: 79, intro: 'A fairytale old town, castle views, and the cheapest beer in Europe.', days: [{ t: 'Old Town and Lesser Quarter', n: 5 }, { t: 'Prague Castle and Panoramic Views', n: 5 }, { t: 'Monastery Views and Vyšehrad Fortress', n: 4 }] },
  Vienna: { country: 'Austria', lat: 48.21, lng: 16.37, jan: 37, jul: 80, intro: 'Palaces, coffee houses, and classical music every night.', days: [{ t: 'Imperial History and Art', n: 6 }, { t: 'Palaces, Museums and Classical Music', n: 5 }, { t: 'Naschmarkt and the Coffee Houses', n: 4 }] },
  Budapest: { country: 'Hungary', lat: 47.5, lng: 19.04, jan: 37, jul: 82, intro: 'Thermal baths, ruin bars, and the Danube at night.', days: [{ t: 'Pest Markets and Jewish History', n: 5 }, { t: 'Buda Castle and Historic District', n: 4 }, { t: 'Parliament and Danube River Cruise', n: 5 }, { t: 'City Park and Thermal Bath Relaxation', n: 7 }, { t: 'Ruin Bar Culture', n: 4 }] },
  Porto: { country: 'Portugal', lat: 41.16, lng: -8.63, jan: 57, jul: 79, intro: 'Port cellars, the riverside, and the Douro valley a train away.', days: [{ t: 'Riverside and the Port Cellars', n: 5 }, { t: 'Old Town and the Bridges', n: 4 }, { t: 'Douro Valley Day Trip', n: 3 }] },
  Sintra: { country: 'Portugal', lat: 38.8, lng: -9.38, jan: 57, jul: 77, intro: 'Fairytale palaces in the hills above the coast.', days: [{ t: 'Fairytale Palaces', n: 4 }, { t: 'Pena Palace and the Moorish Castle', n: 5 }, { t: 'Cabo da Roca and the Coast', n: 3 }] },
  Cairo: { country: 'Egypt', lat: 30.04, lng: 31.24, jan: 66, jul: 95, intro: 'The Pyramids, the museum, and the chaos of Khan el-Khalili.', days: [{ t: 'Pyramids of Giza', n: 4 }, { t: 'Egyptian Museum and Old Cairo', n: 5 }, { t: 'Khan el-Khalili and the Citadel', n: 4 }] },
  Luxor: { country: 'Egypt', lat: 25.69, lng: 32.64, jan: 73, jul: 106, intro: 'The Valley of the Kings and the temples of Karnak.', days: [{ t: 'Valley of the Kings', n: 5 }, { t: 'Karnak and Luxor Temples', n: 4 }, { t: 'West Bank Tombs', n: 4 }] },
  Aswan: { country: 'Egypt', lat: 24.09, lng: 32.9, jan: 73, jul: 106, intro: 'Philae Temple and a felucca ride on the Nile.', days: [{ t: 'Philae Temple and the Nile', n: 4 }, { t: 'Felucca Ride and the Nubian Village', n: 3 }, { t: 'Abu Simbel Day Trip', n: 3 }] },
  'Sharm El Sheikh': { country: 'Egypt', lat: 27.92, lng: 34.33, jan: 72, jul: 95, intro: 'Red Sea snorkeling and desert nights.', days: [{ t: 'Red Sea Snorkeling', n: 4 }, { t: 'Ras Mohammed National Park', n: 3 }, { t: 'Bedouin Dinner in the Desert', n: 3 }] },
  Tokyo: { country: 'Japan', lat: 35.68, lng: 139.69, jan: 50, jul: 86, intro: 'Shibuya, Tsukiji outer market, and neon at night.', days: [{ t: 'Shibuya and Harajuku', n: 6 }, { t: 'Asakusa and the Tsukiji Market', n: 5 }, { t: 'Shinjuku and the Gardens', n: 4 }] },
  Kyoto: { country: 'Japan', lat: 35.01, lng: 135.77, jan: 50, jul: 88, intro: 'Temples, bamboo groves, and the best food mornings in Japan.', days: [{ t: 'Fushimi Inari and the Eastern Hills', n: 5 }, { t: 'Arashiyama Bamboo Grove', n: 4 }, { t: 'Nishiki Market and Gion', n: 5 }] },
  Osaka: { country: 'Japan', lat: 34.69, lng: 135.5, jan: 50, jul: 90, intro: 'Dotonbori street food and the castle.', days: [{ t: 'Dotonbori Street Food', n: 5 }, { t: 'Osaka Castle and the Parks', n: 4 }, { t: 'Day Trip to Nara', n: 4 }] },
  Florence: { country: 'Italy', lat: 43.77, lng: 11.26, jan: 52, jul: 88, intro: 'The Duomo, the Uffizi, and sunset over the river.', days: [{ t: 'The Duomo and the Uffizi', n: 5 }, { t: 'Oltrarno Artisans and Piazzale Michelangelo', n: 4 }, { t: 'Tuscan Day Trip', n: 3 }] },
  Venice: { country: 'Italy', lat: 45.44, lng: 12.32, jan: 45, jul: 84, intro: 'Canals, cicchetti bars, and getting happily lost.', days: [{ t: "St. Mark's and the Canals", n: 5 }, { t: 'Dorsoduro and the Cicchetti Bars', n: 4 }, { t: 'Murano and Burano Islands', n: 4 }] },
  'Loire Valley': { country: 'France', lat: 47.39, lng: 0.69, jan: 46, jul: 79, intro: 'Châteaux, gardens, and wine tasting in the valley.', days: [{ t: 'Château de Chambord', n: 4 }, { t: 'Chenonceau and the Gardens', n: 4 }, { t: 'Wine Tasting in the Valley', n: 3 }] },
  Nice: { country: 'France', lat: 43.7, lng: 7.27, jan: 55, jul: 82, intro: 'The Promenade, old Nice, and the coast by train.', days: [{ t: 'The Promenade and Old Nice', n: 4 }, { t: 'Cimiez and the Markets', n: 4 }, { t: 'Day Trip to Èze and Monaco', n: 4 }] },
  Seville: { country: 'Spain', lat: 37.39, lng: -5.98, jan: 61, jul: 97, intro: 'The Alcázar, flamenco, and orange trees everywhere.', days: [{ t: 'The Alcázar and the Cathedral', n: 5 }, { t: 'Triana and Flamenco', n: 4 }, { t: 'Plaza de España and the Parks', n: 4 }] },
  Santorini: { country: 'Greece', lat: 36.39, lng: 25.46, jan: 57, jul: 86, intro: 'Oia sunsets and the caldera.', days: [{ t: 'Oia Sunset and the Caldera', n: 4 }, { t: 'Akrotiri and the Beaches', n: 4 }, { t: 'Wine Tasting in the Villages', n: 3 }] },
  Crete: { country: 'Greece', lat: 35.34, lng: 25.14, jan: 59, jul: 86, intro: 'Knossos, Chania harbour, and the gorges.', days: [{ t: 'Knossos Palace', n: 4 }, { t: 'Chania Old Town and the Harbour', n: 4 }, { t: 'Samaria Gorge or the Beaches', n: 3 }] },
  Bangkok: { country: 'Thailand', lat: 13.76, lng: 100.5, jan: 90, jul: 92, intro: 'Grand Palace, floating markets, and street food at every corner.', days: [{ t: 'Grand Palace and the Temples', n: 5 }, { t: 'Floating Markets and Street Food', n: 5 }, { t: 'Chinatown and the River', n: 4 }] },
  // Southeast Asia route (Nov 11): Siem Reap and Hanoi had no card data,
  // so the warm-winter route could not render a trip card or a map.
  'Siem Reap': { country: 'Cambodia', lat: 13.37, lng: 103.87, jan: 88, jul: 91, intro: 'Angkor Wat at sunrise, and a town built around it.', days: [{ t: 'Angkor Wat Sunrise', n: 6 }, { t: 'Angkor Thom and the Bayon', n: 5 }, { t: 'Tonlé Sap Floating Village', n: 4 }] },
  Hanoi: { country: 'Vietnam', lat: 21.03, lng: 105.85, jan: 66, jul: 91, intro: 'A thousand-year-old capital of pho, coffee, and the Old Quarter.', days: [{ t: 'Old Quarter and Hoan Kiem Lake', n: 6 }, { t: 'Street Food and Pho Crawl', n: 5 }, { t: 'Halong Bay Day Trip', n: 5 }] },
  'Chiang Mai': { country: 'Thailand', lat: 18.79, lng: 98.99, jan: 87, jul: 91, intro: 'Temples, the night bazaar, and the mountains.', days: [{ t: 'Temples and the Old City', n: 5 }, { t: 'Night Bazaar and Food Stalls', n: 4 }, { t: 'Elephant Sanctuary Day', n: 3 }] },
  Krabi: { country: 'Thailand', lat: 8.09, lng: 98.91, jan: 90, jul: 90, intro: 'Long-tail boats, cliffs, and island days.', days: [{ t: 'Island Hopping by Long-tail Boat', n: 4 }, { t: 'Railay Beach and the Cliffs', n: 4 }, { t: 'Tiger Cave Temple', n: 3 }] },
  Istanbul: { country: 'Turkey', lat: 41.01, lng: 28.98, jan: 48, jul: 83, intro: 'Hagia Sophia, the Grand Bazaar, and the Bosphorus.', days: [{ t: 'Hagia Sophia and the Blue Mosque', n: 5 }, { t: 'Grand Bazaar and the Spice Market', n: 5 }, { t: 'Bosphorus Cruise and Kadıköy', n: 4 }] },
  Cappadocia: { country: 'Turkey', lat: 38.64, lng: 34.83, jan: 37, jul: 84, intro: 'Balloons at sunrise and cave hotels.', days: [{ t: 'Hot-Air Balloon at Sunrise', n: 3 }, { t: 'Göreme Open-Air Museum', n: 4 }, { t: 'Underground Cities', n: 4 }] },
  Antalya: { country: 'Turkey', lat: 36.9, lng: 30.71, jan: 59, jul: 93, intro: 'The old town harbour and the Turquoise Coast.', days: [{ t: 'Old Town (Kaleiçi) and the Harbour', n: 4 }, { t: 'Düden Waterfalls', n: 3 }, { t: 'Turquoise Coast Boat Day', n: 3 }] },
  Marrakech: { country: 'Morocco', lat: 31.63, lng: -7.98, jan: 66, jul: 98, intro: 'Jemaa el-Fnaa, the souks, and Atlas day trips.', days: [{ t: 'Jemaa el-Fnaa and the Souks', n: 6 }, { t: 'Jardin Majorelle and the Palaces', n: 4 }, { t: 'Atlas Mountains Day Trip', n: 3 }] },
  Fes: { country: 'Morocco', lat: 34.03, lng: -4.98, jan: 61, jul: 96, intro: 'The medina, the tanneries, and the old madrasas.', days: [{ t: 'The Medina and the Tanneries', n: 5 }, { t: 'Madrasas and the Gates', n: 4 }, { t: 'Pottery and the Hills', n: 3 }] },
  Chefchaouen: { country: 'Morocco', lat: 35.17, lng: -5.27, jan: 59, jul: 90, intro: 'The blue city in the Rif mountains.', days: [{ t: 'The Blue Streets', n: 4 }, { t: 'The Kasbah and the Viewpoints', n: 3 }, { t: 'Akchour Waterfalls', n: 3 }] },
  Delhi: { country: 'India', lat: 28.61, lng: 77.21, jan: 70, jul: 95, intro: 'Old Delhi food walks and the Red Fort.', days: [{ t: 'Old Delhi Food Walk', n: 5 }, { t: 'Red Fort and the Mosques', n: 4 }, { t: 'New Delhi and the Gardens', n: 4 }] },
  Agra: { country: 'India', lat: 27.18, lng: 78.01, jan: 72, jul: 97, intro: 'The Taj Mahal at sunrise.', days: [{ t: 'Taj Mahal at Sunrise', n: 3 }, { t: 'Agra Fort and the Markets', n: 4 }, { t: 'Fatehpur Sikri Day Trip', n: 3 }] },
  Jaipur: { country: 'India', lat: 26.91, lng: 75.79, jan: 72, jul: 95, intro: 'The Pink City and Amber Fort.', days: [{ t: 'The Pink City and Amber Fort', n: 5 }, { t: 'Palaces and the Bazaars', n: 4 }, { t: 'Jal Mahal and the Stepwells', n: 3 }] },
  London: { country: 'United Kingdom', lat: 51.51, lng: -0.13, jan: 47, jul: 73, intro: 'The Tower, Borough Market, and the West End.', days: [{ t: 'The Tower and Borough Market', n: 6 }, { t: 'Museums and the West End', n: 5 }, { t: 'Parks and the Riverside', n: 4 }] },
  Bath: { country: 'United Kingdom', lat: 51.38, lng: -2.36, jan: 46, jul: 72, intro: 'Roman Baths and Georgian streets.', days: [{ t: 'Roman Baths and the Abbey', n: 4 }, { t: 'Georgian Streets and the Crescent', n: 3 }, { t: 'The Jane Austen Centre', n: 3 }] },
  Edinburgh: { country: 'United Kingdom', lat: 55.95, lng: -3.19, jan: 45, jul: 66, intro: 'The Castle, the Royal Mile, and Arthur’s Seat.', days: [{ t: 'The Castle and the Royal Mile', n: 5 }, { t: "Arthur's Seat and the Views", n: 4 }, { t: 'Leith and the Waterfront', n: 3 }] },
  'Mexico City': { country: 'Mexico', lat: 19.43, lng: -99.13, jan: 71, jul: 73, intro: 'The Zócalo, Frida Kahlo, and street tacos.', days: [{ t: 'Zócalo and the Historic Centre', n: 5 }, { t: 'Frida Kahlo Museum and Coyoacán', n: 4 }, { t: 'Street Tacos and the Markets', n: 5 }] },
  Oaxaca: { country: 'Mexico', lat: 17.07, lng: -96.73, jan: 78, jul: 82, intro: 'Markets, mezcal, and Monte Albán.', days: [{ t: 'Markets and Mezcal', n: 5 }, { t: 'Monte Albán Ruins', n: 3 }, { t: 'Hierve el Agua', n: 3 }] },
  Tulum: { country: 'Mexico', lat: 20.21, lng: -87.43, jan: 82, jul: 90, intro: 'Mayan ruins, cenotes, and the beach.', days: [{ t: 'Mayan Ruins and the Beach', n: 4 }, { t: 'Cenotes', n: 3 }, { t: "Sian Ka'an Biosphere", n: 3 }] },
  'New York': { country: 'USA', lat: 40.71, lng: -74.01, jan: 39, jul: 85, intro: 'Central Park, the museums, and food from every corner.', days: [{ t: 'Central Park and the Museums', n: 5 }, { t: 'Downtown and the Neighbourhoods', n: 5 }, { t: 'Food from Every Corner', n: 4 }] },
  'San Francisco': { country: 'USA', lat: 37.77, lng: -122.42, jan: 57, jul: 68, intro: 'The Bay, cable cars, and Chinatown.', days: [{ t: 'The Bay and the Cable Cars', n: 4 }, { t: 'Chinatown and North Beach', n: 4 }, { t: 'Golden Gate Park', n: 3 }] },
  'Los Angeles': { country: 'USA', lat: 34.05, lng: -118.24, jan: 68, jul: 84, intro: 'Beaches, studios, and food trucks.', days: [{ t: 'Beaches and the Piers', n: 4 }, { t: 'Studios and Hollywood', n: 4 }, { t: 'Food Trucks and the Markets', n: 4 }] },
  Bali: { country: 'Indonesia', lat: -8.34, lng: 115.09, jan: 89, jul: 86, intro: 'Ubud, warungs, and the best local food anywhere.', days: [{ t: 'Ubud Rice Terraces and Temples', n: 5 }, { t: 'Seminyak Beaches and Sunset', n: 4 }, { t: 'Warungs and Night Markets', n: 4 }] },
  'St. George': { country: 'USA', lat: 37.1, lng: -113.58, jan: 54, jul: 100, intro: 'Zion National Park and red-rock trails.', days: [{ t: 'Zion National Park', n: 5 }, { t: 'Red Cliffs and the Trails', n: 4 }, { t: 'Downtown and the Farmers Market', n: 3 }] },
  Tacoma: { country: 'USA', lat: 47.25, lng: -122.44, jan: 47, jul: 77, intro: 'Point Defiance and the Museum of Glass.', days: [{ t: 'Point Defiance and the Waterfront', n: 4 }, { t: 'Museum of Glass', n: 3 }, { t: 'Mount Rainier Day Trip', n: 3 }] },
  Hilo: { country: 'USA', lat: 19.72, lng: -155.08, jan: 80, jul: 85, intro: 'Volcanoes, waterfalls, and the farmers market.', days: [{ t: 'Volcanoes National Park', n: 5 }, { t: 'Waterfalls and the Bayfront', n: 4 }, { t: 'Farmers Market and the Gardens', n: 3 }] },
};

// Transport mode between stops, per route. Trains where the route prose
// says so; domestic flights where the distances demand it.
const LEG_MODE: Record<string, string> = {
  europe: '🚆 Train',
  centraleurope: '🚆 Train',
  portugal: '🚆 Train',
  egypt: '🚆 Sleeper train',
  japan: '🚆 Bullet train',
  italy: '🚆 High-speed train',
  france: '🚆 TGV',
  spain: '🚆 AVE train',
  greece: '⛴️ Ferry',
  thailand: '🚆 Sleeper train',
  southeastasia: '✈️ Domestic flight',
  turkey: '✈️ Domestic flight',
  morocco: '🚆 Train',
  india: '🚆 Train',
  uk: '🚆 Train',
  mexico: '✈️ Domestic flight',
  usa: '✈️ Domestic flight',
};

// City center coordinates from the trip card's data — shared with the
// food module so walk times are measured from the same center as the
// map pins. 'NYC' is the planner's alias for New York.
export function cityCoords(name: string): { lat: number; lng: number } | null {
  const info = CITY_INFO[name === 'NYC' ? 'New York' : name];
  return info ? { lat: info.lat, lng: info.lng } : null;
}

// Typical daytime high for a city in a month, by interpolating January
// and July. A seasonal average for planning, never a forecast — the card
// labels it as typical.
export function typicalTemp(city: string, month: number): number {
  const info = CITY_INFO[city];
  if (!info || !month) return 0;
  if (month <= 7) return Math.round(info.jan + ((info.jul - info.jan) * (month - 1)) / 6);
  return Math.round(info.jul - ((info.jul - info.jan) * (month - 7)) / 6);
}

// First Monday of the next occurrence of a month. The trip card needs
// concrete dates to show day-by-day; when the traveler gave only a month,
// the first Monday of that month is the suggested start, labeled as
// suggested. If the month is this year's and its first Monday is past,
// next year is used.
export function suggestedStart(month: number, today = new Date()): Date {
  const m = month >= 1 && month <= 12 ? month - 1 : (today.getMonth() + 1) % 12;
  const year = month >= 1 && month <= 12 && m < today.getMonth() ? today.getFullYear() + 1 : today.getFullYear();
  const first = new Date(year, m, 1);
  const add = (8 - first.getDay()) % 7; // days until the first Monday
  return new Date(year, m, 1 + add);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export type TripCardDay = { day: number; date: Date; title: string; experiences: number; weatherF: number };
export type TripCardStop = {
  city: string;
  country: string;
  nights: number;
  startDate: Date;
  endDate: Date;
  intro: string;
  stayEstimate: number;
  days: TripCardDay[];
  transportIn: { mode: string; from: string; price: number };
  // Start Anywhere (round 2 #6): the sentence from the traveler's own
  // link or pasted text that named this stop — quoted verbatim, shown
  // under the stop's intro so the trip keeps its source attached.
  sourceTip?: string;
};
export type TripLeg = {
  id: string;
  kind: 'flight' | 'transport' | 'stay' | 'car';
  icon: string;
  label: string;
  detail: string;
  more: string;
  price: number;
  city: string;
  lat: number;
  lng: number;
  startDate: Date;
  endDate: Date;
  // All-in price honesty (round 2 #2): the fare-class line on every
  // flight leg, and the cancellation terms on every leg — a leg without
  // its terms is a price the traveler cannot yet trust. Terms are honest
  // about being unconfirmed for planning estimates: nothing is booked
  // until the traveler confirms it.
  fareClass?: string;
  terms?: string;
};
export type TripCard = {
  title: string;
  destination: string;
  routeKey: string;
  days: number;
  nights: number;
  startDate: Date;
  endDate: Date;
  month: number;
  origin: string;
  travelers: number;
  // Family pace (competitor learning, Nov 11: Yopki) — the pace line for
  // the plan view, derived from the kids' ages, never invented venues.
  kids: number[];
  familyNote: string;
  stops: TripCardStop[];
  legs: TripLeg[];
  returnTransport: { mode: string; from: string; price: number };
  experiences: number;
  hotels: number;
  transports: number;
  routeLine: string;
  budgetTip: string;
  budgetSaving: number;
};

// Build the Layla-style trip card. Prices come from buildPlan() (the same
// totals the chat quotes) split across the card's legs: the flight leg is
// split 40% out / 40% back / 20% between cities, the hotel leg is split by
// nights. Every leg price is a planning estimate until live inventory
// connects — the card says so next to the total.
export function buildTripCard(opts: {
  destination: string;
  travelers: number;
  days: number;
  month: number;
  origin: string;
  tier?: number;
  kids?: number[];
  // A revision from the chat ("swap Vienna for Porto"): the ordered
  // stops replace the route's default stops; the nights follow the
  // override's weights, so the card, the map and the summary all show
  // the same revised route.
  routeOverride?: RouteOverride;
  // Start Anywhere (round 2 #6): the source tips per city, from the
  // traveler's own link or pasted text — attached to the matching stop.
  sourceTips?: Record<string, string>;
}): TripCard | null {
  const days = Math.min(30, Math.max(2, opts.days || 3));
  const routeKey = routeKeyForDestination(opts.destination);
  const stops = routeKey ? ROUTE_STOPS[routeKey] : null;
  const startDate = suggestedStart(opts.month);
  const endDate = addDays(startDate, days - 1);
  const plan = buildPlan(opts.destination, opts.travelers, days, { kids: opts.kids ?? [] });
  // The tier the traveler picked (0 Cheapest, 1 Best value, 2 Premium):
  // the map's price tags show that tier's legs, not always Best value.
  const tier = Math.min(2, Math.max(0, opts.tier ?? 1));
  const best = plan.options[tier];
  const cheapest = plan.options[0];
  const totalNights = days - 1;

  // Nights per stop: the route's distribution, or the whole stay for a
  // single-city destination — or the revised route when the traveler
  // changed the trip in the chat.
  const nightPlan = opts.routeOverride?.cities.length
    ? distributeNightsForStops(stopsForRoute(routeKey, opts.routeOverride), days)
    : routeKey
      ? distributeNights(routeKey, days)
      : [{ city: opts.destination, country: CITY_INFO[opts.destination]?.country ?? '', nights: totalNights }];

  // One stop means no between-city legs, so the flight splits 50/50
  // out/back — the 40/40/20 split would strand 20% of the fare with
  // nowhere to go (pre-Nov-12 bug: a Kyoto card showed $874 of flights
  // for a $1,092 flight leg). With stops, 40% out / 40% back / 20%
  // between cities; the nudge below absorbs the ±$1 rounding drift.
  const singleStop = nightPlan.length <= 1;
  const legFlightOut = singleStop ? Math.round(best.flight / 2) : Math.round(best.flight * 0.4);
  const legFlightBack = singleStop ? best.flight - legFlightOut : Math.round(best.flight * 0.4);
  const legIntercity =
    nightPlan.length > 1 ? Math.round((best.flight * 0.2) / (nightPlan.length - 1)) : 0;

  let dayCursor = 1;
  let dateCursor = startDate;
  const cardStops: TripCardStop[] = nightPlan.map((s, idx) => {
    const info = CITY_INFO[s.city];
    const stopStart = dateCursor;
    const stopEnd = addDays(dateCursor, s.nights - 1);
    const stopDays: TripCardDay[] = [];
    for (let n = 0; n < s.nights; n++) {
      const dayInfo = info ? info.days[n % info.days.length] : { t: `Explore ${s.city}`, n: 3 };
      stopDays.push({
        day: dayCursor,
        date: dateCursor,
        title: dayInfo.t,
        experiences: dayInfo.n,
        weatherF: info ? typicalTemp(s.city, opts.month) : 0,
      });
      dayCursor += 1;
      dateCursor = addDays(dateCursor, 1);
    }
    const transportIn =
      idx === 0
        ? { mode: '✈️ Flight', from: opts.origin || 'Your city', price: legFlightOut }
        : { mode: LEG_MODE[routeKey] ?? '🚆 Train', from: nightPlan[idx - 1].city, price: legIntercity };
    return {
      city: s.city,
      country: s.country,
      nights: s.nights,
      startDate: stopStart,
      endDate: stopEnd,
      intro: info?.intro ?? '',
      ...(opts.sourceTips?.[s.city] ? { sourceTip: opts.sourceTips[s.city] } : {}),
      stayEstimate: Math.round((best.hotel * s.nights) / totalNights),
      days: stopDays,
      transportIn,
    };
  });

  const legIcon = (LEG_MODE[routeKey] ?? '🚆 Train').split(' ')[0];
  // Stay estimates are rounded per stop, so their sum can drift a dollar
  // from the hotel leg — nudge the longest stay so the map's stays add up
  // exactly to the plan's hotel total (same rule as fixLegs in planner).
  {
    const diff = best.hotel - cardStops.reduce((s, st) => s + st.stayEstimate, 0);
    if (diff !== 0) {
      const longest = cardStops.reduce((a, b) => (b.nights > a.nights ? b : a));
      longest.stayEstimate += diff;
    }
  }

    // Map inventory (split-screen redesign, Nov 11): every bookable leg as
  // a marker with a price tag — flights, stays, car rental. The traveler
  // clicks a tag to read more, then Add to plan. Prices are the chosen
  // tier's legs; stays and cars split by nights like the hotel leg.
  // Coordinates are the city coordinates with small offsets so the
  // stay/car tags never stack on the city pin; flight tags sit midway
  // along the route (or at the arrival city when the origin is unknown).
  const coordsFor = (name: string): { lat: number; lng: number } | null => {
    const info = CITY_INFO[name === 'NYC' ? 'New York' : name];
    return info ? { lat: info.lat, lng: info.lng } : null;
  };
  const mid = (
    a: { lat: number; lng: number } | null,
    b: { lat: number; lng: number } | null,
    fb: { lat: number; lng: number }
  ): { lat: number; lng: number } =>
    a && b ? { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 } : fb;
  const legs: TripLeg[] = [];
  const firstCoords = coordsFor(cardStops[0].city) ?? { lat: 0, lng: 0 };
  const lastCoords = coordsFor(cardStops[cardStops.length - 1].city) ?? firstCoords;
  const originCoords = opts.origin ? coordsFor(opts.origin) : null;
  const legMode = LEG_MODE[routeKey] ?? '🚆 Train';
  const fareClass = fareClassLine(tier);
  const fareClassName = fareClassForTier(tier).name;
  // Cancellation terms (training notes: every leg carries its terms, in
  // one line, with a deadline when there is one). These legs are planning
  // estimates, so the honest line is that the terms are confirmed at
  // booking — never "free cancellation available" without a deadline.
  const legTerms = 'Cancellation terms are confirmed at booking — refundable options are available on request; nothing is booked until you confirm it.';
  const flightAllIn = allInFlightLine(best.flight);
  legs.push({
    id: 'flight-out',
    kind: 'flight',
    icon: '✈️',
    label: `Flight ${opts.origin || 'Your city'} → ${cardStops[0].city}`,
    detail: `${fareClassName} · planning estimate`,
    more: `${fareClass} ${flightAllIn} Live fares arrive with Duffel live mode — until then this is a planning estimate, not a live quote.`,
    fareClass,
    terms: legTerms,
    price: legFlightOut,
    city: cardStops[0].city,
    ...mid(originCoords, firstCoords, firstCoords),
    startDate,
    endDate: startDate,
  });
  for (let i = 1; i < cardStops.length; i++) {
    const from = cardStops[i - 1];
    const to = cardStops[i];
    // Between cities the route flies on domestic flights (Southeast Asia,
    // Turkey, Mexico, USA) — those legs carry the fare class too. Trains
    // and ferries carry only the terms.
    const isFlightLeg = legMode.includes('flight');
    legs.push({
      id: `leg-${i}`,
      kind: 'transport',
      icon: legMode.split(' ')[0],
      label: `${legMode} ${from.city} → ${to.city}`,
      detail: 'Planning estimate',
      more: isFlightLeg
        ? `${fareClass} ${flightAllIn} Travel between cities on the route. Live times and fares arrive with live inventory — until then this is a planning estimate, not a live quote.`
        : 'Travel between cities on the route. Live times and fares arrive with live inventory — until then this is a planning estimate, not a live quote.',
      ...(isFlightLeg ? { fareClass } : {}),
      terms: legTerms,
      price: legIntercity,
      city: to.city,
      ...mid(coordsFor(from.city), coordsFor(to.city), coordsFor(to.city) ?? firstCoords),
      startDate: to.startDate,
      endDate: to.startDate,
    });
  }
  const lastStop = cardStops[cardStops.length - 1];
  legs.push({
    id: 'flight-back',
    kind: 'flight',
    icon: '✈️',
    label: `Flight ${lastStop.city} → ${opts.origin || 'Your city'}`,
    detail: `${fareClassName} · planning estimate`,
    more: `${fareClass} ${flightAllIn} Live fares arrive with Duffel live mode — until then this is a planning estimate, not a live quote.`,
    fareClass,
    terms: legTerms,
    price: legFlightBack,
    city: lastStop.city,
    ...mid(lastCoords, originCoords, lastCoords),
    startDate: endDate,
    endDate,
  });
  for (const st of cardStops) {
    const c = coordsFor(st.city) ?? firstCoords;
    const info = CITY_INFO[st.city];
    legs.push({
      id: `stay-${st.city}`,
      kind: 'stay',
      icon: '🛏️',
      label: `Stay in ${st.city}`,
      detail: `${st.nights} night${st.nights > 1 ? 's' : ''} · hostel / guesthouse estimate`,
      more: `${st.intro} ${info ? `Days here: ${info.days.map((d) => d.t).join(' · ')}.` : ''} The stay is a planning estimate — real named stays with ratings arrive with a hotel supplier (Expedia / Duffel Stays). Nothing is booked until you confirm it.`,
      terms: legTerms,
      price: st.stayEstimate,
      city: st.city,
      lat: c.lat + 0.04,
      lng: c.lng,
      startDate: st.startDate,
      endDate: st.endDate,
    });
    legs.push({
      id: `car-${st.city}`,
      kind: 'car',
      icon: '🚗',
      label: `Car rental in ${st.city}`,
      detail: `${st.nights} day${st.nights > 1 ? 's' : ''} · pickup on arrival`,
      more: `A rental car for your ${st.nights} night${st.nights > 1 ? 's' : ''} in ${st.city}, picked up when you arrive and dropped off when you leave. Planning estimate — live rental cars arrive with a car supplier.`,
      terms: legTerms,
      price: Math.round((best.car * st.nights) / totalNights),
      city: st.city,
      lat: c.lat - 0.04,
      lng: c.lng + 0.04,
      startDate: st.startDate,
      endDate: st.endDate,
    });
  }

  // Car legs and flight legs are rounded per leg, so their sums can drift
  // a dollar from the plan's car / flight totals — nudge the largest leg
  // of each kind so the map's legs add up exactly (same rule as the stays
  // above, and as fixLegs in planner). Exposed Nov 12, 2026 by the
  // per-route bases: Cheapest Central Europe ($1,800 base) split its $90
  // car leg 28 + 21 + 42 = $91, so the legs summed $1 over the plan total.
  for (const kind of ['car', 'flight'] as const) {
    const kindLegs = legs.filter((l) => (kind === 'flight' ? l.kind === 'flight' || l.kind === 'transport' : l.kind === kind));
    const target = kind === 'flight' ? best.flight : best.car;
    const diff = target - kindLegs.reduce((s, l) => s + l.price, 0);
    if (diff !== 0 && kindLegs.length > 0) {
      const biggest = kindLegs.reduce((a, b) => (b.price > a.price ? b : a));
      biggest.price += diff;
    }
  }

  const experiences = cardStops.reduce((s, st) => s + st.days.reduce((a, d) => a + d.experiences, 0), 0);
  const routeLine = [
    opts.origin ? `${opts.origin} ✈️` : '',
    ...cardStops.map((st, i) => `${st.city} (${st.nights} night${st.nights > 1 ? 's' : ''})${i < cardStops.length - 1 ? ` ${legIcon}` : ''}`),
    opts.origin ? `✈️ ${opts.origin}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const saving = best.hotel - cheapest.hotel;
  const routeName = opts.destination;
  const kids = (opts.kids ?? []).filter((a) => a >= 0 && a <= 17).slice(0, 6);
  return {
    title: `${days}-Day ${routeName} ${kids.length ? 'Family' : opts.travelers === 1 ? 'Budget Solo' : 'Budget'} Trip`,
    destination: opts.destination,
    routeKey,
    days,
    nights: totalNights,
    startDate,
    endDate,
    month: opts.month,
    origin: opts.origin,
    travelers: opts.travelers,
    kids,
    familyNote: familyPaceLine(kids),
    stops: cardStops,
    legs,
    returnTransport: {
      mode: '✈️ Flight',
      from: cardStops[cardStops.length - 1].city,
      price: legFlightBack,
    },
    experiences,
    hotels: cardStops.length,
    transports: 2 + Math.max(0, cardStops.length - 1),
    routeLine,
    budgetTip:
      saving > 0
        ? `Swap private rooms for social hostels in ${cardStops.map((s) => s.city).join(' & ')} — the Best value plan books private rooms, and hostels would slash about $${saving.toLocaleString()} off the stay total while making meeting fellow travelers effortless.`
        : 'Book the Cheapest option for hostel dorms and the lowest stay total.',
    budgetSaving: saving,
  };
}

// Price comparison for the trip card: FujinTrip vs booking each leg
// separately (the planner's comparison, single source of truth). A third
// column — other sites' live prices — stays empty until a live fare feed
// is connected; the card says so honestly instead of inventing a
// competitor price.
export function cardComparison(destination: string, travelers: number, party?: Party) {
  return comparisonFor(destination, travelers, party);
}

export { MONTH_NAMES };
