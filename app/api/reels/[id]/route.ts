import { NextRequest, NextResponse } from 'next/server';
import { moderateCaption, publicPost, REEL_LIMITS } from '../../../../lib/reels';
import { getPost, savePost } from '../../../../lib/reelsStore';

/**
 * GET /api/reels/<id> — one post, public fields only. A removed post
 * returns { removed: true } with no content — the share link then says
 * the traveler removed it, instead of 404ing like it never existed.
 *
 * PATCH /api/reels/<id> — the poster edits their caption. Requires the
 * posterToken returned at creation (kept in the poster's browser — no
 * accounts yet). The edited caption runs through the keyword filter
 * again: a newly-flagged edit goes back to the review queue.
 *
 * DELETE /api/reels/<id> — the poster deletes their post (same token).
 * Soft delete: the record stays with moderation 'removed' so the share
 * link can say the traveler removed it, and the post never appears in
 * the feed or the strip again.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ message: 'No post with that id.' }, { status: 404 });
  if (post.moderation === 'removed') {
    return NextResponse.json({ id: post.id, removed: true, message: 'This post was removed by its traveler.' });
  }
  return NextResponse.json({ post: publicPost(post) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ message: 'No post with that id.' }, { status: 404 });
  if (post.moderation === 'removed') return NextResponse.json({ message: 'This post was removed by its traveler.' }, { status: 410 });
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  if (typeof raw.posterToken !== 'string' || raw.posterToken !== post.posterToken) {
    return NextResponse.json({ message: 'Only the traveler who posted this can edit it.' }, { status: 403 });
  }
  const caption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
  if (!caption) return NextResponse.json({ message: 'Write a caption — what should the next traveler know?' }, { status: 400 });
  if (caption.length > REEL_LIMITS.maxCaption) {
    return NextResponse.json({ message: `Caption is ${caption.length} characters — the limit is ${REEL_LIMITS.maxCaption}.` }, { status: 400 });
  }
  const moderation = moderateCaption(caption, post.author);
  post.caption = caption;
  if (moderation.flagged) {
    post.moderation = 'pending_review';
    post.moderationNote = `Edited caption flagged by the keyword filter (${moderation.reasons.join('; ')}) — back in the human review queue.`;
  }
  await savePost(post);
  return NextResponse.json({ post: publicPost(post) });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ message: 'No post with that id.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  if (typeof raw.posterToken !== 'string' || raw.posterToken !== post.posterToken) {
    return NextResponse.json({ message: 'Only the traveler who posted this can delete it.' }, { status: 403 });
  }
  post.moderation = 'removed';
  post.moderationNote = 'Removed by its traveler.';
  await savePost(post);
  return NextResponse.json({ removed: true, message: 'Your post was removed everywhere, including shared links.' });
}
