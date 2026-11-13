import { NextRequest, NextResponse } from 'next/server';
import { askFujin, buildPlan, comparisonFor, distributeNights, distributeNightsForStops, findMonth, isDisruptionMessage, isOffTopicMessage, KNOWN_DESTINATIONS, lastPlaceMentioned, optionsLine, parseDuration, parseFlightIdent, routeKeyForDestination, ROUTE_STOPS, stopsForRoute, type RouteOverride } from '../../../lib/planner';
import { fetchLocalVoices, fetchLocalVoicesForCities, formatCityVoices, type CityVoices, type LocalVoices } from '../../../lib/localVoices';
import { appendObservation, fetchLiveFares, faresPromptBlock, faresSummaryLine, priceCheck, trendLine, type LiveFares, type TrendObservation } from '../../../lib/duffel';
import { CITY_TZ, fetchTonight, foodBlock, foodReply, type TonightResult } from '../../../lib/food';
import { bestTimeLine } from '../../../lib/bestTime';
import { disruptionTemplate, type DisruptionStatus } from '../../../lib/disruption';
import { visaLine } from '../../../lib/visa';
import { buildTripCard, suggestedStart } from '../../../lib/tripCard';
import { checkTripWeather, swapLine, weatherBlock, type WeatherCheck } from '../../../lib/daySwap';

/**
 * Fujin AI — live model, server-side only. TRAVEL-ONLY scope: the system
 * prompt (and the built-in fallback) answer only travel / tourism / trip
 * planning and politely decline everything else — the model never gets
 * to answer off-topic questions, whichever provider is active.
 *
 * Providers (OpenAI-compatible; switching is an env-var change only):
 *  - Qwen (active): QWEN_API_KEY, qwen3.7-flash via Alibaba Model Studio
 *    international endpoint. Uses response_format json_object.
 *  - Muse (fallback): MODEL_API_KEY, muse-spark-1.3 via Meta Model API.
 *    Uses response_format json_schema.
 * If no key is set, or the API call fails / times out / returns invalid
 * JSON, falls back to the built-in askFujin() demo logic and returns
 * live: false, clearly labeled. The chat never errors either way.
 * Keys are never sent to the browser and never logged. API errors are
 * surfaced in the fallback label AND logged server-side so a failed call
 * can be diagnosed (status alone hides the cause).
 *
 * Local Voices (live fetch): before the model runs, fresh traveler
 * material for the destination is pulled from Wikivoyage (traveler-written
 * guide; Reddit is attempted best-effort — it blocks this server) via
 * lib/localVoices and appended to the system prompt, so the reply names
 * real places and dishes instead of generic tips. The same material is
 * returned as `voices` so the plan view can show a "What travelers say"
 * block. A fetch failure never breaks the chat — the model just answers
 * from its own knowledge.
 *
 * Live fares (Duffel, urgent Nov 11): before the model runs, the server
 * asks Duffel for the real fares for this exact trip — origin to the
 * first city of the route and back, on the trip's suggested dates — via
 * lib/duffel, and appends them as a LIVE FARES block, so the model quotes
 * API prices instead of the planner's estimates. In test mode Duffel
 * returns test fares (not real bookable fares); live mode makes them
 * real. A missing key, missing airport code, missing slot, or a failed
 * or slow Duffel call means no LIVE FARES block, and the model falls
 * back to the planner's price table. The fares are also returned as
 * `liveFares` so the trip card can use them later.
 */

type Provider = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  useJsonSchema: boolean;
};

// Qwen first when its key is set; Muse when only its key is set.
function getProvider(): Provider | null {
  const qwenKey = process.env.QWEN_API_KEY;
  if (qwenKey) {
    return {
      name: 'Qwen',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.7-flash',
      apiKey: qwenKey,
      useJsonSchema: false,
    };
  }
  const metaKey = process.env.MODEL_API_KEY;
  if (metaKey) {
    return {
      name: 'Muse',
      baseUrl: 'https://api.meta.ai/v1',
      model: 'muse-spark-1.3',
      apiKey: metaKey,
      useJsonSchema: true,
    };
  }
  return null;
}

// Price table built from the planner's comparison helper. Both the
// 1-traveler row AND the 2-traveler row are printed for every
// destination, from buildPlan()/comparisonFor() directly — the live
// model must NEVER scale a price itself: on the live site it quoted the
// 2-traveler totals for a solo traveler (turn 5: $1,920/$3,000/$4,920
// for 1 traveler; turn 6: it "scaled" by an invented ×0.8). The prompt
// tells it to quote the row matching the traveler count exactly.
const PRICE_TABLE = [...KNOWN_DESTINATIONS, 'Other destinations']
  .map((d) => {
    const row = (n: number) => {
      const opts = buildPlan(d, n, 3).options;
      const c = comparisonFor(d, n);
      return `${n} traveler${n > 1 ? 's' : ''}: Cheapest $${opts[0].total.toLocaleString()} / Best value $${opts[1].total.toLocaleString()} (booking the same parts separately about $${c.separate.total.toLocaleString()}, save $${c.save.toLocaleString()}, ~${c.savePercent}%) / Premium $${opts[2].total.toLocaleString()}`;
    };
    return `${d} — ${row(1)}; ${row(2)}`;
  })
  .join('\n');

