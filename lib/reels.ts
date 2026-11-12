// Travelers' reels (community round, design §6) — types, validation,
// moderation and feed ordering. Pure functions (no fs, no fetch), so
// the client (composer) and the server (routes) share them.
//
// The rules that shape this module:
//  - No fake posts, reviews or reels ever. A post is user-posted content
//    or it does not exist; the feed starts empty and says so.
//  - A post carries its moderation state everywhere it is shown.
//  - The "Verified trip" badge is earned by a booked FujinTrip trip:
//    the composer attaches the post to a trip from the traveler's own
//    My Trips (marked booked). Without accounts, verification is
//    device-local — the server cannot check the booking — and the design
//    doc (files/reels-design.md) names server verification as the
//    accounts upgrade. The badge never appears on an unattached post,
//    and unbadged posts never appear on the trip-card strip.
//  - No aggregate star rating until at least 5 verified posts exist for
//    a route ("Not enough trips yet" below that) — a synthesized score
//    from 1 or 2 posts is fake social proof.
//  - The feed is ordered by recency + trip relevance, never by an
//    engagement algorithm. Likes and saves are shown; they do not rank.

export type ReelMediaKind = 'photo' | 'video';

export type ReelMedia = {
  id: string;
  kind: ReelMediaKind;
  url: string;
  // Where the bytes live — shown honestly in the composer ("stored on
  // this server for now" vs "stored in FujinTrip media storage").
  storage: 'local-dev' | 'spaces';
  alt: string;
  // Video only: length in seconds, checked in the browser before upload.
  durationSec?: number;
};

// Moderation states. A post is born 'pending_review' when the keyword
// filter flags it, 'published' when it passes (auto-publish for the
// feed, with a 24h review queue behind it), and 'strip' only after a
// human approves it for the trip-card strip — the highest-trust surface.
// A report moves a post to 'under_review' (hidden from the feed until a
// human looks). 'removed' is the traveler's own delete (or a rejected
// review): the share link then says the traveler removed it.
export type ReelModeration =
  | 'pending_review'
  | 'published'
  | 'strip'
  | 'under_review'
  | 'rejected'
  | 'removed';

export type ReelPost = {
  id: string;
  createdAt: string;
  // First name only — no accounts yet, so the poster gives the name the
  // post appears under. 1–30 chars, no URLs.
  author: string;
  // The trip the post belongs to (from the traveler's My Trips), or null
  // for a post with no booked trip. The route line + month are what the
  // badge shows; the trip id is what ties it to a real trip.
  tripId: string | null;
  tripLabel: string | null;
  destination: string;
  routeLine: string;
  month: number; // 1–12, the month the trip happened
  caption: string; // ≤ 280 chars
  // Optional 1–5 "worth it?" — overall, plus per city visited.
  overallRating?: number;
  ratings?: Record<string, number>;
  media: ReelMedia[];
  // Verified on this device: the trip is in the poster's My Trips and
  // marked booked. Server verification arrives with accounts.
  verified: boolean;
  verifiedNote: string;
  moderation: ReelModeration;
  moderationNote: string;
  likes: number;
  saves: number;
  reports: { reason: string; at: string }[];
  // Ownership without accounts: a random token returned once at
  // creation, kept in the poster's browser. PATCH/DELETE require it.
  // Never sent in a public response (see publicPost).
  posterToken: string;
};

export const REEL_REPORT_REASONS = ['Not a real trip', 'Misleading', 'Inappropriate', 'Spam / ad'] as const;
export type ReelReportReason = (typeof REEL_REPORT_REASONS)[number];

// Media limits, shown to the traveler BEFORE upload (design §6.2):
// up to 6 photos OR one video ≤ 60s. Photos ≤ 10 MB, video ≤ 100 MB.
export const REEL_LIMITS = {
  maxPhotos: 6,
  maxVideoSec: 60,
  maxPhotoBytes: 10 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxCaption: 280,
  maxAuthor: 30,
} as const;

