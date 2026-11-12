// The human moderation queue (community round, design §6).
//
// Team-only surface: posts the keyword filter flagged, and posts
// travelers reported. A human approves (feed or the trip-card strip)
// or rejects. No accounts yet, so the auth note on the page is honest:
// if REELS_MOD_TOKEN is set, paste it here; if it is not set, actions
// still work and the page says so — restricting this before public
// launch is a blocker, not a detail (see files/reels-design.md).
'use client';
import { useCallback, useEffect, useState } from 'react';

type QueueItem = {
  id: string;
  createdAt: string;
  author: string;
  destination: string;
  routeLine: string;
  caption: string;
  verified: boolean;
  moderation: string;
  moderationNote: string;
  reports: { reason: string; at: string }[];
  media: { id: string; kind: string; url: string; alt: string }[];
};

export default function ReviewQueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [auth, setAuth] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/reels/review');
      const j = (await r.json()) as { queue: QueueItem[]; auth?: string };
      setQueue(j.queue ?? []);
      if (typeof j.auth === 'string') setAuth(j.auth);
    } catch {
      setMsg('Couldn’t load the queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'approve_feed' | 'approve_strip' | 'reject') => {
    setMsg('');
    try {
      const r = await fetch('/api/reels/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-reels-mod-token': token } : {}) },
        body: JSON.stringify({ id, action }),
      });
      const j = (await r.json()) as { message?: string };
      if (!r.ok) {
        setMsg(j.message ?? 'That action failed.');
        return;
      }
      setMsg(`Done — ${action.replace('_', ' ')}.`);
      void load();
    } catch {
      setMsg('Couldn’t reach the server.');
    }
  };

  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <h1 style={{ fontSize: 28 }}>Moderation queue</h1>
      <p className="plan-muted">
        Team-only: posts the keyword filter flagged, and posts travelers reported. Nothing here is public until a human approves it — and
        only verified-trip posts can go on the trip-card strip. Auth: {auth || 'loading…'}
      </p>
      <p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Team token (if REELS_MOD_TOKEN is set)"
          aria-label="Team token"
          type="password"
        />
      </p>
      {msg && <p style={{ fontSize: 13 }}>{msg}</p>}
      {loading && <p className="plan-note">Loading the queue…</p>}
      {!loading && queue.length === 0 && <p className="plan-note">The queue is empty — nothing is waiting for a human.</p>}
      {queue.map((q) => (
        <article key={q.id} className="reelcard" style={{ marginBottom: 16 }}>
          {q.media[0] &&
            (q.media[0].kind === 'video' ? (
              <video src={q.media[0].url} controls preload="metadata" playsInline aria-label={q.media[0].alt} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.media[0].url} alt={q.media[0].alt} loading="lazy" />
            ))}
          <div className="reel-body">
            <p className="reel-author">
              <strong>{q.author}</strong> {q.verified ? <span className="reel-badge">✓ Verified trip</span> : <span className="reel-unverified">Not a verified trip</span>}
            </p>
            <p className="plan-note">
              {q.routeLine} · {new Date(q.createdAt).toLocaleString()}
            </p>
            <p style={{ fontSize: 14 }}>{q.caption}</p>
            <p className="plan-note">
              {q.moderation} — {q.moderationNote}
            </p>
            {q.reports.length > 0 && (
              <p className="plan-note">
                Reports ({q.reports.length}): {q.reports.map((r) => r.reason).join(', ')}
              </p>
            )}
            <div className="reel-actions">
              <button className="ghost" onClick={() => void act(q.id, 'approve_feed')}>
                Approve for the feed
              </button>
              <button className="ghost" onClick={() => void act(q.id, 'approve_strip')}>
                Approve for the trip-card strip
              </button>
              <button className="ghost" onClick={() => void act(q.id, 'reject')}>
                Reject
              </button>
            </div>
          </div>
        </article>
      ))}
      <p>
        <a href="/reels">← All travelers’ reels</a>
      </p>
    </div>
  );
}
