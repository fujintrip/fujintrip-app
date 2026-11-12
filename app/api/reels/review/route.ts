import { NextRequest, NextResponse } from 'next/server';
import { getPost, listPosts, savePost } from '../../../../lib/reelsStore';

/**
 * GET /api/reels/review — the human moderation queue (community round,
 * design §6): posts waiting for a human (pending_review from the
 * keyword filter, under_review from reports) plus their report counts.
 *
 * POST /api/reels/review — one review action:
 * { id, action: 'approve_feed' | 'approve_strip' | 'reject' }.
 * 'approve_strip' is the only way a post reaches the trip-card strip.
 *
 * AUTH GAP, stated plainly: there are no accounts yet, so this route
 * has no real auth. If REELS_MOD_TOKEN is set in the environment, the
 * request must carry it as x-reels-mod-token. If it is NOT set (this
 * environment), the route still works and the response says
 * auth: 'not_configured' — restricting it before public launch is a
 * launch blocker (see files/reels-design.md). Every action is written
 * onto the post's moderationNote, so the queue keeps its own audit trail.
 */
const ACTIONS = ['approve_feed', 'approve_strip', 'reject'] as const;

export async function GET() {
  const posts = await listPosts();
  const queue = posts
    .filter((p) => p.moderation === 'pending_review' || p.moderation === 'under_review')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      author: p.author,
      destination: p.destination,
      routeLine: p.routeLine,
      caption: p.caption,
      verified: p.verified,
      moderation: p.moderation,
      moderationNote: p.moderationNote,
      reports: p.reports,
      media: p.media.map((m) => ({ id: m.id, kind: m.kind, url: m.url, alt: m.alt })),
    }));
  return NextResponse.json({
    queue,
    auth: process.env.REELS_MOD_TOKEN ? 'token' : 'not_configured — set REELS_MOD_TOKEN before public launch',
  });
}

export async function POST(req: NextRequest) {
  const token = process.env.REELS_MOD_TOKEN;
  if (token) {
    const given = req.headers.get('x-reels-mod-token') ?? '';
    if (given !== token) {
      return NextResponse.json({ message: 'Review actions need the team token.' }, { status: 401 });
    }
  }
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const action = typeof raw.action === 'string' ? raw.action : '';
  if (!id || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ message: 'Give a post id and an action: approve_feed, approve_strip or reject.' }, { status: 400 });
  }
  const post = await getPost(id);
  if (!post) return NextResponse.json({ message: 'No post with that id.' }, { status: 404 });
  if (post.moderation === 'removed') return NextResponse.json({ message: 'This post was removed by its traveler.' }, { status: 410 });
  if (action === 'approve_feed') {
    post.moderation = 'published';
    post.moderationNote = 'Approved for the feed by a human review.';
  } else if (action === 'approve_strip') {
    if (!post.verified) {
      return NextResponse.json({ message: 'Only posts on a verified trip can go on the trip-card strip.' }, { status: 400 });
    }
    post.moderation = 'strip';
    post.moderationNote = 'Approved for the trip-card strip by a human review.';
  } else {
    post.moderation = 'rejected';
    post.moderationNote = 'Rejected by a human review — it never appears in the feed.';
  }
  await savePost(post);
  return NextResponse.json({
    id: post.id,
    moderation: post.moderation,
    auth: token ? 'token' : 'not_configured',
  });
}
