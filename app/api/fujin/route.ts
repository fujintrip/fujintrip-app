import { NextRequest, NextResponse } from 'next/server';
import { askFujin, buildPlan, comparisonFor, distributeNights, findMonth, isOffTopicMessage, KNOWN_DESTINATIONS, lastPlaceMentioned, optionsLine, parseDuration, routeKeyForDestination, ROUTE_STOPS } from '../../../lib/planner';
import { fetchLocalVoices, type LocalVoices } from '../../../lib/localVoices';
import { fetchLiveFares, faresPromptBlock, faresSummaryLine, type LiveFares } from '../../../lib/duffel';
import { suggestedStart } from '../../../lib/tripCard';

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
  'List anything missing as short questions in the missing array.',
  'PRICE COMPARISON — use ONLY these FujinTrip plan prices (planning estimates). The table gives a 1-traveler row AND a 2-traveler row for every destination: quote the row matching the traveler count EXACTLY. Never scale, multiply, divide, or compute a price yourself, and never use the 2-traveler row for 1 traveler. The plan totals (Cheapest / Best value / Premium) already INCLUDE flights, stays, transport between cities and activities — say so, and never break the total into parts that leave flights out. Always show the Best value total for the matched destination (for a destination not in the table, use the Other destinations row) and compare it with booking the same parts separately, using the separate total and saving from that same row (about 13% more when booking separately). Never compute a separate-booking total for Cheapest or Premium — the table gives a separate total only for Best value; if you show Cheapest or Premium, show only their totals. Best value is the recommended balance of quality and affordability. All prices are planning estimates, not live quotes — except the live fares in the LIVE FARES block (see below), which are real API prices.',
  'LIVE FARES — before the model runs, the server asks Duffel for the real fares for this exact trip (origin to the first city of the route, and back) on the trip\'s suggested dates, and appends them as a LIVE FARES block below. ONLY when a LIVE FARES block is present may you say fares are live — quote those fares as the flight prices, with the airline name and the price, and say they are live fares from Duffel (test fares in test mode). If NO LIVE FARES block is present, the flight prices are planning estimates from the price table — never write "live estimates via Duffel", never claim the flight prices come from Duffel, and never invent a fare. For the whole-trip totals, still use the price table (planning estimates) and say the flight inside the plan is estimated — the live fare may be lower.',
  'FujinTrip plan prices (1 traveler and 2 travelers):\n' + PRICE_TABLE,
  'LOCAL TIPS — return 1-3 short tips in the tips array: what travelers often love about the destination and how to experience it like a local — eat where locals eat, local transport, neighborhood stays, local guides. FujinTrip’s approach: travel globally, act locally — global trip planning with local experiences. These are general travel knowledge; never invent named reviewers, quotes, or fake review scores.',
  'Reply with strict JSON only, no other text: {"destination": string, "travelers": number, "reply": string, "missing": string[], "tips": string[], "kids": number[]}. The kids array holds the kids\' ages when the trip is a family trip (empty otherwise).',
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
  },
  required: ['destination', 'reply'],
  additionalProperties: false,
};

type FujinResult = { destination: string; travelers: number; reply: string; missing: string[]; tips: string[]; kids?: number[] };

// The live fetch needs a destination BEFORE the model runs, so guess it
// from the request: an explicit destination, or the last place named in
// the conversation (a known destination or a country from the route map).
// Anything else skips the fetch — the model still answers from its own
// knowledge.
function guessDestination(raw: Record<string, unknown>, message: string): string {
  if (typeof raw.destination === 'string' && raw.destination.trim()) return raw.destination.trim();
  return lastPlaceMentioned(message);
}

