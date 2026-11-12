import { NextRequest, NextResponse } from 'next/server';
import { parseSnapshot } from '../../../lib/today';
import { getShare, newShareId, saveShare } from '../../../lib/planShareStore';
import { clientIp, rateLimitOk } from '../../../lib/serverStore';

/**
 * POST /api/plan-share — "Send this plan to my phone" (community round).
 *
 * Body: the plan snapshot (lib/today: v:1, destination, travelers, days,
 * month, origin, choice, card). Returns a short /plan/<id> link that
 * opens the same Today view on another device.
 *
 * This is a link, not account sync: the snapshot lives in data/ on this
 * server (see lib/serverStore — the container filesystem is ephemeral,
 * so a redeploy clears stored links). The link page says so. No
 * accounts, no sign-in, no payment.
 */
export async function POST(req: NextRequest) {
  if (!rateLimitOk(`plan-share:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { message: 'Too many share links from this address just now — try again in a little while.' },
      { status: 429 }
    );
  }
  const raw = await req.text().catch(() => '');
  const snapshot = parseSnapshot(raw);
  if (!snapshot) {
    return NextResponse.json({ message: 'That plan could not be read — build the plan again and try once more.' }, { status: 400 });
  }
  let id = newShareId();
  for (let tries = 0; tries < 5 && (await getShare(id)); tries++) id = newShareId();
  await saveShare(id, snapshot);
  return NextResponse.json({ id, url: `/plan/${id}` });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ message: 'Give a plan link id.' }, { status: 400 });
  const snapshot = await getShare(id);
  if (!snapshot) {
    return NextResponse.json(
      { message: 'This plan link is unknown — it may have been shared before a redeploy cleared stored links. Ask the traveler to send it again.' },
      { status: 404 }
    );
  }
  return NextResponse.json(snapshot);
}
