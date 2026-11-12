// A traveler's reel card (community round, design §6).
//
// What it shows, and what it never invents:
//  - the traveler's own photo/video, caption and "worth it?" ratings;
//  - the "Verified trip" badge ONLY when the post is attached to a
//    booked FujinTrip trip (device-local verification — see lib/reels);
//  - its moderation state when the viewer is the poster or a reviewer;
//  - like/save counts (soft counts — no accounts yet) and a share menu
//    whose link lands on the post inside its trip, never a login wall;
//  - a report path on every post.
'use client';
import { useEffect, useState } from 'react';
import { MONTH_NAMES } from '../lib/planner';

export type PublicReelPost = {
  id: string;
  createdAt: string;
  author: string;
  tripId: string | null;
  tripLabel: string | null;
  destination: string;
  routeLine: string;
  month: number;
  caption: string;
  overallRating?: number;
  ratings?: Record<string, number>;
  media: { id: string; kind: 'photo' | 'video'; url: string; storage: 'local-dev' | 'spaces'; alt: string; durationSec?: number }[];
  verified: boolean;
  verifiedNote: string;
  moderation: string;
  moderationNote: string;
  likes: number;
  saves: number;
};

const REPORT_REASONS = ['Not a real trip', 'Misleading', 'Inappropriate', 'Spam / ad'];
const MONTHS = MONTH_NAMES;

function storedIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function storeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {}
}

