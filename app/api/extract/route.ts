import { NextRequest, NextResponse } from 'next/server';
import { extractPlacesFromText, fetchUrlText } from '../../../lib/extract';

/**
 * POST /api/extract — Start Anywhere (competitor learning round 2 #6,
 * Mindtrip).
 *
 * Body: { url?: string, text?: string } — a link to a travel article
 * or a pasted block of text. Returns the trip the source describes:
 * destination + ordered stops, each with the sentence that named it
 * (the source tip, quoted verbatim), and the ordered cities ready for
 * a RouteOverride.
 *
 * Honest limits: a PDF or image link returns reason 'unreadable' with
 * no stops — the trip is never invented from an unreadable input.
 * Screenshots cannot be pasted at all; the client says so in the box.
 * A page with no place the app knows returns no stops with reason
 * 'no_places'. The text is capped so a huge paste cannot stall the
 * route.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 50000) : '';
  let sourceText = text;
  let source: 'url' | 'text' = 'text';
  if (url) {
    source = 'url';
    const fetched = await fetchUrlText(url);
    if (!fetched.ok) {
      return NextResponse.json({
        destination: '',
        stops: [],
        cities: [],
        source,
        sourceUrl: url,
        reason: fetched.reason,
        note:
          fetched.reason === 'unreadable'
            ? 'I can’t read screenshots or PDF files yet — paste a link to a web page, or paste the text of the article.'
            : fetched.reason === 'bad_url'
              ? 'That doesn’t look like a web link — paste a link starting with http:// or https://, or paste the text.'
              : 'I couldn’t load that page — check the link, or paste the text of the article instead.',
      });
    }
    sourceText = fetched.text;
  }
  if (!sourceText) {
    return NextResponse.json({
      destination: '',
      stops: [],
      cities: [],
      source,
      sourceUrl: url || undefined,
      reason: 'empty',
      note: 'Paste a link to a travel article, or paste the text naming the places you want to visit.',
    });
  }
  const trip = extractPlacesFromText(sourceText);
  return NextResponse.json({
    ...trip,
    source,
    sourceUrl: url || undefined,
    ...(trip.stops.length ? {} : { reason: 'no_places', note: 'I couldn’t find any places I know in that link or text — try a link to a travel article, or paste text naming the cities (for example Kyoto, Bangkok, Lisbon).' }),
  });
}