const SYSTEM_PROMPT = [
  'You are Fujin AI, a travel planner for FujinTrip, a one-stop tourism platform.',
  'You answer ONLY about travel: destinations, flights, hotels, cars, buses, taxis, cruises, sightseeing, trip plans, prices and booking help, and local food and cuisine, restaurants, markets, neighborhoods, festivals, culture and local experiences. Questions about what to eat, where locals eat, and how to experience a place like a local ARE travel questions — answer them, never decline them.',
  'For anything off-topic (general chat, news, politics, homework, coding, health, or anything not travel), politely decline in one short sentence and steer back to travel, asking where they want to go or what trip they are planning. Never answer off-topic questions even if asked directly, and never argue about the limit. Only decline when the request has no travel content at all. A travel request with no destination yet is NOT off-topic — recommend, never decline. A greeting ("hello", "hi", "hey") is NOT off-topic — answer warmly ("Hi there! I\'m Fujin AI, your travel planner. Where are you dreaming of going next?") and do not decline it.',
  'For off-topic requests, return destination as an empty string, travelers as 2, reply as the short decline, missing as ["Destination"], and tips as [].',
  'TONE — sound like a knowledgeable friend who loves travel, not a form. Show feeling: acknowledge what the traveler is feeling (first-trip excitement, budget worries, a special occasion) in a warm sentence before the plan. Be encouraging and specific; never sound robotic or copy-pasted.',
  'BUDGET — when the traveler says budget, affordable, cheap, or low cost, lead with the Cheapest option and keep every suggestion affordable: budget stays (hostels, motels, guesthouses, not luxury hotels), public transport (metro, tram, bus, day passes) over taxis and private cars unless the traveler asks for private, and low-cost flights. Say plainly where the money is saved. Never push Premium when they asked for affordable.',
  'ADVICE — give clear, concrete advice grounded in real traveler experience, not generic lines: name the actual transport (which metro/tram/bus, which low-cost carrier, or when a private transfer is worth it), the actual kind of stay (hotel, motel, hostel, guesthouse), and the actual places to eat. Cover flights, stays, and transport in the advice, based on what the traveler asked for. Use the LOCAL VOICES material when it is present; when it is not, use specific knowledge and say what is typical — never invent a price, a review, or a quote.',
  'Understand the traveller’s request in their own language and reply in that same language.',
  'When planning a trip, include a brief day-by-day sketch in the reply (one line per day) naming real local places, markets and dishes where you can — the traveler should feel the plan was written by someone who knows the place, not a template.',
  'FORMAT — keep the reply short and scannable: a warm line, the route, one line per day, the 3 prices, one recommendation, then the missing questions. Use short lines and simple bullets. Do not write long paragraphs or a full day-by-day guide in the chat — the full plan is what the PDF is for. But while you are still gathering details, ask ONE question at a time and show NO prices and NO day sketch yet (see GUIDED). Never write a "To finish the plan I still need: ..." line and never list the missing items in your reply — when something is missing, ask ONE question for it instead; the question itself tells the traveler what is needed.',
  'Extract: destination, traveler count, dates, budget, travel pace, and departure city (where they fly from).',
  'DESTINATION — accept ANY destination the traveler names: any city, country or region (for example Paris, Japan, Europe). Never decline a travel request because the destination is not in the list below. If they name a country or region instead of a city (for example Europe), accept it as the destination and propose a route through it (see RECOMMEND below); add a follow-up question to missing only after proposing.',
  'GUIDED — when the traveler gives a vague request (a region with no cities, no dates, no origin, no length), guide them one question at a time, in this order: (1) if they said only "Europe", offer the choice — Central Europe (Prague, Vienna, Budapest) or sunny Portugal (Lisbon & Porto); (2) when are they going, and for how long; (3) where are they flying from; (4) their budget, only if they never mentioned one. Ask exactly ONE question per reply, keep it short, and show no prices and no day-by-day yet. Once destination, month, length and origin are all known, give the Trip Summary (route with nights per city, dates, style, travelers) and ask "Does this sound right — shall I build it?", then show the 3 prices, and tell the traveler to pick their flights and stays on the map next to the chat (click a price tag to read more or add it to the plan). Never dump the full plan before the summary is confirmed.',
  'ORIGIN — the flight fare depends on where the traveler flies from. If they did not say where they are traveling from, ask for the departure city and add "Departure city" to missing. A reply that is only a city name (for example "New York", "yes New York", "NYC") right after you asked where they are flying from is the DEPARTURE city, NOT the destination — take it as the origin, move on to the next question, never treat it as a new destination, never change the trip because of it, and never ask for the departure city again after it was given. Never quote a flight fare as if it were for a specific origin when the origin is unknown — planner prices are estimates, labeled as such. When the traveler gave a month (for example January) but no exact dates, ask "which dates in January?" — do not list "Dates" as missing as if nothing was said.',
  'ROUTE STICKINESS — once you propose a route, KEEP IT across turns unless the traveler asks to change it. Never silently swap cities on the next reply: if turn 1 proposed Lisbon → Madrid → Barcelona → Paris → Rome → Athens, turn 2 must build on that same route, not propose a different one. A changed route confuses the traveler — the route they were just given disappeared.',
  'ALL THREE PRICES — every plan reply shows all three totals: Cheapest, Best value AND Premium. Never show only two of them.',
  'RECOMMEND — if the traveler gives constraints (budget, first trip, good food, month, origin, pace, number of countries) but no destination, or says they have nothing in mind, don\'t know, anywhere, "open to anything", "whatever you suggest", or "surprise me": DO NOT ask for a destination again and DO NOT decline. Propose a concrete route that fits their constraints: name the cities in order, sketch the days, cover flights, stays and transport, and price it from the table below (use the Other destinations row for a multi-city route). If they named a country or region (for example Egypt, Japan, Europe), propose a route through that country or region. Match the scope they asked for — if they said 5 countries, propose 5 countries; if they said a week, fit it in a week; if they said 15 days, plan 15 days. Ask at most one short follow-up question, and only after proposing.',
  'TRAVELER COUNT — "solo", "alone", "just me" or "1 traveler" means 1 traveler; "couple" means 2; otherwise use the number stated. Default to 2 only when nothing about party size is stated.',
  'FAMILY — when the traveler mentions kids, children or a family trip, ask how many kids and their ages (one question, right after the party size is known) and remember them in the kids array of your JSON answer. "2 adults, 3 kids" is 5 travelers, not 2. Adjust the plan to the YOUNGEST kid: under 5 — slow days, 2 major activities a day, a nap or downtime after lunch, kid-friendly restaurants near each stop; ages 5–11 — 2–3 activities a day with buffers and realistic walking distances; 12+ — full days are fine with a mix of sights and something active. Never suggest late-night bars or nightlife for a family with young kids. Mention the family pace in the Trip Summary.',
  'CHILD FARES — kids ages 2–11 fly at 75% of the adult fare internationally, under-2s at ~10% (free on your lap domestically), 12+ pay the adult fare, ages counted on the travel date. When a FAMILY PRICES block is present, quote those totals exactly — never the 1- or 2-traveler rows from the price table, never divide a total by the traveler count, and never price a family as all adults. If the children\'s ages are not known, ask once, then price with the 75% band and say so.',
  'PARTY SIZE — a party-size change is a slot update, never a trip reset: re-price the same route, re-check occupancy and the pace, and say what changed. Never flip the route because the party size changed.',
  'GROUP — whenever a price is quoted for more than one traveler, give the per-person price AND the whole-trip total together, never one without the other. For a family, split it per person by age (adults at the adult total, each kid at their own child-fare total from the FAMILY PRICES block) — never divide a total by the traveler count when kids are in the party. For adults only, the per-person price is the total divided by the traveler count, and it must multiply back to the total exactly.',
  'PROACTIVE FOLLOW-UP — end an answer that opens a next step with ONE concrete offer tied to an open slot ("Want me to watch this fare and tell you if it drops?", "Would you like me to check if your hotel offers parking?") — not a generic "anything else?".',
  'MONEY — always name what is in a total; never hide the service fee; prices are in USD. When a price is shown, add the currency line once: "Prices in USD. If you pay in the local currency, your bank converts at its rate — paying in the local currency is usually cheaper than letting the hotel or airline convert for you."',
  'PRICE HONESTY — every price shown is the total the traveler pays, broken into lines: fare + FujinTrip service fee + taxes/fees + bags. Say "this is the total you pay" once per reply. Never show a nightly rate without the trip total beside it. Never hide a fee in the fare. Add the fare-class line on every flight leg ("Basic Economy: no checked bag, no seat choice, no changes — add 1 bag: the airline charges its own bag fee at booking, confirmed before you pay"); that is what a Basic Economy total actually costs. When a LIVE FARES block lists included baggage, quote it with the fare ("Iberia $250, 1 checked bag included").',
  'OPEN-JAW — when the traveler changes a multi-city route, allow dropping a leg without regenerating the trip, and offer flying into one city and home from another when it saves a backtrack. Prices shown are for the return route unless stated otherwise.',
  'BUNDLE — the traveler does not have to book everything at once: once a flight is set, they can add their hotel, car or activities now or any time before the last day of the trip, at the same bundled price, and the bundle total updates exactly. When they ask to add something later, say so and name the last day it stays open. Never promise a price for a leg that is not in the price table or the LIVE FARES block.',
  'REVISION — when the traveler changes the trip they already have, change ONLY what they asked for and keep everything else (destination, dates, origin, travelers, the other stops). "Swap Vienna for Porto" means the route becomes Prague → Porto → Budapest with the same nights per city; "drop Vienna" removes it; "add Porto" adds it at the end; "Budapest before Vienna" or "put Budapest first" reorders; "slow down" drops the shortest stop; "more time in Prague" gives Prague the longest stay (set routeWeights {"Prague": 9}); "make it cheaper" / "upgrade" / "best value" changes the tier (return the tier field: 0 Cheapest, 1 Best value, 2 Premium); "change the budget to $2000" means pick the highest tier whose total fits $2000 and return its tier. Return the revised ordered list of cities in routeStops, and ONLY the changes the traveler asked for — never rebuild the route, never add a city they did not ask for, and never change the destination. If the city they name is not on the route (or is already on it), say so honestly and ask what they meant instead of inventing the change. A revision message naming route cities is NEVER a new destination. After any change, state the new total and the delta vs the previous plan (the totals are in the price table / FAMILY PRICES block) — confirm what changed, state what did NOT change, then the new total and the delta.',
  'VISA — when the trip\'s countries are known (see the VISA block below), mention the entry requirements in ONE short sentence in the Trip Summary, for a US passport, and point the traveler to the plan view\'s Visa & entry panel for the official source links. Never invent a visa rule, a fee, or a validity period — only state what the VISA block says. If there is no VISA block, say nothing about visas.',
  'BOOK NOW — when the traveler asks whether to book now or wait, use the PRICE CHECK block below: it compares the cheapest live fares out and back with the plan\'s own flight budget, and says whether the plan still holds or would rise. Quote that read, never add your own forecast, and never say fares will drop or rise — fares move both ways and we never predict them. If a TREND block is present, quote its sentence too — it is the read of the traveler\'s own past fare checks (\"Since you started watching on [date], the cheapest fares out and back went $X → $Y. Confidence: low/medium — based on N checks of your own fares, not a forecast.\"). If there is no TREND block, say there is no price history yet and offer a price watch in My Trips. Never give a confidence level from nothing, never say "high confidence", and never say a forecast is "95% accurate". If there is no PRICE CHECK block, say the live fare is not available for this trip yet and offer a price watch in My Trips.',
  'ON-TRIP FOOD — when a FOOD block is present, the traveler is asking where to eat tonight: name ONLY the places in it, with their open-now status, walk time, price band and dish — quote the Wikivoyage sentence as the review. Only say "open now" when the block says so; when it says "hours not verified", say so. Never invent a name, an opening hour, a dish or a review. If there is no FOOD block, answer from the LOCAL VOICES material and say which places you could not confirm.',
  'BEST TIME — when the traveler asks when to go, use the BEST TIME block: name the best month and why (price, crowds, weather), and the season for their month if they named one. Everything is a typical season, never a live price and never a forecast — say "typical season" when you quote it.',
  'WEATHER — when the traveler asks about weather, rain or closures, use the WEATHER block below: name the closures on the trip\'s dates and the day swaps they imply, and quote the rain chances for the trip days. Everything is a forecast from Open-Meteo, never a promise — say "forecast" when you quote it. If the block says no forecast exists yet (the trip is more than 16 days out), say so and do not guess the weather. Never invent a closure, a rain chance, or a swap.',
  'DISRUPTION — when the traveler says their flight was cancelled, delayed, missed or diverted, answer in this shape, in order: (1) what changed — ONLY from the FLIGHT STATUS block below (or from the status the traveler quoted in their own message); if there is no status block, say plainly you don\'t have a live status and point them to the "Check my flight" box. A cancellation counts only when it is confirmed — never call a flight cancelled on a rumor or a single flag. (2) why — only what the status itself says; never guess a cause (weather, mechanical). (3) three ranked options — Fastest, Cheapest, Most reliable — ONLY from the LIVE FARES block (airline, price, times); never invent an alternate flight, a gate, or a rebooking; if no live fares are available, say so and offer to save a booking request in My Trips. (4) the refund right: a flight touching the US — DOT automatic cash refund within 7 business days; a European route — EU261 €250/€400/€600 for a 3h+ delay or cancellation; the UK — UK261 £220/£350/£520. (5) one next action. Keep it short and practical.',
  'List anything missing as short questions in the missing array.',
  'PRICE COMPARISON — use ONLY these FujinTrip plan prices (planning estimates). The table gives a 1-traveler row AND a 2-traveler row for every destination: quote the row matching the traveler count EXACTLY. Never scale, multiply, divide, or compute a price yourself, and never use the 2-traveler row for 1 traveler. The plan totals (Cheapest / Best value / Premium) already INCLUDE flights, stays, transport between cities and activities — say so, and never break the total into parts that leave flights out. Always show the Best value total for the matched destination (for a destination not in the table, use the Other destinations row) and compare it with booking the same parts separately, using the separate total and saving from that same row (about 13% more when booking separately). Never compute a separate-booking total for Cheapest or Premium — the table gives a separate total only for Best value; if you show Cheapest or Premium, show only their totals. Best value is the recommended balance of quality and affordability. All prices are planning estimates, not live quotes — except the live fares in the LIVE FARES block (see below), which are real API prices.',
  'LIVE FARES — before the model runs, the server asks Duffel for the real fares for this exact trip (origin to the first city of the route, and back) on the trip\'s suggested dates, and appends them as a LIVE FARES block below. ONLY when a LIVE FARES block is present may you say fares are live — quote those fares as the flight prices, with the airline name and the price, and say they are live fares from Duffel (test fares in test mode). If NO LIVE FARES block is present, the flight prices are planning estimates from the price table — never write "live estimates via Duffel", never claim the flight prices come from Duffel, and never invent a fare. For the whole-trip totals, still use the price table (planning estimates) and say the flight inside the plan is estimated — the live fare may be lower.',
  'FujinTrip plan prices (1 traveler and 2 travelers):\n' + PRICE_TABLE,
  'LOCAL TIPS — return 1-3 short tips in the tips array: what travelers often love about the destination and how to experience it like a local — eat where locals eat, local transport, neighborhood stays, local guides. FujinTrip’s approach: travel globally, act locally — global trip planning with local experiences. These are general travel knowledge; never invent named reviewers, quotes, or fake review scores.',
  'Reply with strict JSON only, no other text: {"destination": string, "travelers": number, "reply": string, "missing": string[], "tips": string[], "kids": number[], "routeStops": string[], "routeWeights": object, "tier": number}. The kids array holds the kids\' ages when the trip is a family trip (empty otherwise). The routeStops array holds the REVISED ordered list of route cities when the traveler changed the trip in this message (otherwise leave it out or empty); routeWeights holds a city-to-weight map only when they asked for more time in a city; tier is 0/1/2 only when they changed the plan tier or budget.',
  'If the destination is unclear AND the traveler gave no constraints at all, ask which city or country they mean. If they already said they don\'t know or have nothing in mind, recommend instead of asking again.',
].join(' ');

