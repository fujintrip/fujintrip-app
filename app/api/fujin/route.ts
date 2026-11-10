import { NextRequest, NextResponse } from 'next/server';
import { askFujin } from '../../../lib/planner';

/**
 * Fujin AI — live Muse model, server-side only.
 * If MODEL_API_KEY is set, calls the Meta Model API (OpenAI-compatible)
 * at https://api.meta.ai/v1/chat/completions with model muse-spark-1.3
 * and returns the model's understanding as strict JSON.
 * If no key is set, or the API call fails / times out / returns invalid
 * JSON, falls back to the built-in askFujin() demo logic and returns
 * live: false, clearly labeled. The chat never errors either way.
 * The key is never sent to the browser and never logged.
 */

const MODEL_API = 'https://api.meta.ai/v1/chat/completions';
const MODEL = 'muse-spark-1.3';

const SYSTEM_PROMPT = [
  'You are Fujin AI, a travel planner for FujinTrip, a one-stop tourism platform.',
  'You answer ONLY about travel: destinations, flights, hotels, cars, buses, taxis, cruises, sightseeing, trip plans, prices and booking help.',
  'For anything off-topic (general chat, news, politics, homework, coding, health, or anything not travel), politely decline in one short sentence and steer back to travel, asking where they want to go or what trip they are planning. Never answer off-topic questions even if asked directly, and never argue about the limit.',
  'For off-topic requests, return destination as an empty string, travelers as 2, reply as the short decline, and missing as ["Destination"].',
  'Understand the traveller’s request in their own language and reply in that same language.',
  'Extract: destination, traveler count, dates, budget and travel pace.',
  'List anything missing as short questions in the missing array.',
  'Never invent live fares or prices — prices come only from suppliers. Anything about cost is a labeled planning estimate.',
  'Reply with strict JSON only, no other text: {"destination": string, "travelers": number, "reply": string, "missing": string[]}.',
  'If the destination is unclear, pick the closest match from: Kyoto, Bali, Santorini, St. George, Tacoma, Hilo. Default travelers to 2.',
].join(' ');

type FujinResult = { destination: string; travelers: number; reply: string; missing: string[] };

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
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      return fallback(
        message,
        res.status === 401
          ? 'The Muse API key was rejected — check MODEL_API_KEY in DigitalOcean env vars.'
          : `Fujin AI could not be reached right now (${res.status}) — using the built-in planner.`
      );
    }

    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson(content);
    if (!parsed) {
      return fallback(message, 'Fujin AI gave an unclear answer — using the built-in planner.');
    }

    return NextResponse.json({ live: true, label: 'Live Fujin AI (Muse).', ...parsed });
  } catch {
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