export function validatePostInput(input: {
  author: unknown;
  destination: unknown;
  routeLine: unknown;
  month: unknown;
  caption: unknown;
  overallRating?: unknown;
  ratings?: unknown;
  media: ReelMedia[];
  tripId?: unknown;
  tripLabel?: unknown;
  verified?: unknown;
}): { ok: true; value: Omit<ReelPost, 'id' | 'createdAt' | 'moderation' | 'moderationNote' | 'likes' | 'saves' | 'reports' | 'posterToken'> } | { ok: false; error: string } {
  const author = typeof input.author === 'string' ? input.author.trim() : '';
  if (!author || author.length > REEL_LIMITS.maxAuthor) return { ok: false, error: 'Give a first name (up to 30 characters) for the post.' };
  if (/https?:\/\//i.test(author)) return { ok: false, error: 'The name cannot contain a link.' };
  const destination = typeof input.destination === 'string' ? input.destination.trim() : '';
  if (!destination || destination.length > 60) return { ok: false, error: 'Pick the destination this post is about.' };
  const routeLine = typeof input.routeLine === 'string' ? input.routeLine.trim() : '';
  if (!routeLine || routeLine.length > 200) return { ok: false, error: 'The trip route is missing — pick the trip this post belongs to.' };
  const month = typeof input.month === 'number' ? input.month : 0;
  if (month < 1 || month > 12) return { ok: false, error: 'Pick the month the trip happened.' };
  const caption = typeof input.caption === 'string' ? input.caption.trim() : '';
  if (!caption) return { ok: false, error: 'Write a caption — what should the next traveler know?' };
  if (caption.length > REEL_LIMITS.maxCaption) return { ok: false, error: `Caption is ${caption.length} characters — the limit is ${REEL_LIMITS.maxCaption}.` };
  const photos = input.media.filter((m) => m.kind === 'photo');
  const videos = input.media.filter((m) => m.kind === 'video');
  if (!input.media.length) return { ok: false, error: 'Add at least one photo or a short video.' };
  if (videos.length > 1) return { ok: false, error: 'One video per post — add photos for the rest.' };
  if (videos.length === 1 && photos.length > 0 && photos.length + 1 > REEL_LIMITS.maxPhotos) return { ok: false, error: `Up to ${REEL_LIMITS.maxPhotos} photos per post.` };
  if (photos.length > REEL_LIMITS.maxPhotos) return { ok: false, error: `Up to ${REEL_LIMITS.maxPhotos} photos per post.` };
  if (videos.length === 1 && typeof videos[0].durationSec === 'number' && videos[0].durationSec > REEL_LIMITS.maxVideoSec) {
    return { ok: false, error: `The video is over ${REEL_LIMITS.maxVideoSec} seconds — trim it to a short reel.` };
  }
  for (const m of input.media) {
    if (!m.url || typeof m.url !== 'string') return { ok: false, error: 'A photo or video did not upload — try again.' };
    if (typeof m.alt !== 'string' || m.alt.length > 200) return { ok: false, error: 'Alt text is missing or too long (200 characters).' };
  }
  let overallRating: number | undefined;
  if (typeof input.overallRating === 'number') {
    if (!Number.isInteger(input.overallRating) || input.overallRating < 1 || input.overallRating > 5) {
      return { ok: false, error: 'The "worth it?" rating is 1–5.' };
    }
    overallRating = input.overallRating;
  }
  let ratings: Record<string, number> | undefined;
  if (input.ratings && typeof input.ratings === 'object' && !Array.isArray(input.ratings)) {
    ratings = {};
    for (const [city, value] of Object.entries(input.ratings as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
        return { ok: false, error: `The rating for ${city} is 1–5.` };
      }
      ratings[city] = value;
    }
    if (!Object.keys(ratings).length) ratings = undefined;
  }
  const tripId = typeof input.tripId === 'string' && input.tripId ? input.tripId : null;
  const tripLabel = typeof input.tripLabel === 'string' && input.tripLabel ? input.tripLabel : null;
  const verified = input.verified === true && tripId !== null;
  return {
    ok: true,
    value: {
      author,
      tripId,
      tripLabel,
      destination,
      routeLine,
      month,
      caption,
      ...(overallRating !== undefined ? { overallRating } : {}),
      ...(ratings ? { ratings } : {}),
      media: input.media,
      verified,
      verifiedNote: verified
        ? 'Verified trip — attached to a trip in My Trips, marked booked on this device. Server verification arrives with accounts.'
        : 'Not a verified trip — this post is not attached to a booked FujinTrip trip.',
    },
  };
}

// --- Moderation -----------------------------------------------------------
// A basic keyword filter, NOT an AI model — it is labeled as such wherever
// it runs. It catches the obvious (profanity, hate, explicit, violence,
// links in the caption = likely spam) and sends anything it flags to the
// human review queue. A real AI moderation provider (e.g. OpenAI
// Moderation) is still to be connected — see files/reels-design.md.
// Passing the filter is not approval: the trip-card strip still needs a
// human, and any traveler can report any post.
const BLOCKED_WORDS = [
  // Profanity / hate (a starter list — the review queue is the backstop).
  'fuck', 'shit', 'bitch', 'bastard', 'damn', 'cunt', 'whore', 'slut',
  'nigger', 'faggot', 'dyke', 'retard', 'kike', 'chink', 'spic',
  'kill yourself', 'kys', 'porn', 'xxx', 'sex cam', 'escort service',
  'crypto giveaway', 'double your money', 'free bitcoin',
];

export function moderateCaption(caption: string, author: string): { flagged: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const text = `${author} ${caption}`.toLowerCase();
  for (const word of BLOCKED_WORDS) {
    if (text.includes(word)) {
      reasons.push(`contains "${word}"`);
      break; // one reason is enough to queue it; the human reads the rest
    }
  }
  if (/https?:\/\/\S+/i.test(caption)) reasons.push('contains a link');
  if (caption.length > 0 && caption === caption.toUpperCase() && /[A-Z]{6,}/.test(caption)) reasons.push('all-caps');
  return { flagged: reasons.length > 0, reasons };
}

// A report hides the post from the reporter immediately (client-side)
// and queues it for review. Three unreviewed reports auto-hide it from
// the feed for everyone until a human looks.
export const REPORTS_TO_HIDE = 3;

// --- Feed -----------------------------------------------------------------
export type FeedPost = ReelPost & { visible: boolean };

// The feed shows: published + strip posts (never pending, under_review,
// rejected or removed). Ordered by recency + trip relevance: posts for
// the destination the traveler is looking at come first, then newest.
// Likes and saves never rank.
export function feedFor(posts: ReelPost[], opts: { destination?: string; limit?: number; cursor?: string }): { posts: ReelPost[]; nextCursor: string | null; total: number } {
  const visible = posts.filter((p) => p.moderation === 'published' || p.moderation === 'strip');
  const dest = opts.destination?.trim().toLowerCase();
  const sorted = [...visible].sort((a, b) => {
    const aMatch = dest && a.destination.toLowerCase() === dest ? 0 : 1;
    const bMatch = dest && b.destination.toLowerCase() === dest ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
  });
  const limit = Math.min(20, Math.max(1, opts.limit ?? 10));
  let start = 0;
  if (opts.cursor) {
    const idx = sorted.findIndex((p) => p.id === opts.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = sorted.slice(start, start + limit);
  return {
    posts: page,
    nextCursor: start + limit < sorted.length ? page[page.length - 1].id : null,
    total: sorted.length,
  };
}

// The trip-card strip: only human-approved ('strip') posts attached to a
// VERIFIED trip on this route — the highest-trust surface. Never more
// than 6, newest first.
export function stripFor(posts: ReelPost[], destination: string, limit = 6): ReelPost[] {
  const dest = destination.trim().toLowerCase();
  return posts
    .filter((p) => p.moderation === 'strip' && p.verified && p.destination.toLowerCase() === dest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

// Aggregate "worth it?" for a route — only when at least 5 verified
// posts exist. Below that the UI says "Not enough trips yet".
export const MIN_VERIFIED_FOR_AVERAGE = 5;

export function routeAverage(posts: ReelPost[], destination: string): { count: number; average: number | null } {
  const dest = destination.trim().toLowerCase();
  const ratings = posts
    .filter((p) => p.verified && p.destination.toLowerCase() === dest && typeof p.overallRating === 'number')
    .map((p) => p.overallRating as number);
  if (ratings.length < MIN_VERIFIED_FOR_AVERAGE) return { count: ratings.length, average: null };
  const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  return { count: ratings.length, average: Math.round(avg * 10) / 10 };
}

// Open Graph preview for a shared post (design §6.2): the photo, the
// route line, the all-in "from $X total", "Planned with FujinTrip".
export function ogForPost(post: ReelPost, tripTotal: number | null): { title: string; description: string } {
  const total = tripTotal !== null ? ` · from $${tripTotal.toLocaleString()} total` : '';
  return {
    title: `${post.routeLine} — a trip by ${post.author}`,
    description: `${post.caption.slice(0, 120)}${post.caption.length > 120 ? '…' : ''} Planned with FujinTrip${total}.`,
  };
}

// The honest storage line shown in the composer when Spaces is not
// connected: the photo is stored, it is just stored on this server for
// now — never claimed to be in FujinTrip media storage.
export function spacesConfiguredMessage(): string {
  return 'Media storage (Spaces) is not connected yet — this upload is kept on this server for now. It is stored and visible; it moves to FujinTrip media storage when the keys are set.';
}

// The public view of a post: everything the feed, the strip and the
// share page may show. The poster's ownership token never leaves the
// server except in the one POST response that creates the post.
export function publicPost(post: ReelPost): Omit<ReelPost, 'posterToken'> {
  const { posterToken: _token, ...rest } = post as ReelPost & { posterToken?: string };
  void _token;
  return rest;
}
