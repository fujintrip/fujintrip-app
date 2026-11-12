import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { CITY_INFO } from '../../../lib/tripCard';
import { routeKeyForDestination } from '../../../lib/planner';
import {
  feedFor,
  moderateCaption,
  publicPost,
  routeAverage,
  stripFor,
  validatePostInput,
  type ReelMedia,
  type ReelPost,
} from '../../../lib/reels';
import { listPosts, newPostId, savePost } from '../../../lib/reelsStore';
import { clientIp, rateLimitOk } from '../../../lib/serverStore';

/**
 * GET /api/reels — the travelers' reels feed (community round, design §6).
 *
 * ?view=feed (default) — published + strip-approved posts, ordered by
 * recency + trip relevance (posts for ?destination= first), paginated
 * with ?cursor=. Likes and saves never rank.
 * ?view=strip&destination=X — the trip-card strip: human-approved
 * posts on verified trips for that route, plus the route's aggregate
 * "worth it?" (only when ≥5 verified posts — "Not enough trips yet"
 * below that).
 *
 * POST /api/reels — create a post. Body: the composer payload
 * (author, destination, routeLine, month, caption, ratings, media
 * uploaded first via /api/reels/upload, tripId/tripLabel for the
 * verified-trip badge). The caption runs through the keyword filter:
 * flagged posts go to the human review queue ('pending_review'), clean
 * ones auto-publish to the feed. Returns the public post + a one-time
 * posterToken (kept in the poster's browser for edit/delete).
 */
export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view') ?? 'feed';
  const destination = req.nextUrl.searchParams.get('destination') ?? '';
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 10);
  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
  const posts = await listPosts();
  if (view === 'strip') {
    if (!destination) return NextResponse.json({ message: 'Give a destination for the strip.' }, { status: 400 });
    return NextResponse.json({
      posts: stripFor(posts, destination).map(publicPost),
      average: routeAverage(posts, destination),
      moderation: 'strip posts are human-approved, on verified trips only',
    });
  }
  const page = feedFor(posts, { destination: destination || undefined, limit, cursor });
  return NextResponse.json({
    posts: page.posts.map(publicPost),
    nextCursor: page.nextCursor,
    total: page.total,
    storage: 'Posts are stored on this server. Media storage (Spaces) is connected when SPACES_KEY is set — otherwise uploads stay on this server.',
  });
}

export async function POST(req: NextRequest) {
  if (!rateLimitOk(`reels-post:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { message: 'Too many posts from this address just now — try again in a little while.' },
      { status: 429 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  // Media must be uploaded first: each descriptor carries a server
  // media id (local file or Spaces key) — a bare URL the client invented
  // is not accepted.
  const media = Array.isArray(raw.media) ? (raw.media as ReelMedia[]) : [];
  const checked = validatePostInput({
    author: raw.author,
    destination: raw.destination,
    routeLine: raw.routeLine,
    month: raw.month,
    caption: raw.caption,
    overallRating: raw.overallRating,
    ratings: raw.ratings,
    media,
    tripId: raw.tripId,
    tripLabel: raw.tripLabel,
    verified: raw.verified,
  });
  if (!checked.ok) return NextResponse.json({ message: checked.error }, { status: 400 });
  const destination = checked.value.destination;
  if (!CITY_INFO[destination] && !routeKeyForDestination(destination)) {
    return NextResponse.json({ message: `“${destination}” is not a destination FujinTrip knows — pick one from your trip.` }, { status: 400 });
  }
  const moderation = moderateCaption(checked.value.caption, checked.value.author);
  const post: ReelPost = {
    id: newPostId(),
    createdAt: new Date().toISOString(),
    ...checked.value,
    moderation: moderation.flagged ? 'pending_review' : 'published',
    moderationNote: moderation.flagged
      ? `Flagged by the keyword filter (${moderation.reasons.join('; ')}) — in the human review queue, not in the feed yet.`
      : 'Passed the keyword filter — published to the feed. A human reviews the queue within 24 hours.',
    likes: 0,
    saves: 0,
    reports: [],
    posterToken: randomBytes(16).toString('hex'),
  };
  await savePost(post);
  return NextResponse.json(
    {
      post: publicPost(post),
      posterToken: post.posterToken,
      note: moderation.flagged
        ? 'Your post is in the review queue — it appears in the feed once a human approves it.'
        : 'Your post is live in the feed.',
    },
    { status: 201 }
  );
}