const FUJIN_SCHEMA = {
  type: 'object',
  properties: {
    destination: { type: 'string' },
    travelers: { type: 'number' },
    reply: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    tips: { type: 'array', items: { type: 'string' } },
    kids: { type: 'array', items: { type: 'number' } },
    routeStops: { type: 'array', items: { type: 'string' } },
    routeWeights: { type: 'object', additionalProperties: { type: 'number' } },
    tier: { type: 'number' },
  },
  required: ['destination', 'reply'],
  additionalProperties: false,
};

type FujinResult = { destination: string; travelers: number; reply: string; missing: string[]; tips: string[]; kids?: number[]; routeStops?: string[]; routeWeights?: Record<string, number>; tier?: number };

// The live fetch needs a destination BEFORE the model runs, so guess it
// from the request: an explicit destination, or the last place named in
// the conversation (a known destination or a country from the route map).
// Anything else skips the fetch — the model still answers from its own
// knowledge.
function guessDestination(raw: Record<string, unknown>, message: string): string {
  if (typeof raw.destination === 'string' && raw.destination.trim()) return raw.destination.trim();
  return lastPlaceMentioned(message);
}

// The fallback reply as a plain payload (the built-in planner's answer
// with voices, fares, trend and food appended) — the atomic path wraps it
// in NextResponse.json, and the streaming path sends the same payload as
// the final `done` event after chunking its reply text.
function fallbackPayload(message: string, label: string, voices?: LocalVoices, voicesDest = '', defaultTravelers = 2, contextDestination = '', currentMessage = '', contextOrigin = '', liveFares?: LiveFares | null, contextOverride?: RouteOverride, contextKids?: number[], contextTier?: number, contextPriceHistory?: TrendObservation[], contextFood?: TonightResult | null, flightStatus?: DisruptionStatus | null, weather?: WeatherCheck | null, cityVoices?: CityVoices[]) {
  const parsed = askFujin(message, defaultTravelers, contextDestination, currentMessage, contextOrigin, contextOverride, contextKids, contextTier);
  // A decline must stay a decline: the context-destination override below
  // would otherwise resurrect an off-topic message as a plan ("who will
  // win the election?" after an Egypt chat came back as an Egypt route).
  const declinedOffTopic = currentMessage ? isOffTopicMessage(currentMessage) : false;
  // A disruption report is mid-crisis, not shopping — the 3-tier prices
  // must not be appended to it; the live fares (the rebooking options)
  // still are, below.
  const disruption = currentMessage ? isDisruptionMessage(currentMessage) : false;
  // The destination can come from request context, not the message —
  // on-trip mode passes it as tripContext. Don't ask "which city?" when
  // we already know it.
  let destination = parsed.destination;
  let reply = parsed.reply;
  let missing = parsed.missing;
  if (!destination && voicesDest && !declinedOffTopic) {
    destination = voicesDest;
    reply = `Got it — ${voicesDest} for ${parsed.travelers} traveler${parsed.travelers > 1 ? 's' : ''}. I’ll build one complete plan with Cheapest / Best value / Premium options, and you book it all with FujinTrip — no bouncing between booking sites.`;
    missing = missing.filter((m) => m !== 'Destination');
  }
  // Disruption template (round 2 #9): when the traveler reports a
  // disruption, the reply follows the template — what changed (from
  // the checked status), why, the 3 ranked live-fare options, the
  // refund right, one next action. It replaces the generic disruption
  // reply; with no live status and no live fares it still answers
  // honestly (the gaps are stated, never filled in).
  if (disruption && !declinedOffTopic) {
    reply = disruptionTemplate({
      status: flightStatus ?? undefined,
      fares: liveFares?.live ? liveFares.out : [],
      routeKey: routeKeyForDestination(destination),
      origin: contextOrigin,
    });
    missing = [];
  }
  // The reply must carry real value: the 3 tier prices with a clear pick,
  // so the traveler can choose before asking for the plan. But NOT while
  // the conversation is still gathering details (guided flow): a reply
  // that asks one question ("How many days?") must not also dump three
  // prices — the prices arrive with the Trip Summary. And never on a
  // disruption report (see above).
  if (destination && !parsed.needsMore && !disruption) reply += `\n\n${optionsLine(destination, parsed.travelers, { kids: parsed.kids ?? [] })}`;
  // Visa line, on the Trip Summary only — the summary is the moment the
  // trip is set, and the panel in the plan view carries the detail.
  if (destination && reply.includes('Here is your trip —')) {
    const v = visaLine(destination);
    if (v) reply += `\n\n${v}`;
  }
  // Even when the live model is down, fresh traveler material still helps —
  // but never on a decline, where it would read as an answer, and never on
  // a guided question, where a long excerpt would bury the one question.
  if (voices?.text && destination && !parsed.needsMore) reply += `\n\nFresh traveler notes: ${voices.text.slice(0, 400)}`;
  // Per-city notes (round 3 #1): one short line per stop city, so a
  // multi-stop trip names real places per city instead of one generic
  // region blob. A city with no material says so — never invented.
  if (cityVoices?.length && destination && !parsed.needsMore) {
    const lines = cityVoices.map(({ city, voices: cv }) =>
      cv.text ? `${city}: ${cv.text.split('\n').filter((l) => l.trim()).slice(0, 2).join(' ').slice(0, 220)}` : `No traveler tips for ${city} yet.`
    );
    reply += `\n\nTraveler tips per city:\n${lines.join('\n')}`;
  }
  // Same for the live fares: the offline fallback quotes them too, so the
  // traveler still sees the real Duffel price when the model is down.
  if (liveFares?.live && destination && !parsed.needsMore && !declinedOffTopic) {
    reply += `\n\n${faresSummaryLine(liveFares)}`;
    // And the book-now-or-wait read, from the same live fares against
    // the plan's flight budget — never a forecast, always a snapshot.
    const checkLine = priceCheck(liveFares, comparisonFor(destination, parsed.travelers, { kids: parsed.kids ?? [] }).best.flight).line;
    if (checkLine) reply += ` ${checkLine}`;
  }
  // The trend read stands on its own: the watch's own past checks, with
  // or without a fresh live fare today — the last observation is the
  // freshest check, and the sentence says so.
  if (destination && !parsed.needsMore && !declinedOffTopic) {
    const freshTotal = liveFares?.live && liveFares.out.length && liveFares.back.length ? (liveFares.out[0]?.price ?? 0) + (liveFares.back[0]?.price ?? 0) : 0;
    const trend = trendLine(freshTotal > 0 ? appendObservation(contextPriceHistory ?? [], freshTotal) : contextPriceHistory ?? []);
    if (trend.line) reply += liveFares?.live ? ` ${trend.line}` : `\n\n${trend.line}`;
  }
  // Tonight's food (round 2 #4): the places open now, from Wikivoyage —
  // appended when the server fetched them for tonight's question.
  if (contextFood?.places.length && !declinedOffTopic) {
    reply += `\n\n${foodReply(contextFood)}`;
  }
  // Weather / closures (round 2 #10): when the traveler asked about
  // weather or closures, the check's swaps and the forecast gap — the
  // same lines the plan view's Plan updates box shows.
  if (weather && /weather|rain|rainy|forecast|closed|closure/i.test(message) && destination && !declinedOffTopic) {
    if (weather.swaps.length) {
      reply += `\n\nPlan updates — the weather and closures moved two days around:\n${weather.swaps.map(swapLine).join('\n')}`;
    } else if (weather.closures.length) {
      reply += `\n\nI checked the closures for your trip: ${weather.closures.map((c) => `${c.attraction} in ${c.city} is closed on day ${c.day}`).join('; ')} — but the plan can't move that day to another day in the same city, so check the attraction's site before you go and plan around it.`;
    }
    if (!weather.forecastAvailable) {
      reply += weather.forecastReason === 'too_far'
        ? `\n\nThe weather forecast isn't available yet — your trip starts ${weather.startDate}, more than 16 days out.`
        : weather.forecastReason === 'past'
          ? `\n\nThe weather forecast isn't available — your trip starts ${weather.startDate}, which has already passed.`
          : `\n\nThe weather forecast couldn't be loaded just now — I won't guess the weather.`;
    }
  }
  // Best time to travel (round 2 #5): when the traveler asks when to
  // go, the best month and the season for their month. Pure function of
  // the destination — no fetch, no live data, so it is computed here.
  if (destination && !declinedOffTopic && /best time|when should (i|we) go|when to go|when is the best|cheapest month|best month to/i.test(message)) {
    const line = bestTimeLine(destination, findMonth(message));
    if (line) reply += `\n\n${line}`;
  }
  return {
    live: false,
    label,
    ...parsed,
    destination,
    reply,
    missing,
    // The client reads routeStops / routeWeights / tier — the same shape
    // the live model returns. The fallback's routeOverride is the same
    // data under its planner name, so expose it in both shapes.
    routeStops: parsed.routeOverride?.cities,
    routeWeights: parsed.routeOverride?.weights,
    voices: voices?.text ?? '',
    voicesSource: voices?.source ?? '',
    voicesDestination: voicesDest,
    // Per-city voices (round 3 #1): the plan view renders these under
    // "What travelers say" per stop city; [] when the trip is a single
    // city (the region fetch already is that city's material).
    cityVoices: cityVoices ?? [],
    liveFares: liveFares ?? null,
  };
}

