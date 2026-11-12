// The travelers' reels feed (community round, design §6).
//
// A vertical feed, photo-first, video plays on tap (never autoplay
// with sound). Filterable by destination. Paginated — no infinite
// scroll without a footer. Ordered by recency + trip relevance, never
// by engagement. Reported posts are hidden on this device.
// The feed starts empty and says so honestly — an empty feed is better
// than a fake one.
'use client';
import { useCallback, useEffect, useState } from 'react';
import ReelCard, { type PublicReelPost } from './ReelCard';

function storedIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export default function ReelsFeed({ destination, onPost }: { destination?: string; onPost?: () => void }) {
  const [posts, setPosts] = useState<PublicReelPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState(destination ?? '');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState('');
  const [storageNote, setStorageNote] = useState('');

  const load = useCallback(async (dest: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: '10' });
    if (dest) params.set('destination', dest);
    if (cursor) params.set('cursor', cursor);
    const r = await fetch(`/api/reels?${params.toString()}`);
    const j = await r.json();
    if (!r.ok) throw new Error(typeof j.message === 'string' ? j.message : 'Couldn’t load the reels.');
    return j as { posts: PublicReelPost[]; nextCursor: string | null; total: number; storage?: string };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const j = await load(filter);
      const reported = storedIds('fujin-reel-reported');
      setPosts(j.posts.filter((p) => !reported.includes(p.id)));
      setNextCursor(j.nextCursor);
      setTotal(j.total);
      if (j.storage) setStorageNote(j.storage);
    } catch {
      setNotice('Couldn’t load the reels right now — try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [filter, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const j = await load(filter, nextCursor);
      const reported = storedIds('fujin-reel-reported');
      setPosts((prev) => [...prev, ...j.posts.filter((p) => !reported.includes(p.id) && !prev.some((x) => x.id === p.id))]);
      setNextCursor(j.nextCursor);
    } catch {
      setNotice('Couldn’t load more reels right now.');
    } finally {
      setLoadingMore(false);
    }
  };

  const removeFromFeed = (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  const destinations = [...new Set(posts.map((p) => p.destination))].sort();

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter reels by destination">
          <option value="">All destinations</option>
          {destinations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          {filter && !destinations.includes(filter) && <option value={filter}>{filter}</option>}
        </select>
        <button className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {notice && <p className="plan-note">{notice}</p>}
      {loading && <p className="plan-note">Loading travelers’ reels…</p>}
      {!loading && posts.length === 0 && (
        <div className="reel-empty">
          <p>
            <strong>No reels yet{filter ? ` from ${filter}` : ''}.</strong>
          </p>
          <p className="plan-note">The first reels will appear here once travelers share their trips — nothing here is invented, and nothing is shown until a real traveler posts it.</p>
          {onPost && (
            <button className="primary" onClick={onPost}>
              Share the first reel
            </button>
          )}
        </div>
      )}
      <div className="reels-grid">
        {posts.map((p) => (
          <ReelCard key={p.id} post={p} onRemoved={removeFromFeed} />
        ))}
      </div>
      {!loading && posts.length > 0 && (
        <p className="plan-note" style={{ marginTop: 12 }}>
          {total} reel{total === 1 ? '' : 's'} · newest first · likes never decide the order.
        </p>
      )}
      {nextCursor && (
        <p style={{ marginTop: 12 }}>
          <button className="ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more reels'}
          </button>
        </p>
      )}
      {storageNote && <p className="plan-note">{storageNote}</p>}
    </div>
  );
}
