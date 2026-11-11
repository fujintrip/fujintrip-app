import { NextRequest, NextResponse } from 'next/server';
import { askFujin, buildPlan, comparisonFor, KNOWN_DESTINATIONS } from '../../../lib/planner';

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
  'DESTINATION — accept ANY destination the traveler names: any city, country or region (for example Paris, Japan, Europe). Never decline a travel request because the destination is not in the list below. If they name a country or region instead of a city (for example Europe), accept it as the destination and ask which city they would like to start with — add that question to missing. Only return an empty destination for non-travel requests.',
  'Traveler count: "solo", "alone", "just me" or "1 traveler" means 1 traveler; "couple" means 2; otherwise use the number stated. Default to 2 only when nothing about party size is stated.',
  'List anything missing as short questions in the missing array.',
  'PRICE COMPARISON — use ONLY these FujinTrip plan prices (planning estimates, per trip for 2 travelers; scale proportionally for other party sizes). Never invent any other price or fare. Always show the Best value total for the matched destination (for a destination not in the table, use the Other destinations row) and compare it with booking the same parts separately, using the separate total and saving from the table below (about 13% more when booking separately). Best value is the recommended balance of quality and affordability. All prices are planning estimates, not live quotes.',
  'FujinTrip plan prices (2 travelers):\n' + PRICE_TABLE,
  'LOCAL TIPS — return 1-3 short tips in the tips array: what travelers often love about the destination and how to experience it like a local — eat where locals eat, local transport, neighborhood stays, local guides. FujinTrip’s approach: travel globally, act locally — global trip planning with local experiences. These are general travel knowledge; never invent named reviewers, quotes, or fake review scores.',
  'Reply with strict JSON only, no other text: {"destination": string, "travelers": number, "reply": string, "missing": string[], "tips": string[]}.',
  'If the destination is unclear, ask which city or country they mean — do not pick one of the listed destinations for them.',
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

  const provider = getProvider();
  if (!provider) {
    return fallback(
      message,
      'Fujin AI is offline — using the built-in planner. Connect an AI provider (QWEN_API_KEY or MODEL_API_KEY) to switch on live AI.'
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
            { role: 'system', content: SYSTEM_PROMPT },
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
      return fallback(message, `${provider.name} API error (${res.status}): ${detail.slice(0, 200)} — using the built-in planner.`);
    }

    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson(content);
    if (!parsed) {
      console.error('[fujin] Model API returned unparseable content');
      return fallback(message, 'Fujin AI gave an unclear answer — using the built-in planner.');
    }

    return NextResponse.json({ live: true, label: `Live Fujin AI (${provider.name}).`, ...parsed });
  } catch (err) {
    console.error('[fujin] Model API request failed', err instanceof Error ? err.message : err);
    return fallback(message, 'Could not reach Fujin AI right now — using the built-in planner.');
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