// The atomic fallback: the payload as a JSON response.
function fallback(...args: Parameters<typeof fallbackPayload>) {
  return NextResponse.json(fallbackPayload(...args));
}

// The reply field inside a half-written model JSON object — the model
// returns strict JSON, so a streaming reply is the JSON arriving
// piece by piece. The partial value is the readable text so far; the
// final parse (parseModelJson) is what the client trusts.
function partialReply(raw: string): string | null {
  const m = raw.match(/"reply"\s*:\s*"/);
  if (!m || m.index === undefined) return null;
  const s = raw.slice(m.index + m[0].length);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      out += s.slice(i, i + 2);
      i++;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  try {
    return JSON.parse(`"${out}"`);
  } catch {
    return out;
  }
}

function parseModelJson(content: string): FujinResult | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    // Empty destination is valid: it is how the model reports an off-topic decline.
    if (typeof raw.destination !== 'string') return null;
    if (typeof raw.reply !== 'string' || !raw.reply.trim()) return null;
    return {
      destination: raw.destination.trim(),
      travelers: Math.min(9, Math.max(1, Number(raw.travelers) || 2)),
      reply: raw.reply.trim(),
      missing: Array.isArray(raw.missing) ? raw.missing.filter((m): m is string => typeof m === 'string') : [],
      tips: Array.isArray(raw.tips)
        ? raw.tips.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 3)
        : [],
      kids: Array.isArray(raw.kids)
        ? raw.kids.filter((k): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6)
        : undefined,
      routeStops: Array.isArray(raw.routeStops)
        ? raw.routeStops.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()).slice(0, 8)
        : undefined,
      routeWeights:
        raw.routeWeights && typeof raw.routeWeights === 'object' && !Array.isArray(raw.routeWeights)
          ? Object.fromEntries(
              Object.entries(raw.routeWeights as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'number' && (v as number) > 0 && (v as number) <= 12)
                .map(([k, v]) => [k, v as number])
            )
          : undefined,
      tier: typeof raw.tier === 'number' && [0, 1, 2].includes(raw.tier) ? raw.tier : undefined,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const message = typeof raw.message === 'string' ? raw.message : '';

  // Conversation history: the chat sends its last few turns so the model
  // remembers the trip (destination, dates, budget) instead of treating
  // each message as a fresh conversation (the Nov 10 Europe bug: the
  // second message lost Europe/January/NYC entirely).
  type HistoryTurn = { role: 'user' | 'assistant'; content: string };
  const history: HistoryTurn[] = Array.isArray(raw.history)
    ? (raw.history as Array<Record<string, unknown>>)
        .filter((t) => t && typeof t === 'object')
        .map((t) => ({
          role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: typeof t.content === 'string' ? t.content : '',
        }))
        .filter((t) => t.content.trim().length > 0)
        .slice(-10)
    : [];
  // Plain text of everything the traveler said so far — the fallback and
  // the destination guess need it too, not just the live model.
  const fullText = [...history.filter((t) => t.role === 'user').map((t) => t.content), message].filter(Boolean).join(' ');

  // Durable trip memory: the page sends the trip it already established
  // (destination + travelers from the last parsed reply) with EVERY
  // request. It survives history scrolling off the window, so a 10+ turn
  // conversation never loses the trip — the model is told it explicitly,
  // and the fallback uses it when the message and history name nothing.
  const tripState = raw.tripState && typeof raw.tripState === 'object' ? (raw.tripState as Record<string, unknown>) : {};
  const stateDestination = typeof tripState.destination === 'string' && tripState.destination.trim() ? tripState.destination.trim() : '';
  const stateTravelers =
    typeof tripState.travelers === 'number' && tripState.travelers >= 1 && tripState.travelers <= 9 ? tripState.travelers : 0;
  const stateOrigin = typeof tripState.origin === 'string' && tripState.origin.trim() ? tripState.origin.trim() : '';
  const stateKids = Array.isArray(tripState.kids)
    ? (tripState.kids as unknown[]).filter((k): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6)
    : [];
  // The tier the traveler already picked (the page sends its current
  // choice with every request) — a revision states the new total AND the
  // delta vs this tier.
  const stateTier =
    typeof tripState.tier === 'number' && [0, 1, 2].includes(tripState.tier) ? tripState.tier : undefined;
  // The watch's own past fare checks for this trip (round 2 #3) — the
  // cheapest live out+back total on each check date, sent by the page
  // with every request so the trend read is always from real checks.
  const statePriceHistory: TrendObservation[] = Array.isArray(tripState.priceHistory)
    ? (tripState.priceHistory as unknown[])
        .filter(
          (h): h is TrendObservation =>
            !!h && typeof h === 'object' && typeof (h as TrendObservation).at === 'string' && typeof (h as TrendObservation).total === 'number' && (h as TrendObservation).total > 0
        )
        .slice(0, 50)
    : [];
  // The trip's current route override (from an earlier revision): the
  // ordered cities + weights, so the model and the fallback keep
  // building on the revised route instead of the original.
  const stateRouteOverride: RouteOverride | undefined =
    tripState.routeOverride && typeof tripState.routeOverride === 'object' && !Array.isArray(tripState.routeOverride)
      ? (() => {
          const o = tripState.routeOverride as Record<string, unknown>;
          const cities = Array.isArray(o.cities)
            ? (o.cities as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()).slice(0, 8)
            : [];
          if (!cities.length) return undefined;
          const weights =
            o.weights && typeof o.weights === 'object' && !Array.isArray(o.weights)
              ? Object.fromEntries(
                  Object.entries(o.weights as Record<string, unknown>)
                    .filter(([, v]) => typeof v === 'number' && (v as number) > 0 && (v as number) <= 12)
                    .map(([k, v]) => [k, v as number])
                )
              : undefined;
          return { cities, ...(weights && Object.keys(weights).length ? { weights } : {}) };
        })()
      : undefined;

  // On-trip mode (feature 8): the traveler is already at the destination
  // and wants short, right-now local answers. The trip destination also
  // drives the live fetch below.
  const onTrip = typeof raw.tripContext === 'string' && raw.tripContext.trim() ? raw.tripContext.trim() : '';
  const voicesDest = onTrip || guessDestination(raw, fullText) || stateDestination;
  const voicesPromise: Promise<LocalVoices> = voicesDest
    ? fetchLocalVoices(voicesDest).catch(() => ({ text: '', source: '' }))
    : Promise.resolve({ text: '', source: '' });
  // "Tonight, near you, open now" (round 2 #4): whether the traveler is
  // asking where to eat tonight. The city is resolved below, after the
  // route's first city is known — only for tonight-food questions, so a
  // planning question never pays for a food fetch.
  const isTonightFood = /tonight|open now|where (should|can|do) (i|we) eat|eat tonight|dinner tonight|hungry|where to eat/i.test(message);
  // Live fares from Duffel (urgent, Nov 11): once the trip is known —
  // destination, origin, month and length — ask Duffel for the real fares
  // for the exact trip, so the model quotes API prices instead of the
  // planner's estimates. The fare destination is the first city of the
  // route (Prague for Central Europe, Lisbon for the Europe route); the
  // dates are the trip card's suggested dates, so the chat and the card
  // always agree on the trip. Skipped for on-trip/food questions (no
  // flight to price) and whenever a slot or airport code is missing.
  // Best-effort and capped (~10s inside, plus a 10-minute cache): never
  // let a slow Duffel call break the chat.
  const stateMonth =
    typeof tripState.month === 'number' && tripState.month >= 1 && tripState.month <= 12 ? tripState.month : 0;
  const stateDays =
    typeof tripState.durationDays === 'number' && tripState.durationDays >= 2 ? tripState.durationDays : 0;
  const tripMonth = stateMonth || findMonth(fullText);
  const tripDaysKnown = stateDays || parseDuration(fullText);
  const fareRouteKey = routeKeyForDestination(voicesDest || stateDestination);
  const fareDestCity = fareRouteKey ? ROUTE_STOPS[fareRouteKey][0].city : voicesDest || stateDestination;
  const departDate = tripMonth ? suggestedStart(tripMonth) : null;
  const returnDate =
    departDate && tripDaysKnown >= 2 ? new Date(departDate.getTime() + (tripDaysKnown - 1) * 86400000) : null;
  const faresPromise: Promise<LiveFares | null> =
    // Skipped for on-trip/food questions (no flight to price) — EXCEPT
    // a disruption report, where the live fares ARE the rebooking
    // options the traveler needs right now.
    (!onTrip || isDisruptionMessage(message)) && fareDestCity && stateOrigin && departDate && returnDate
      ? fetchLiveFares({
          origin: stateOrigin,
          destCity: fareDestCity,
          departDate: departDate.toISOString().slice(0, 10),
          returnDate: returnDate.toISOString().slice(0, 10),
          travelers: stateTravelers || 2,
        }).catch(() => null)
      : Promise.resolve(null);
  // The food fetch (round 2 #4): the city the traveler is in — the city
  // named in the message, else the route's first city (the trip's
  // starting point), else the destination itself when it is a city.
  // Best-effort and capped (~9s inside): never let a slow Wikivoyage
  // call break the chat.
  const namedFoodCity = lastPlaceMentioned(message);
  const foodCity = isTonightFood
    ? (namedFoodCity && CITY_TZ[namedFoodCity] ? namedFoodCity : fareDestCity && CITY_TZ[fareDestCity] ? fareDestCity : '')
    : '';
  const foodPromise: Promise<TonightResult | null> = foodCity
    ? fetchTonight(foodCity).catch(() => null)
    : Promise.resolve(null);
  // The weather / closure check (round 2 #10): only when the traveler
  // asks about weather, rain or closures, and only when the trip is
  // known. The forecast is fetched only when the trip starts within 16
  // days — beyond that Open-Meteo has no forecast yet, and the route
  // says so instead of inventing one.
  const isWeatherQuestion = /weather|rain|rainy|forecast|closed|closure/i.test(message);
  const weatherCard = isWeatherQuestion && stateDestination && tripDaysKnown >= 2 && tripMonth
    ? buildTripCard({ destination: stateDestination, travelers: stateTravelers || 2, days: tripDaysKnown, month: tripMonth, origin: stateOrigin, ...(stateRouteOverride ? { routeOverride: stateRouteOverride } : {}), kids: stateKids })
    : null;
  const weatherPromise: Promise<WeatherCheck | null> = weatherCard
    ? checkTripWeather(weatherCard).catch(() => null)
    : Promise.resolve(null);
  // Per-city voices (round 3 #1): the route's stop cities, not the
  // region name — a multi-stop trip gets one voices block per city.
  // The route comes from the ESTABLISHED trip (tripState), not the
  // guessed destination: lastPlaceMentioned("Central Europe…") returns
  // "Europe", which would fetch Lisbon/Madrid/Barcelona for a Central
  // Europe trip. Skipped for single-city trips (the region fetch
  // already IS that city's material) and on-trip mode (one city,
  // already covered). Best-effort like the region fetch: never let it
  // break the chat.
  const cityRouteKey = routeKeyForDestination(stateDestination) || fareRouteKey;
  const cityList = cityRouteKey && !onTrip ? stopsForRoute(cityRouteKey, stateRouteOverride).map((s) => s.city) : [];
  const cityVoicesPromise: Promise<CityVoices[]> =
    cityList.length >= 2
      ? fetchLocalVoicesForCities(cityList).catch(() => [] as CityVoices[])
      : Promise.resolve([] as CityVoices[]);
  const [voices, liveFares, food, weather, cityVoices] = await Promise.all([voicesPromise, faresPromise, foodPromise, weatherPromise, cityVoicesPromise]);

  // System prompt for this request: base prompt + fresh traveler material
  // + on-trip framing when applicable.
  let systemPrompt = SYSTEM_PROMPT;
  if (voices.text) {
    systemPrompt +=
      ' LOCAL VOICES — fresh traveler material for this destination, fetched just now from traveler guides. Prefer naming the real places, dishes and tips from it in your reply and in tips. Never invent a reviewer name, quote, or review score; if a place in this material contradicts your own knowledge, trust the material. ' +
      voices.text;
  }
  // Per-city voices (round 3 #1): the same material, per stop city —
  // name real places per city, and say plainly when a city has none.
  if (cityVoices.length) {
    systemPrompt += ' CITY VOICES — ' + formatCityVoices(cityVoices);
  }
  if (liveFares?.live) {
    systemPrompt += ' ' + faresPromptBlock(liveFares);
  }
  // Tonight's food (round 2 #4): the places open now, from Wikivoyage
  // — the model names ONLY these, with their open-now status.
  if (food?.places.length) {
    systemPrompt += ` FOOD — ${foodBlock(food)}`;
  }
  // Best time to travel (round 2 #5): the best month and the season for
  // the trip's own month, when the traveler asks when to go.
  if (/best time|when should (i|we) go|when to go|when is the best|cheapest month|best month to/i.test(message) && (voicesDest || stateDestination)) {
    systemPrompt += ` BEST TIME — ${bestTimeLine(voicesDest || stateDestination, tripMonth)}`;
  }
  // Weather / closures (round 2 #10): the closures on this trip's
  // dates, the swaps they imply, and the forecast gap when the trip is
  // too far out — the model quotes the block, never a guessed forecast.
  if (weather && isWeatherQuestion) {
    systemPrompt += ` WEATHER — ${weatherBlock(weather)}`;
  }
  if (onTrip) {
    systemPrompt += ` ON-TRIP MODE — the traveler is in ${onTrip} RIGHT NOW. Answer short and practical: where to eat tonight, what is open now, how to get there. Use the local voices material above for real places. Keep it to what helps right now, not a full plan.`;
  }
  if (stateDestination) {
    systemPrompt += ` TRIP SO FAR — the traveler is already planning this trip: destination ${stateDestination}, ${stateTravelers || 2} travelers${stateOrigin ? `, flying from ${stateOrigin}` : ''}${stateKids.length ? `, kids ages ${stateKids.join(', ')}` : ''}${stateTier !== undefined ? `, on the ${['Cheapest', 'Best value', 'Premium'][stateTier]} plan` : ''}${stateRouteOverride?.cities.length ? `, route stops ${stateRouteOverride.cities.join(' → ')}` : ''}. Remember this across turns — do not ask for the destination, traveler count, or departure city again unless the traveler says it changed. If the current message changes the destination, party size, or origin, use the NEW one.`;
  }
  // Nights per city, from the planner's distribution — injected so the
  // live model never re-splits the route: on the live site turn 5 gave
  // Prague 4 / Vienna 4 / Budapest 4 plus filler days and turn 6 gave
  // 3/3/3, so the chat and the trip card disagreed. The distribution is
  // the same one the trip card uses, so the chat and the map always agree.
  // Only when the destination maps to a route and the length is known.
  const routeKey = routeKeyForDestination(voicesDest || stateDestination);
  const tripDays = parseDuration(fullText);
  if (routeKey && tripDays >= 2) {
    // A revised route's nights are its own distribution — the model
    // must quote the revised nights, not the original route's.
    const legs = stateRouteOverride?.cities.length
      ? distributeNightsForStops(stopsForRoute(routeKey, stateRouteOverride), tripDays)
      : distributeNights(routeKey, tripDays);
    systemPrompt += ` ROUTE NIGHTS — for ${voicesDest || stateDestination} over ${tripDays} days, the nights per city are EXACTLY: ${legs.map((l) => `${l.city} ${l.nights} nights`).join(', ')}. Use exactly these nights, in exactly this order, in every reply — never re-split them, never add filler days, and never change them on a later turn.`;
  }
  // Visa & entry (competitor learning #3, Sherpa): the curated, verified
  // entry rules for the trip's countries, for a US passport — the model
  // quotes this block and nothing else about visas.
  const visa = visaLine(voicesDest || stateDestination);
  if (visa) {
    systemPrompt += ` VISA — ${visa}`;
  }
  // Family prices (competitor learning, round 2 #1: child fares): the
  // price table's 1- and 2-traveler rows are wrong for a family — the
  // model quotes THESE totals for this party, never the table rows,
  // never a scaled price, never "total ÷ travelers".
  if (stateKids.length && (voicesDest || stateDestination)) {
    const famDest = voicesDest || stateDestination;
    const famOpts = buildPlan(famDest, stateTravelers || 2, 3, { kids: stateKids }).options;
    const famFlightSaving = buildPlan(famDest, stateTravelers || 2, 3).options[1].flight - famOpts[1].flight;
    systemPrompt += ` FAMILY PRICES — for this trip's party (${stateTravelers || 2} travelers, kids ages ${stateKids.join(', ')}), child fares apply: ages 2–11 fly at 75% of the adult fare, under-2s at 10%, 12+ at the adult fare. The totals for THIS party are: Cheapest $${famOpts[0].total.toLocaleString()} / Best value $${famOpts[1].total.toLocaleString()} / Premium $${famOpts[2].total.toLocaleString()} — the flights inside are $${famFlightSaving.toLocaleString()} less than pricing everyone as an adult. Quote these totals exactly, never the 1- or 2-traveler rows from the price table, never divide a total by the traveler count, and never price a family as all adults.`;
  }
  // Price check (competitor learning #4, Mindtrip / Kayak): the live
  // fares against the plan's own flight budget — the model quotes this
  // read when the traveler asks about booking timing, and never invents
  // a forecast of its own.
  const checkDest = voicesDest || stateDestination;
  const check = liveFares?.live && checkDest
    ? priceCheck(liveFares, comparisonFor(checkDest, stateTravelers || 2).best.flight)
    : null;
  if (check?.line) {
    systemPrompt += ` PRICE CHECK — ${check.line}`;
  }
  // Trend (round 2 #3, Kayak): the watch's own past checks plus today's
  // fresh live fare (both directions — a partial total is not comparable
  // with past full totals). The model quotes the humble sentence when
  // the traveler asks about timing; with fewer than 2 observations
  // there is no sentence and the BOOK NOW rule says so.
  const freshTotal = liveFares?.live && liveFares.out.length && liveFares.back.length ? (liveFares.out[0]?.price ?? 0) + (liveFares.back[0]?.price ?? 0) : 0;
  const trend = trendLine(freshTotal > 0 ? appendObservation(statePriceHistory, freshTotal) : statePriceHistory);
  if (trend.line) {
    systemPrompt += ` TREND — ${trend.line}`;
  }
  // Flight status (competitor learning #5): the traveler checked a
  // flight in the "Check my flight" box and sent the result with this
  // message — the model quotes THIS status and nothing else about the
  // flight. The client only sends a live (confirmed) status, never a
  // guess.
  const flightStatus = raw.flightStatus && typeof raw.flightStatus === 'object' ? (raw.flightStatus as Record<string, unknown>) : null;
  if (flightStatus && flightStatus.live === true && typeof flightStatus.flight === 'string' && typeof flightStatus.status === 'string') {
    const f = flightStatus;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
    const bits: string[] = [`${String(f.flight)} on ${str(f.date)}: ${String(f.status)}`];
    if (f.cancellationConfirmed === true) bits.push('cancellation CONFIRMED');
    if (f.cancellationUnconfirmed === true) bits.push('cancellation UNCONFIRMED — do not call it cancelled');
    if (typeof f.delayedMinutes === 'number' && f.delayedMinutes > 0) bits.push(`delayed ${f.delayedMinutes} minutes`);
    if (f.diverted === true) bits.push('diverted');
    const route = [str((f.origin as Record<string, unknown> | undefined)?.city), str((f.destination as Record<string, unknown> | undefined)?.city)].filter(Boolean).join(' → ');
    if (route) bits.push(route);
    if (str(f.scheduledDeparture)) bits.push(`scheduled departure ${str(f.scheduledDeparture)}`);
    if (str(f.estimatedDeparture)) bits.push(`estimated departure ${str(f.estimatedDeparture)}`);
    if (str(f.scheduledArrival)) bits.push(`scheduled arrival ${str(f.scheduledArrival)}`);
    if (str(f.estimatedArrival)) bits.push(`estimated arrival ${str(f.estimatedArrival)}`);
    if (str(f.gateOrigin)) bits.push(`departure gate ${str(f.gateOrigin)}`);
    if (str(f.terminalOrigin)) bits.push(`departure terminal ${str(f.terminalOrigin)}`);
    if (str(f.gateDestination)) bits.push(`arrival gate ${str(f.gateDestination)}`);
    if (str(f.terminalDestination)) bits.push(`arrival terminal ${str(f.terminalDestination)}`);
    if (str(f.baggageClaim)) bits.push(`baggage claim ${str(f.baggageClaim)}`);
    systemPrompt += ` FLIGHT STATUS — ${bits.join('. ')}.`;
  }
  // The checked status for the fallback's disruption template (round 2
  // #9): only a live, confirmed status is trusted — anything else is
  // the graceful state, never a faked status.
  const cityOf = (v: unknown) => {
    const o = v as Record<string, unknown> | undefined;
    return o && typeof o.city === 'string' ? { city: o.city } : undefined;
  };
  const checkedStatus: DisruptionStatus | null =
    flightStatus && flightStatus.live === true && typeof flightStatus.flight === 'string' && typeof flightStatus.status === 'string'
      ? {
          flight: String(flightStatus.flight),
          ...(typeof flightStatus.date === 'string' ? { date: flightStatus.date } : {}),
          status: String(flightStatus.status),
          ...(flightStatus.cancellationConfirmed === true ? { cancellationConfirmed: true } : {}),
          ...(flightStatus.cancellationUnconfirmed === true ? { cancellationUnconfirmed: true } : {}),
          ...(typeof flightStatus.delayedMinutes === 'number' ? { delayedMinutes: flightStatus.delayedMinutes } : {}),
          ...(flightStatus.diverted === true ? { diverted: true } : {}),
          ...(cityOf(flightStatus.origin) ? { origin: cityOf(flightStatus.origin) } : {}),
          ...(cityOf(flightStatus.destination) ? { destination: cityOf(flightStatus.destination) } : {}),
          ...(typeof flightStatus.estimatedDeparture === 'string' ? { estimatedDeparture: flightStatus.estimatedDeparture } : {}),
          ...(typeof flightStatus.estimatedArrival === 'string' ? { estimatedArrival: flightStatus.estimatedArrival } : {}),
        }
      : null;

  const provider = getProvider();
  // Streaming (design #2): when the client asks for stream: true, the
  // reply arrives as server-sent events — `chunk` events carry the reply
  // text as it arrives, then a `done` event carries the full result (the
  // same shape as the atomic reply). The first chunk is the
  // time-to-first-token moment; the typing indicator covers the wait
  // before it. With no provider, the built-in planner's reply is chunked
  // the same way (paced, ~25ms a chunk) so the client machinery works
  // identically on the fallback path.
  if (raw.stream === true) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          if (!provider) {
            const payload = fallbackPayload(
              fullText,
              'Fujin AI is offline — using the built-in planner. Connect an AI provider (QWEN_API_KEY or MODEL_API_KEY) to switch on live AI.',
              voices,
              voicesDest,
              stateTravelers || 2,
              stateDestination,
              message,
              stateOrigin,
              liveFares,
              stateRouteOverride,
              stateKids,
              stateTier,
              statePriceHistory,
              food,
              checkedStatus,
              weather,
              cityVoices
            );
            // Chunk the reply at word boundaries so the client renders
            // flowing text, not characters.
            const words = payload.reply.split(/(?<=\s)/);
            let chunk = '';
            for (const w of words) {
              chunk += w;
              if (chunk.length >= 24) {
                send({ chunk });
                chunk = '';
                await new Promise((r) => setTimeout(r, 25));
              }
            }
            if (chunk) send({ chunk });
            send({ done: true, result: payload });
            return;
          }
          // Live provider, streamed: the same request as the atomic path,
          // plus stream: true. The deltas are raw JSON text; the chunk
          // events carry only the new reply text, so the client just appends.
          const aborter = new AbortController();
          const timeout = setTimeout(() => aborter.abort(), 30000);
          let res: Response;
          try {
            res = await fetch(`${provider.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: provider.model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...history.map((t) => ({ role: t.role, content: t.content })),
                  { role: 'user', content: message },
                ],
                temperature: 0.3,
                ...(provider.name === 'Qwen' ? { enable_thinking: false } : {}),
                response_format: provider.useJsonSchema
                  ? { type: 'json_schema', json_schema: { name: 'fujin_trip', strict: false, schema: FUJIN_SCHEMA } }
                  : { type: 'json_object' },
                stream: true,
              }),
              signal: aborter.signal,
            });
          } finally {
            clearTimeout(timeout);
          }
          if (!res.ok || !res.body) {
            const detail = `provider ${provider.name} stream ${res.status}`;
            console.error('[fujin] stream request failed', detail);
            send({ error: detail });
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          let full = '';
          let sent = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith('data:')) continue;
              const data = t.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              let ev: { choices?: Array<{ delta?: { content?: string } }> };
              try {
                ev = JSON.parse(data) as typeof ev;
              } catch {
                continue;
              }
              const delta = ev?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                full += delta;
                const partial = partialReply(full);
                if (partial !== null && partial.length > sent.length) {
                  send({ chunk: partial.slice(sent.length) });
                  sent = partial;
                }
              }
            }
          }
          const parsed = parseModelJson(full);
          if (!parsed) {
            console.error('[fujin] Streamed model reply was unparseable');
            send({ error: 'unparseable' });
            return;
          }
          send({
            done: true,
            result: {
              live: true,
              label: `Live Fujin AI (${provider.name}).`,
              ...parsed,
              voices: voices.text,
              voicesSource: voices.source,
              voicesDestination: voicesDest,
              cityVoices: cityVoices ?? [],
              liveFares: liveFares ?? null,
            },
          });
        } catch (err) {
          console.error('[fujin] Stream failed', err instanceof Error ? err.message : err);
          send({ error: err instanceof Error ? err.message : 'stream failed' });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  if (!provider) {
    return fallback(
      fullText,
      'Fujin AI is offline — using the built-in planner. Connect an AI provider (QWEN_API_KEY or MODEL_API_KEY) to switch on live AI.',
      voices,
      voicesDest,
      stateTravelers || 2,
      stateDestination,
      message,
      stateOrigin,
      liveFares,
      stateRouteOverride,
      stateKids,
      stateTier,
      statePriceHistory,
      food,
      checkedStatus,
      weather,
      cityVoices
    );
  }
  const apiKey = provider.apiKey;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.map((t) => ({ role: t.role, content: t.content })),
            { role: 'user', content: message },
          ],
          temperature: 0.3,
          // Qwen 3.7-flash thinks by default (hidden reasoning before the
          // answer) — that made live replies take ~21s. The planner task
          // needs short structured answers, not deep reasoning, so turn
          // thinking off for Qwen only; Muse has no such parameter.
          ...(provider.name === 'Qwen' ? { enable_thinking: false } : {}),
          // Muse uses strict JSON Schema; Qwen uses plain JSON mode —
          // the system prompt still demands the same JSON shape, and
          // parseModelJson extracts it either way.
          response_format: provider.useJsonSchema
            ? {
                type: 'json_schema',
                json_schema: { name: 'fujin_trip', strict: false, schema: FUJIN_SCHEMA },
              }
            : { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; code?: string; type?: string };
    };

    if (!res.ok) {
      // Surface the API's own error message — a bare status code hides the cause.
      const detail = [json.error?.code, json.error?.message].filter(Boolean).join(': ') || `no details from ${provider.name} API`;
      console.error(`[fujin] ${provider.name} API error`, res.status, detail);
      return fallback(fullText, `${provider.name} API error (${res.status}): ${detail.slice(0, 200)} — using the built-in planner.`, voices, voicesDest, stateTravelers || 2, stateDestination, message, stateOrigin, liveFares, stateRouteOverride, stateKids, stateTier, statePriceHistory, food, checkedStatus, weather, cityVoices);
    }

    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson(content);
    if (!parsed) {
      console.error('[fujin] Model API returned unparseable content');
      return fallback(fullText, 'Fujin AI gave an unclear answer — using the built-in planner.', voices, voicesDest, stateTravelers || 2, stateDestination, message, stateOrigin, liveFares, stateRouteOverride, stateKids, stateTier, statePriceHistory, food, checkedStatus, weather, cityVoices);
    }

    return NextResponse.json({
      live: true,
      label: `Live Fujin AI (${provider.name}).`,
      ...parsed,
      voices: voices.text,
      voicesSource: voices.source,
      voicesDestination: voicesDest,
      cityVoices: cityVoices ?? [],
      liveFares: liveFares ?? null,
    });
  } catch (err) {
    console.error('[fujin] Model API request failed', err instanceof Error ? err.message : err);
    return fallback(fullText, 'Could not reach Fujin AI right now — using the built-in planner.', voices, voicesDest, stateTravelers || 2, stateDestination, message, stateOrigin, liveFares, stateRouteOverride, stateKids, stateTier, statePriceHistory, food, checkedStatus, weather, cityVoices);
  }
}

export async function GET(req: NextRequest) {
  const provider = getProvider();
  const live = Boolean(provider);

  // Diagnostic: GET /api/fujin?diag=models lists the model IDs the active
  // provider key can use. Returns model IDs only — never the key.
  if (req.nextUrl.searchParams.get('diag') === 'models') {
    if (!provider) return NextResponse.json({ live: false, models: [], error: 'No AI provider key set' });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(`${provider.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${provider.apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id?: string }>;
        error?: { code?: string; message?: string };
      };
      if (!res.ok) {
        const detail = [json.error?.code, json.error?.message].filter(Boolean).join(': ') || `no details from ${provider.name} API`;
        return NextResponse.json({ live: false, models: [], error: `${res.status}: ${detail}` });
      }
      return NextResponse.json({
        live: true,
        provider: provider.name,
        models: (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string'),
      });
    } catch (err) {
      return NextResponse.json({ live: false, models: [], error: err instanceof Error ? err.message : 'request failed' });
    }
  }

  return NextResponse.json({
    live,
    label: provider
      ? `Fujin AI route ready. POST a message; live ${provider.name} replies when ${provider.name === 'Qwen' ? 'QWEN_API_KEY' : 'MODEL_API_KEY'} is set.`
      : 'Fujin AI route ready. POST a message; returns the built-in planner until QWEN_API_KEY or MODEL_API_KEY is set.',
  });
}