function fallback(message: string, label: string, voices?: LocalVoices, voicesDest = '', defaultTravelers = 2, contextDestination = '', currentMessage = '', contextOrigin = '', liveFares?: LiveFares | null) {
  const parsed = askFujin(message, defaultTravelers, contextDestination, currentMessage, contextOrigin);
  // A decline must stay a decline: the context-destination override below
  // would otherwise resurrect an off-topic message as a plan ("who will
  // win the election?" after an Egypt chat came back as an Egypt route).
  const declinedOffTopic = currentMessage ? isOffTopicMessage(currentMessage) : false;
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
  // The reply must carry real value: the 3 tier prices with a clear pick,
  // so the traveler can choose before asking for the plan. But NOT while
  // the conversation is still gathering details (guided flow): a reply
  // that asks one question ("How many days?") must not also dump three
  // prices — the prices arrive with the Trip Summary.
  if (destination && !parsed.needsMore) reply += `\n\n${optionsLine(destination, parsed.travelers)}`;
  // Even when the live model is down, fresh traveler material still helps —
  // but never on a decline, where it would read as an answer, and never on
  // a guided question, where a long excerpt would bury the one question.
  if (voices?.text && destination && !parsed.needsMore) reply += `\n\nFresh traveler notes: ${voices.text.slice(0, 400)}`;
  // Same for the live fares: the offline fallback quotes them too, so the
  // traveler still sees the real Duffel price when the model is down.
  if (liveFares?.live && destination && !parsed.needsMore && !declinedOffTopic) {
    reply += `\n\n${faresSummaryLine(liveFares)}`;
  }
  return NextResponse.json({
    live: false,
    label,
    ...parsed,
    destination,
    reply,
    missing,
    voices: voices?.text ?? '',
    voicesSource: voices?.source ?? '',
    voicesDestination: voicesDest,
    liveFares: liveFares ?? null,
  });
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

  // On-trip mode (feature 8): the traveler is already at the destination
  // and wants short, right-now local answers. The trip destination also
  // drives the live fetch below.
  const onTrip = typeof raw.tripContext === 'string' && raw.tripContext.trim() ? raw.tripContext.trim() : '';
  const voicesDest = onTrip || guessDestination(raw, fullText) || stateDestination;
  const voicesPromise: Promise<LocalVoices> = voicesDest
    ? fetchLocalVoices(voicesDest).catch(() => ({ text: '', source: '' }))
    : Promise.resolve({ text: '', source: '' });
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
    !onTrip && fareDestCity && stateOrigin && departDate && returnDate
      ? fetchLiveFares({
          origin: stateOrigin,
          destCity: fareDestCity,
          departDate: departDate.toISOString().slice(0, 10),
          returnDate: returnDate.toISOString().slice(0, 10),
          travelers: stateTravelers || 2,
        }).catch(() => null)
      : Promise.resolve(null);
  const [voices, liveFares] = await Promise.all([voicesPromise, faresPromise]);

  // System prompt for this request: base prompt + fresh traveler material
  // + on-trip framing when applicable.
  let systemPrompt = SYSTEM_PROMPT;
  if (voices.text) {
    systemPrompt +=
      ' LOCAL VOICES — fresh traveler material for this destination, fetched just now from traveler guides. Prefer naming the real places, dishes and tips from it in your reply and in tips. Never invent a reviewer name, quote, or review score; if a place in this material contradicts your own knowledge, trust the material. ' +
      voices.text;
  }
  if (liveFares?.live) {
    systemPrompt += ' ' + faresPromptBlock(liveFares);
  }
  if (onTrip) {
    systemPrompt += ` ON-TRIP MODE — the traveler is in ${onTrip} RIGHT NOW. Answer short and practical: where to eat tonight, what is open now, how to get there. Use the local voices material above for real places. Keep it to what helps right now, not a full plan.`;
  }
  if (stateDestination) {
    systemPrompt += ` TRIP SO FAR — the traveler is already planning this trip: destination ${stateDestination}, ${stateTravelers || 2} travelers${stateOrigin ? `, flying from ${stateOrigin}` : ''}${stateKids.length ? `, kids ages ${stateKids.join(', ')}` : ''}. Remember this across turns — do not ask for the destination, traveler count, or departure city again unless the traveler says it changed. If the current message changes the destination, party size, or origin, use the NEW one.`;
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
    const legs = distributeNights(routeKey, tripDays);
    systemPrompt += ` ROUTE NIGHTS — for ${voicesDest || stateDestination} over ${tripDays} days, the nights per city are EXACTLY: ${legs.map((l) => `${l.city} ${l.nights} nights`).join(', ')}. Use exactly these nights, in exactly this order, in every reply — never re-split them, never add filler days, and never change them on a later turn.`;
  }

  const provider = getProvider();
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
      liveFares
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
      return fallback(fullText, `${provider.name} API error (${res.status}): ${detail.slice(0, 200)} — using the built-in planner.`, voices, voicesDest, stateTravelers || 2, stateDestination, message, stateOrigin, liveFares);
    }

    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson(content);
    if (!parsed) {
      console.error('[fujin] Model API returned unparseable content');
      return fallback(fullText, 'Fujin AI gave an unclear answer — using the built-in planner.', voices, voicesDest, stateTravelers || 2, stateDestination, message, stateOrigin, liveFares);
    }

    return NextResponse.json({
      live: true,
      label: `Live Fujin AI (${provider.name}).`,
      ...parsed,
      voices: voices.text,
      voicesSource: voices.source,
      voicesDestination: voicesDest,
      liveFares: liveFares ?? null,
    });
  } catch (err) {
    console.error('[fujin] Model API request failed', err instanceof Error ? err.message : err);
    return fallback(fullText, 'Could not reach Fujin AI right now — using the built-in planner.', voices, voicesDest, stateTravelers || 2, stateDestination, message, stateOrigin, liveFares);
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
