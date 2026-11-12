import { NextRequest, NextResponse } from 'next/server';
import { REPORTS_TO_HIDE, REEL_REPORT_REASONS } from '../../../../../lib/reels';
import { getPost, savePost } from '../../../../../lib/reelsStore';

/**
 * POST /api/reels/<id>/report — flag a post (community round, design §6).
 *
 * Body: { reason } — one of "Not a real trip", "Misleading",
 * "Inappropriate", "Spam / ad". A report hides the post from the
 * reporter immediately (the client records the id in localStorage);
 * the server counts it, and ${REPORTS_TO_HIDE} unreviewed reports
 * auto-hide the post from the feed for everyone until a human reviews
 * it ('under_review'). The reporter gets a one-line confirmation.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ message: 'No post with that id.' }, { status: 404 });
  if (post.moderation === 'removed') return NextResponse.json({ message: 'This post was removed by its traveler.' }, { status: 410 });
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const reason = typeof raw.reason === 'string' ? raw.reason : '';
  if (!(REEL_REPORT_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json({ message: 'Pick a reason for the report.' }, { status: 400 });
  }
  post.reports.push({ reason, at: new Date().toISOString() });
  let hidden = false;
  if (post.reports.length >= REPORTS_TO_HIDE && (post.moderation === 'published' || post.moderation === 'strip')) {
    post.moderation = 'under_review';
    post.moderationNote = `${post.reports.length} travelers reported this post — hidden from the feed until a human reviews it.`;
    hidden = true;
  }
  await savePost(post);
  return NextResponse.json({
    reported: true,
    hidden,
    message: hidden
      ? 'Thanks — this post is hidden from the feed until the FujinTrip team reviews it.'
      : 'Thanks — your report is in the review queue.',
  });
}
