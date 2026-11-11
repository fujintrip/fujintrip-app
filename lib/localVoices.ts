/**
 * Local Voices — live fetch of fresh traveler material for a destination,
 * fed to Fujin AI as context when it builds a plan.
 *
 * Sources:
 *  - Wikivoyage (traveler-written guide, free MediaWiki API, no key) —
 *    the reliable backbone: the Eat / Drink / Do / See / Buy / Nightlife
 *    sections of the destination's guide page. Validated working from
 *    this server (Kyoto: Do=26, Eat=38, Drink=43).
 *  - Reddit search JSON (BEST-EFFORT ONLY): www.reddit.com returns 403
 *    and old.reddit.com redirects to a login page from this server, so
 *    it usually returns nothing and is skipped silently. Real Reddit
 *    threads would need Reddit API credentials (OAuth app) — a later step.
 *
 * Results are cached 24h per destination and the whole fetch is capped
 * at ~4s so a slow source never holds up the chat reply. On any failure
 * the function returns empty text and the model answers from its own
 * knowledge — a fetch failure never breaks the chat.
 * The model is told to prefer naming real places/dishes from this
 * material and never to invent reviewer names, quotes, or review scores.
 */

const UA = 'FujinTrip/1.0 (fujintrip.com; local-voices)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_BUDGET_MS = 4000;

export type LocalVoices = { text: string; source: string };

const cache = new Map<string, { at: number; voices: LocalVoices }>();

// An empty result is never cached for long: a transient failure
// (Wikivoyage throttling the shared IP, a slow network, the 4s budget
// expiring under burst load) must not hide traveler notes for 24 hours.
// Real results cache 24h; empty results are not cached at all, so the
// next message retries the fetch right away. Verified Nov 11: the old
// code cached empty results for 24h, so one throttled fetch poisoned
// Kyoto voices for the rest of the day (3/69 campaign failures).

// Travel subreddit per featured destination; anything else uses r/travel.
const SUBREDDITS: Record<string, string> = {
  Kyoto: 'JapanTravel',
  Bali: 'bali',
  Santorini: 'GreeceTravel',
  'St. George': 'Utah',
  Tacoma: 'Tacoma',
  Hilo: 'Hawaii',
};

const WANTED_SECTIONS = /^(eat|drink|do|see|buy|nightlife)$/i;

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[0-9]+\]/g, '')
    // Edit-section links survive tag-stripping as "[ edit | edit source ]"
    // with unpredictable spacing (each stripped tag leaves a space), so
    // match with flexible whitespace.
    .replace(/\[\s*edit\s*\|\s*edit source\s*\]/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson(url: string, ms: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type TocSection = { line?: unknown; index?: unknown };

async function wikivoyage(destination: string): Promise<string[]> {
  const api = 'https://en.wikivoyage.org/w/api.php';
  const page = encodeURIComponent(destination);
  const toc = (await fetchJson(
    `${api}?action=parse&page=${page}&prop=tocdata&format=json&formatversion=2`,
    2000
  )) as { parse?: { tocdata?: { sections?: TocSection[] } } } | null;
  const sections = toc?.parse?.tocdata?.sections ?? [];
  const wanted = sections.filter(
    (s): s is { line: string; index: string } =>
      typeof s.line === 'string' && typeof s.index === 'string' && WANTED_SECTIONS.test(s.line.trim())
  );
  // Eat / Drink / Do first — they carry the local food and experience
  // detail the AI needs most; See / Buy fill the remaining slots.
  const priority: Record<string, number> = { eat: 0, drink: 1, do: 2, nightlife: 3, see: 4, buy: 5 };
  wanted.sort((a, b) => (priority[a.line.trim().toLowerCase()] ?? 9) - (priority[b.line.trim().toLowerCase()] ?? 9));
  // Sections in parallel — sequential fetches blew the 4s budget.
  const results = await Promise.all(
    wanted.slice(0, 4).map(async (s) => {
      const data = (await fetchJson(
        `${api}?action=parse&page=${page}&section=${s.index}&prop=text&format=json&formatversion=2`,
        2000
      )) as { parse?: { text?: unknown } } | null;
      const text = typeof data?.parse?.text === 'string' ? stripHtml(data.parse.text) : '';
      return text.length > 120 ? `${s.line}: ${text.slice(0, 900)}` : '';
    })
  );
  return results.filter(Boolean);
}

async function reddit(destination: string): Promise<string[]> {
  const sub = SUBREDDITS[destination] ?? 'travel';
  const q = encodeURIComponent(`${destination} where locals eat best food tips`);
  const data = (await fetchJson(
    `https://www.reddit.com/r/${sub}/search.json?q=${q}&restrict_sr=1&sort=top&limit=3&t=year`,
    2000
  )) as { data?: { children?: Array<{ data?: { title?: unknown } }> } } | null;
  const posts = data?.data?.children ?? [];
  return posts
    .map((p) => (typeof p.data?.title === 'string' ? p.data.title : ''))
    .filter((t) => t.length > 0)
    .slice(0, 3)
    .map((t) => `Reddit r/${sub}: "${t}"`);
}

export async function fetchLocalVoices(destination: string): Promise<LocalVoices> {
  const key = destination.trim().toLowerCase();
  if (!key) return { text: '', source: '' };
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.voices;

  const work = (async (): Promise<LocalVoices> => {
    const [guide, threads] = await Promise.all([
      wikivoyage(destination).catch(() => [] as string[]),
      reddit(destination).catch(() => [] as string[]),
    ]);
    const parts = [...guide, ...threads].filter(Boolean);
    if (!parts.length) return { text: '', source: '' };
    return {
      text: `Fresh traveler material for ${destination}:\n${parts.join('\n').slice(0, 3000)}`,
      source:
        'Wikivoyage traveler guide, fetched live' + (threads.length ? ' + Reddit traveler threads' : ''),
    };
  })();

  const voices = await Promise.race([
    work,
    new Promise<LocalVoices>((resolve) => setTimeout(() => resolve({ text: '', source: '' }), FETCH_BUDGET_MS)),
  ]).catch(() => ({ text: '', source: '' } as LocalVoices));
  // Cache only real results — see the note above the cache declaration.
  if (voices.text) cache.set(key, { at: Date.now(), voices });
  return voices;
}
