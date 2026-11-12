import { NextRequest, NextResponse } from 'next/server';
import { getPost, savePost } from '../../../../../lib/reelsStore';

/**
 * POST /api/reels/<id>/react — a like or a save (community round).
 *
 * Body: { kind: 'like' | 'save', action: 'add' | 'remove' }.
 * A soft count, honestly: without accounts the server cannot know who
 * liked what, so the client dedupes by device (localStorage) and the
 * server just moves the counter. Likes and saves are shown on the card
 * but never rank the feed.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ message: 'No post with that id.' }, { status: 404 });
  if (post.moderation === 'removed') return NextResponse.json({ message: 'This post was removed by its traveler.' }, { status: 410 });
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const kind = raw.kind === 'like' || raw.kind === 'save' ? raw.kind : '';
  const action = raw.action === 'add' || raw.action === 'remove' ? raw.action : '';
  if (!kind || !action) return NextResponse.json({ message: 'Give kind (like/save) and action (add/remove).' }, { status: 400 });
  const delta = action === 'add' ? 1 : -1;
  if (kind === 'like') post.likes = Math.max(0, post.likes + delta);
  else post.saves = Math.max(0, post.saves + delta);
  await savePost(post);
  return NextResponse.json({ likes: post.likes, saves: post.saves });
}