export default function ReelCard({
  post,
  compact = false,
  showModeration = false,
  onRemoved,
}: {
  post: PublicReelPost;
  compact?: boolean;
  showModeration?: boolean;
  onRemoved?: (id: string) => void;
}) {
  const [mediaIdx, setMediaIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [likes, setLikes] = useState(post.likes);
  const [saves, setSaves] = useState(post.saves);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportMsg, setReportMsg] = useState('');
  const [reported, setReported] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editCaption, setEditCaption] = useState(post.caption);
  const [editMsg, setEditMsg] = useState('');
  const [mediaFailed, setMediaFailed] = useState(false);
  // Ownership is device-local (the poster token lives in this browser).
  // Read after mount so the server render and the first client render
  // agree — otherwise hydration mismatches on the Edit/Delete buttons.
  const [isMine, setIsMine] = useState(false);

  useEffect(() => {
    setLiked(storedIds('fujin-reel-liked').includes(post.id));
    setSaved(storedIds('fujin-reel-saved').includes(post.id));
    setReported(storedIds('fujin-reel-reported').includes(post.id));
    try {
      setIsMine(localStorage.getItem(`fujin-reel-token:${post.id}`) != null);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  if (reported) {
    return (
      <article className="reelcard" aria-label="Reported post">
        <p className="plan-note">You reported this post — it is hidden from you and in the review queue.</p>
      </article>
    );
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/reels/${post.id}` : `/reels/${post.id}`;
  const media = post.media[mediaIdx];

  const react = async (kind: 'like' | 'save') => {
    const key = kind === 'like' ? 'fujin-reel-liked' : 'fujin-reel-saved';
    const on = kind === 'like' ? liked : saved;
    const ids = storedIds(key);
    const next = on ? ids.filter((i) => i !== post.id) : [...new Set([...ids, post.id])];
    storeIds(key, next);
    if (kind === 'like') setLiked(!on);
    else setSaved(!on);
    try {
      const r = await fetch(`/api/reels/${post.id}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, action: on ? 'remove' : 'add' }),
      });
      const j = (await r.json()) as { likes?: number; saves?: number };
      if (typeof j.likes === 'number') setLikes(j.likes);
      if (typeof j.saves === 'number') setSaves(j.saves);
    } catch {}
  };

  const shareNative = async () => {
    const text = `${post.routeLine} — a trip by ${post.author} (Planned with FujinTrip)`;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: text, text: post.caption, url: shareUrl });
        return;
      } catch {}
    }
    setShareOpen((o) => !o);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMsg('Link copied.');
    } catch {
      setShareMsg(`Copy this link: ${shareUrl}`);
    }
  };

  const report = async () => {
    try {
      const r = await fetch(`/api/reels/${post.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reportReason }),
      });
      const j = (await r.json()) as { message?: string };
      if (r.ok) {
        storeIds('fujin-reel-reported', [...new Set([...storedIds('fujin-reel-reported'), post.id])]);
        setReported(true);
        setReportMsg(j.message ?? 'Thanks — your report is in the review queue.');
      } else {
        setReportMsg(j.message ?? 'Couldn’t send the report right now.');
      }
    } catch {
      setReportMsg('Couldn’t reach the server to send the report.');
    }
  };

  const saveEdit = async () => {
    const token = (() => {
      try {
        return localStorage.getItem(`fujin-reel-token:${post.id}`);
      } catch {
        return null;
      }
    })();
    if (!token) return;
    try {
      const r = await fetch(`/api/reels/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posterToken: token, caption: editCaption.trim() }),
      });
      const j = (await r.json()) as { post?: PublicReelPost; message?: string };
      if (r.ok && j.post) {
        setEditing(false);
        setEditMsg('Caption updated.');
        // The parent re-fetches the feed; this card shows the new text now.
        post.caption = j.post.caption;
      } else {
        setEditMsg(j.message ?? 'Couldn’t save the caption.');
      }
    } catch {
      setEditMsg('Couldn’t reach the server.');
    }
  };

  const removePost = async () => {
    const token = (() => {
      try {
        return localStorage.getItem(`fujin-reel-token:${post.id}`);
      } catch {
        return null;
      }
    })();
    if (!token) return;
    if (!window.confirm('Delete this post? It disappears everywhere, including shared links.')) return;
    try {
      const r = await fetch(`/api/reels/${post.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posterToken: token }),
      });
      if (r.ok) {
        try {
          localStorage.removeItem(`fujin-reel-token:${post.id}`);
        } catch {}
        onRemoved?.(post.id);
      } else {
        setEditMsg('Couldn’t delete the post right now.');
      }
    } catch {
      setEditMsg('Couldn’t reach the server.');
    }
  };

  return (
    <article className={`reelcard${compact ? ' compact' : ''}`}>
      {media && !mediaFailed ? (
        media.kind === 'video' ? (
          <video
            src={media.url}
            controls
            preload="metadata"
            playsInline
            aria-label={media.alt}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.url} alt={media.alt} loading="lazy" onError={() => setMediaFailed(true)} />
        )
      ) : (
        <div className="reel-media-fallback" role="img" aria-label={media?.alt ?? post.destination}>
          {post.destination}
        </div>
      )}
      {post.media.length > 1 && (
        <div className="reel-thumbs" role="group" aria-label="More photos from this post">
          {post.media.map((m, i) => (
            <button key={m.id} type="button" className={i === mediaIdx ? 'selected' : ''} aria-pressed={i === mediaIdx} onClick={() => setMediaIdx(i)}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="reel-body">
        <p className="reel-author">
          <strong>{post.author}</strong>
          {post.verified ? (
            <span className="reel-badge" title={post.verifiedNote}>
              ✓ Verified trip · {post.routeLine} · {MONTHS[post.month - 1]}
            </span>
          ) : (
            <span className="reel-unverified" title={post.verifiedNote}>
              Traveler post — not a verified trip
            </span>
          )}
        </p>
        <p className="plan-note">
          {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {post.destination}
        </p>
        {editing ? (
          <div>
            <textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} maxLength={280} rows={3} aria-label="Edit caption" style={{ width: '100%' }} />
            <p className="plan-note">{editCaption.length}/280</p>
            <button className="primary" onClick={saveEdit}>Save caption</button>{' '}
            <button className="ghost" onClick={() => { setEditing(false); setEditCaption(post.caption); }}>Cancel</button>
            {editMsg && <p className="plan-note">{editMsg}</p>}
          </div>
        ) : (
          <p style={{ fontSize: 14, margin: '6px 0' }}>{post.caption}</p>
        )}
        {typeof post.overallRating === 'number' && (
          <p className="plan-line">
            Worth it? {'★'.repeat(post.overallRating)}{'☆'.repeat(5 - post.overallRating)} {post.overallRating}/5
          </p>
        )}
        {post.ratings && Object.keys(post.ratings).length > 0 && (
          <p className="plan-line">
            {Object.entries(post.ratings).map(([city, r]) => `${city} ${r}/5`).join(' · ')}
          </p>
        )}
        {showModeration && (
          <p className="plan-note">
            Moderation: {post.moderation} — {post.moderationNote}
          </p>
        )}
        <div className="reel-actions">
          <button type="button" className="ghost" aria-pressed={liked} onClick={() => void react('like')}>
            ♥ {likes}
          </button>
          <button type="button" className="ghost" aria-pressed={saved} onClick={() => void react('save')}>
            {saved ? '✓ Saved' : 'Save'} {saves > 0 ? saves : ''}
          </button>
          <button type="button" className="ghost" onClick={shareNative}>
            Share
          </button>
          <button type="button" className="ghost" aria-label="Report this post" onClick={() => setReportOpen((o) => !o)}>
            ···
          </button>
          {isMine && (
            <>
              <button type="button" className="ghost" onClick={() => setEditing((e) => !e)}>
                Edit
              </button>
              <button type="button" className="ghost" onClick={removePost}>
                Delete
              </button>
            </>
          )}
        </div>
        {shareOpen && (
          <div className="reel-share">
            <button className="ghost" onClick={copyLink}>Copy link</button>{' '}
            <a className="ghost" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${post.routeLine} — a trip by ${post.author}`)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">X</a>{' '}
            <a className="ghost" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">Facebook</a>{' '}
            <a className="ghost" href={`https://wa.me/?text=${encodeURIComponent(`${post.routeLine} — a trip by ${post.author} ${shareUrl}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            {shareMsg && <p className="plan-note">{shareMsg}</p>}
          </div>
        )}
        {reportOpen && (
          <div className="reel-report">
            <p style={{ fontSize: 13, margin: '4px 0' }}><b>Report this post</b></p>
            {REPORT_REASONS.map((r) => (
              <label key={r} style={{ display: 'block', fontSize: 13 }}>
                <input type="radio" name={`report-${post.id}`} checked={reportReason === r} onChange={() => setReportReason(r)} /> {r}
              </label>
            ))}
            <button className="ghost" style={{ marginTop: 8 }} onClick={report}>Send report</button>
            {reportMsg && <p className="plan-note">{reportMsg}</p>}
          </div>
        )}
        {editMsg && !editing && <p className="plan-note">{editMsg}</p>}
      </div>
    </article>
  );
}
