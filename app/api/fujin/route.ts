import { NextRequest, NextResponse } from 'next/server';
import { askFujin, buildPlan, comparisonFor, KNOWN_DESTINATIONS } from '../../../lib/planner';

/**
 * Fujin AI — live Muse model, server-side only.
 * If MODEL_API_KEY is set, calls the Meta Model API (OpenAI-compatible)
 * at https://api.meta.ai/v1/chat/completions with model muse-spark-1.3
 * and returns the model's understanding as strict JSON (json_schema).
 * If no key is set, or the API call fails / times out / returns invalid
 * JSON, falls back to the built-in askFujin() demo logic and returns
 * live: false, clearly labeled. The chat never errors either way.
 * The key is never sent to the browser and never logged. Model API
 * errors are surfaced in the fallback label AND logged server-side so a
 * failed call can be diagnosed (status alone hides the cause).
 */

const MODEL_API = 'https://api.meta.ai/v1/chat/completions';
const MODEL = 'muse-spark-1.3';

// Price table built from the planner's comparison helper (2 travelers;
// scaled proportionally for other party sizes). Same numbers as the
// homepage comparison section and the plan cards — single source of
// truth, the model quotes only these numbers, never invented prices.
const PRICE_TABLE = [...KNOWN_DESTINATIONS, 'Other destinations']
  .map((d) => {
    const opts = buildPlan(d, 2, 3).options;
    const c = comparisonFor(d, 2);
    return `${d}: Cheapest $${opts[0].total.toLocaleString()} / Best value $${opts[1].total.toLocaleString()} (booking the same parts separately about $${c.separate.total.toLocaleString()}, save $${c.save.toLocaleString()}, ~${c.savePercent}%) / Premium $${opts[2].total.toLocaleString()}`;
  })
  .join('\n');

const SYSTEM_PROMPT = [
  'You are Fujin AI, a travel planner for FujinTrip, a one-stop tourism platform.',
  'You answer ONLY about travel: destinations, flights, hotels, cars, buses, taxis, cruises, sightseeing, trip plans, prices and booking help.',
  'For anything off-topic (general chat, news, politics, homework, coding, health, or anything not travel), politely decline in one short sentence and steer back to travel, asking where they want to go or what trip they are planning. Never answer off-topic questions even if asked directly, and never argue about the limit.',
  'For off-topic requests, return destination as an empty string, travelers as 2, reply as the short decline, missing as ["Destination"], and tips as [].',
  'Understand the traveller’s request in their own language and reply in that same language.',
  'Extract: destination, traveler count, dates, budget and travel pace.',
  'List anything missing as short questions in the missing array.',
  'PRICE COMPARISON — use ONLY these FujinTrip plan prices (planning estimates, per trip for 2 travelers; scale proportionally for other party sizes). Never invent any other price or fare. Always show the Best value total for the matched destination and compare it with booking the same parts separately, using the separate total and saving from the table below (about 13% more when booking separately). Best value is the recommended balance of quality and affordability. All prices are planning estimates, not live quotes.',
  'FujinTrip plan prices (2 travelers):\n' + PRICE_TABLE,
  'LOCAL TIPS — return 1-3 short tips in the tips array: what travelers often love about the destination and how to experience it like a local — eat where locals eat, local transport, neighborhood stays, local guides. FujinTrip’s approach: travel globally, act locally — global trip planning with local experiences. These are general travel knowledge; never invent named reviewers, quotes, or fake review scores.',
  'Reply with strict JSON only, no other text: {"destination": string, "travelers": number, "reply": string, "missing": string[], "tips": string[]}.',
  'If the destination is unclear, pick the closest match from: Kyoto, Bali, Santorini, St. George, Tacoma, Hilo. Default travelers to 2.',
].join(' ');

const FUJIN_SCHEMA = {
  type: 'object',
  properties: {
    destination: { type: 'string' },
    travelers: { type: 'number' },
    reply: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['destination', 'reply'],
  additionalProperties: false,
};

type FujinResult = { destination: string; travelers: number; reply: string; missing: string[]; tips: string[] };

function fallback(message: string, label: string) {
  const parsed = askFujin(message);
  return NextResponse.json({ live: false, label, ...parsed });
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
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const message = typeof raw.message === 'string' ? raw.message : '';

  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) {
    return fallback(
      message,
      'Fujin AI is offline — using the built-in planner. Connect the Muse API (MODEL_API_KEY) to switch on live AI.'
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res: Response;
    try {
      res = await fetch(MODEL_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: message },
          ],
          temperature: 0.3,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'fujin_trip', strict: false, schema: FUJIN_SCHEMA },
          },
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
      const detail = [json.error?.code, json.error?.message].filter(Boolean).join(': ') || 'no details from Model API';
      console.error('[fujin] Model API error', res.status, detail);
      return fallback(message, `Model API error (${res.status}): ${detail.slice(0, 200)} — using the built-in planner.`);
    }

    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson(content);
    if (!parsed) {
      console.error('[fujin] Model API returned unparseable content');
      return fallback(message, 'Fujin AI gave an unclear answer — using the built-in planner.');
    }

    return NextResponse.json({ live: true, label: 'Live Fujin AI (Muse).', ...parsed });
  } catch (err) {
    console.error('[fujin] Model API request failed', err instanceof Error ? err.message : err);
    return fallback(message, 'Could not reach Fujin AI right now — using the built-in planner.');
  }
}

export async function GET() {
  const live = Boolean(process.env.MODEL_API_KEY);
  return NextResponse.json({
    live,
    label: live
      ? 'Fujin AI route ready. POST a message; live Muse replies when MODEL_API_KEY is set.'
      : 'Fujin AI route ready. POST a message; returns the built-in planner until MODEL_API_KEY is set.',
  });
}
