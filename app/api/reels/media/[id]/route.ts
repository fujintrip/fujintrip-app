import { NextRequest, NextResponse } from 'next/server';
import { readUploadFile } from '../../../../../lib/serverStore';

/**
 * GET /api/reels/media/<id> — serves media stored on this server
 * (the local-dev fallback when Spaces is not configured). Media stored
 * in Spaces is served straight from the bucket by its public URL and
 * never comes through here. Immutable content: cached for a year.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const file = await readUploadFile(params.id);
  if (!file) {
    return NextResponse.json(
      { message: 'This media is not stored on this server — it may live in FujinTrip media storage (Spaces) or have been removed.' },
      { status: 404 }
    );
  }
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': file.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(file.buffer.length),
    },
  });
}
