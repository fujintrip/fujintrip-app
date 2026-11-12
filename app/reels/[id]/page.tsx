// One reel — the share target (community round, design §6.2).
//
// A shared post opens the post inside its trip: the photo, the route,
// the price, and the same "Plan this trip" button — never a login wall.
// The Open Graph card carries the photo, the route line and the all-in
// "from $X total", so a shared link looks like a trip, not a bare URL.
import { notFound } from 'next/navigation';
import { buildPlan } from '../../../lib/planner';
import { ogForPost } from '../../../lib/reels';
import { getPost } from '../../../lib/reelsStore';
import ReelCard from '../../../components/ReelCard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post || post.moderation === 'removed') {
    return { title: 'Post removed — FujinTrip' };
  }
  let total: number | null = null;
  try {
    total = buildPlan(post.destination, 2, 3).options[1].total;
  } catch {}
  const og = ogForPost(post, total);
  const image = post.media[0]?.url
    ? post.media[0].url.startsWith('http')
      ? post.media[0].url
      : `https://fujintrip.com${post.media[0].url}`
    : undefined;
  return {
    title: og.title,
    description: og.description,
    openGraph: {
      title: og.title,
      description: og.description,
      type: 'article',
      ...(image ? { images: [{ url: image, alt: post.media[0]?.alt ?? post.destination }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: og.title,
      description: og.description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function ReelPage({ params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) notFound();
  if (post.moderation === 'removed') {
    return (
      <div className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
        <h1 style={{ fontSize: 28 }}>This post was removed by its traveler</h1>
        <p className="plan-muted">The traveler deleted it — it is gone everywhere, including shared links.</p>
        <p>
          <a href="/reels">See travelers’ reels</a> · <a href="/">Plan a trip with FujinTrip</a>
        </p>
      </div>
    );
  }
  let total: number | null = null;
  try {
    total = buildPlan(post.destination, 2, 3).options[1].total;
  } catch {}
  // The strip and the feed never show pending/under_review posts, but a
  // shared link to one still opens — with its moderation state shown.
  const { posterToken: _token, ...publicPost } = post as typeof post & { posterToken?: string };
  void _token;
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <header style={{ marginBottom: 16 }}>
        <div className="logo">
          Fujin<span>Trip</span>
        </div>
      </header>
      <ReelCard post={publicPost} showModeration />
      <div style={{ marginTop: 20, border: '1px solid var(--line)', borderRadius: 16, padding: 16 }}>
        <p style={{ fontSize: 15, margin: '0 0 4px' }}>
          <strong>{post.routeLine}</strong>
        </p>
        {total !== null && (
          <p className="plan-line">
            From ${total.toLocaleString()} total · Best value · 2 travelers · 3 days · planning estimate
          </p>
        )}
        <p style={{ marginTop: 12 }}>
          <a className="hero-cta" href={`/?plan=${encodeURIComponent(post.destination)}`}>
            Plan this trip with Fujin AI
          </a>
        </p>
        <p className="plan-note">One booking, one price — flights, hotels, cars and sightseeing, all with FujinTrip. No account needed to view this post.</p>
      </div>
      <p style={{ marginTop: 24 }}>
        <a href="/reels">← All travelers’ reels</a>
      </p>
    </div>
  );
}
