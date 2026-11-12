// "Travelers from this trip" — the strip on the trip card and the
// destination pages (community round, design §6.2).
//
// Only human-approved posts on VERIFIED trips appear here — the
// highest-trust surface in the app. The aggregate "worth it?" shows
// only when at least 5 verified posts exist for the route; below that
// the strip says "Not enough trips yet" and shows the count. An empty
// strip is an honest invitation, not a gap filled with invented posts.
'use client';
import { useCallback, useEffect, useState } from 'react';
import ReelCard, { type PublicReelPost } from './ReelCard';

export default function ReelsStrip({ destination, onPost }: { destination: string; onPost?: () => void }) {
  const [posts, setPosts] = useState<PublicReelPost[]>([]);
  const [average, setAverage] = useState<{ count: number; average: number | null }>({ count: 0, average: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/reels?view=strip&destination=${encodeURIComponent(destination)}`);
      const j = (await r.json()) as { posts: PublicReelPost[]; average: { count: number; average: number | null } };
      setPosts(r.ok ? j.posts : []);
      setAverage(r.ok ? j.average : { count: 0, average: null });
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [destination]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="plan-note">Loading travelers from this trip…</p>;

  return (
    <div>
      <p style={{ fontSize: 14, margin: '4px 0' }}>
        <strong>Travelers from this trip</strong>
      </p>
      {average.average !== null ? (
        <p className="plan-line">
          Worth it? {'★'.repeat(Math.round(average.average))}{'☆'.repeat(5 - Math.round(average.average))} {average.average}/5 — from {average.count} verified trips.
        </p>
      ) : (
        <p className="plan-note">
          {average.count > 0
            ? `Not enough trips yet for an average — ${average.count} verified post${average.count === 1 ? '' : 's'} from this trip so far (5 needed).`
            : 'No verified trips posted from this route yet — the first traveler to share makes this strip real.'}
        </p>
      )}
      {posts.length === 0 ? (
        <div className="reel-empty">
          <p className="plan-note">No reels from this trip yet — be the first to share how it went.</p>
          {onPost && (
            <button className="primary" onClick={onPost}>
              Share how it went
            </button>
          )}
        </div>
      ) : (
        <div className="reels-strip">
          {posts.map((p) => (
            <ReelCard key={p.id} post={p} compact onRemoved={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}
