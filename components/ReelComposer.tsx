// Post a reel (community round, design §6.2) — one screen, four steps:
// (1) photos/video, (2) the trip it belongs to (the verification hook),
// (3) a caption, (4) an optional "worth it?" rating per leg.
//
// Media limits are shown BEFORE upload, not after: up to 6 photos or
// one video ≤60s; photos ≤10 MB, video ≤100 MB. A failed upload retries
// visibly — a traveler's photos are never silently lost. Drafts save
// locally (caption, ratings, uploaded media) so a half-written post
// survives a reload; raw files do not survive a reload and must be
// re-added.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTripCard, CITY_INFO } from '../lib/tripCard';
import { MONTH_NAMES } from '../lib/planner';
import { REEL_LIMITS } from '../lib/reels';
import type { ReelMedia } from '../lib/reels';
import ReelCard, { type PublicReelPost } from './ReelCard';

export type ComposerTrip = { id: string; label: string; status: string; date: string; destination?: string };

const DRAFT_KEY = 'fujin-reel-draft';
const CITIES = Object.keys(CITY_INFO).sort();

type Draft = {
  author?: string;
  tripId?: string;
  destination?: string;
  month?: number;
  caption?: string;
  overallRating?: number;
  ratings?: Record<string, number>;
  media?: ReelMedia[];
};

function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : {};
  } catch {
    return {};
  }
}

function measureVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this video.'));
    };
    video.src = url;
  });
}

export default function ReelComposer({
  trips,
  prefillDestination,
  onPosted,
  onClose,
}: {
  trips: ComposerTrip[];
  prefillDestination?: string;
  onPosted?: () => void;
  onClose?: () => void;
}) {
  const draft = useRef<Draft>(readDraft());
  const bookedTrips = trips.filter((t) => t.status === 'Booked with FujinTrip' && t.destination);
  const [author, setAuthor] = useState(draft.current.author ?? '');
  const [tripId, setTripId] = useState(draft.current.tripId ?? '');
  const [destination, setDestination] = useState(draft.current.destination ?? prefillDestination ?? '');
  const [month, setMonth] = useState(draft.current.month ?? new Date().getMonth() + 1);
  const [caption, setCaption] = useState(draft.current.caption ?? '');
  const [overallRating, setOverallRating] = useState(draft.current.overallRating ?? 0);
  const [ratings, setRatings] = useState<Record<string, number>>(draft.current.ratings ?? {});
  const [media, setMedia] = useState<ReelMedia[]>(draft.current.media ?? []);
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadMsg, setUploadMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [posted, setPosted] = useState<PublicReelPost | null>(null);
  const [postNote, setPostNote] = useState('');

  // The trip the post belongs to: a booked trip from My Trips earns the
  // "Verified trip" badge; a destination picked by hand does not.
  const chosenTrip = bookedTrips.find((t) => t.id === tripId) ?? null;
  const activeDestination = chosenTrip?.destination ?? destination;
  const verified = chosenTrip !== null;
  const routeCities = useMemo(() => {
    if (!activeDestination) return [];
    try {
      const card = buildTripCard({ destination: activeDestination, travelers: 2, days: 3, month: 0, origin: '' });
      return card ? card.stops.map((s) => s.city) : [activeDestination];
    } catch {
      return [activeDestination];
    }
  }, [activeDestination]);
  const routeLine = routeCities.join(' → ');

  // Drafts save locally on every change.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ author, tripId, destination, month, caption, overallRating, ratings, media })
      );
    } catch {}
  }, [author, tripId, destination, month, caption, overallRating, ratings, media]);

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploadMsg('');
    const incoming = [...files];
    const photos = media.filter((m) => m.kind === 'photo').length + incoming.filter((f) => f.type.startsWith('image/')).length;
    const videos = media.filter((m) => m.kind === 'video').length + incoming.filter((f) => f.type.startsWith('video/')).length;
    if (videos > 1) {
      setUploadMsg('One video per post — add photos for the rest.');
      return;
    }
    if (photos + videos > REEL_LIMITS.maxPhotos) {
      setUploadMsg(`Up to ${REEL_LIMITS.maxPhotos} photos per post.`);
      return;
    }
    for (const file of incoming) {
      const isPhoto = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isPhoto && !isVideo) {
        setUploadMsg(`“${file.type || 'unknown type'}” is not supported — photos or a short video.`);
        continue;
      }
      if (isPhoto && file.size > REEL_LIMITS.maxPhotoBytes) {
        setUploadMsg(`“${file.name}” is over ${REEL_LIMITS.maxPhotoBytes / (1024 * 1024)} MB — pick a smaller photo.`);
        continue;
      }
      if (isVideo && file.size > REEL_LIMITS.maxVideoBytes) {
        setUploadMsg(`“${file.name}” is over ${REEL_LIMITS.maxVideoBytes / (1024 * 1024)} MB — trim it to a short reel.`);
        continue;
      }
      let durationSec: number | undefined;
      if (isVideo) {
        try {
          durationSec = await measureVideoDuration(file);
        } catch {
          setUploadMsg(`“${file.name}” could not be read — try a different video.`);
          continue;
        }
        if (durationSec > REEL_LIMITS.maxVideoSec) {
          setUploadMsg(`“${file.name}” is over ${REEL_LIMITS.maxVideoSec} seconds — trim it to a short reel.`);
          continue;
        }
      }
      setUploading((prev) => [...prev, file.name]);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('destination', activeDestination);
        if (durationSec !== undefined) form.append('durationSec', String(Math.round(durationSec)));
        const r = await fetch('/api/reels/upload', { method: 'POST', body: form });
        const j = (await r.json()) as { media?: ReelMedia; message?: string; note?: string };
        if (!r.ok || !j.media) {
          setUploadMsg(j.message ?? 'That upload failed — try again.');
        } else {
          setMedia((prev) => [...prev, j.media as ReelMedia]);
          if (j.note) setUploadMsg(j.note);
        }
      } catch {
        setUploadMsg('The upload could not reach the server — your photo was not lost, try again.');
      } finally {
        setUploading((prev) => prev.filter((n) => n !== file.name));
      }
    }
  };

  const post = async () => {
    if (busy) return;
    if (!author.trim()) {
      setMsg('Give your first name — the post appears under it.');
      return;
    }
    if (!activeDestination) {
      setMsg('Pick the trip or destination this post is about.');
      return;
    }
    if (!caption.trim()) {
      setMsg('Write a caption — what should the next traveler know?');
      return;
    }
    if (caption.trim().length > REEL_LIMITS.maxCaption) {
      setMsg(`Caption is ${caption.trim().length} characters — the limit is ${REEL_LIMITS.maxCaption}.`);
      return;
    }
    if (!media.length) {
      setMsg('Add at least one photo or a short video.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: author.trim(),
          destination: activeDestination,
          routeLine,
          month,
          caption: caption.trim(),
          ...(overallRating ? { overallRating } : {}),
          ...(Object.keys(ratings).length ? { ratings } : {}),
          media,
          ...(chosenTrip ? { tripId: chosenTrip.id, tripLabel: chosenTrip.label, verified: true } : {}),
        }),
      });
      const j = (await r.json()) as { post?: PublicReelPost; posterToken?: string; message?: string; note?: string };
      if (!r.ok || !j.post) {
        setMsg(j.message ?? 'Couldn’t post right now — try again in a moment.');
        return;
      }
      if (j.posterToken) {
        try {
          localStorage.setItem(`fujin-reel-token:${j.post.id}`, j.posterToken);
          localStorage.removeItem(DRAFT_KEY);
        } catch {}
      }
      setPosted(j.post);
      setPostNote(j.note ?? '');
      onPosted?.();
    } catch {
      setMsg('Couldn’t reach the server — your post is saved as a draft, try again.');
    } finally {
      setBusy(false);
    }
  };

  if (posted) {
    return (
      <div className="reel-composer">
        <h3 style={{ margin: '4px 0' }}>Your reel is posted</h3>
        <p className="plan-note">{postNote}</p>
        <ReelCard post={posted} showModeration />
        <p style={{ marginTop: 12 }}>
          <button className="ghost" onClick={onClose}>
            Done
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="reel-composer">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <h3 style={{ margin: '4px 0' }}>Share how it went</h3>
        {onClose && (
          <button className="ghost" aria-label="Close" onClick={onClose} style={{ minHeight: 44, minWidth: 44 }}>
            ×
          </button>
        )}
      </div>
      <p className="plan-note">A photo or a short video from your trip, a caption, and — if you want — a “worth it?” rating. Only real trips: nothing here is invented, and your post carries its moderation state.</p>

      {/* 1 — media */}
      <p style={{ fontSize: 14, margin: '12px 0 4px' }}>
        <b>1 · Photos or a short video</b>
      </p>
      <p className="plan-note">Up to {REEL_LIMITS.maxPhotos} photos, or one video up to {REEL_LIMITS.maxVideoSec} seconds. Photos ≤ {REEL_LIMITS.maxPhotoBytes / (1024 * 1024)} MB, video ≤ {REEL_LIMITS.maxVideoBytes / (1024 * 1024)} MB.</p>
      <input
        type="file"
        accept="image/*,video/*"
        multiple
        aria-label="Add photos or a video"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {uploading.map((n) => (
        <p key={n} className="plan-note">Uploading “{n}”…</p>
      ))}
      {uploadMsg && <p className="plan-note">{uploadMsg}</p>}
      {media.map((m, i) => (
        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 13 }}>
            {m.kind === 'video' ? '🎬' : '🖼️'} {m.alt}
            {m.durationSec ? ` · ${Math.round(m.durationSec)}s` : ''}
            {m.storage === 'local-dev' ? ' · stored on this server for now' : ' · stored in FujinTrip media storage'}
          </span>
          <input
            aria-label={`Alt text for ${m.alt}`}
            value={m.alt}
            maxLength={200}
            onChange={(e) =>
              setMedia((prev) => prev.map((x, xi) => (xi === i ? { ...x, alt: e.target.value } : x)))
            }
            style={{ flex: 1 }}
          />
          <button className="ghost" onClick={() => setMedia((prev) => prev.filter((_, xi) => xi !== i))}>
            Remove
          </button>
        </div>
      ))}

      {/* 2 — the trip */}
      <p style={{ fontSize: 14, margin: '12px 0 4px' }}>
        <b>2 · The trip it belongs to</b>
      </p>
      {bookedTrips.length > 0 ? (
        <>
          <select value={tripId} onChange={(e) => setTripId(e.target.value)} aria-label="Pick the booked trip">
            <option value="">A trip I planned (no badge)</option>
            {bookedTrips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} · {t.date}
              </option>
            ))}
          </select>
          <p className="plan-note">
            {verified
              ? `✓ Verified trip — this post is attached to a booked FujinTrip trip and earns the badge.`
              : 'Pick a booked trip to earn the “Verified trip” badge. Without one, your post still appears — just without the badge, and never on the trip-card strip.'}
          </p>
        </>
      ) : (
        <p className="plan-note">No booked trip in My Trips yet — your post appears without the “Verified trip” badge. Book a trip with FujinTrip and the badge comes with it.</p>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <select value={destination} onChange={(e) => setDestination(e.target.value)} aria-label="Destination">
          <option value="">Destination…</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month of the trip">
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {routeLine && (
        <p className="plan-note" style={{ marginTop: 6 }}>
          Route: {routeLine}
        </p>
      )}

      {/* 3 — caption */}
      <p style={{ fontSize: 14, margin: '12px 0 4px' }}>
        <b>3 · What should the next traveler know?</b>
      </p>
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={REEL_LIMITS.maxCaption}
        rows={3}
        placeholder="One line from the trip — the thing you wish someone had told you."
        aria-label="Caption"
        style={{ width: '100%' }}
      />
      <p className="plan-note">{caption.length}/{REEL_LIMITS.maxCaption} · Your first name: </p>
      <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={30} placeholder="Your first name" aria-label="Your first name" />

      {/* 4 — ratings */}
      <p style={{ fontSize: 14, margin: '12px 0 4px' }}>
        <b>4 · Worth it? (optional)</b>
      </p>
      <div role="group" aria-label="Overall worth-it rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="ghost" aria-pressed={overallRating === n} onClick={() => setOverallRating(overallRating === n ? 0 : n)}>
            {n}★
          </button>
        ))}
        {overallRating > 0 && <span className="plan-note"> {overallRating}/5 overall</span>}
      </div>
      {routeCities.length > 1 && (
        <div style={{ marginTop: 8 }}>
          {routeCities.map((city) => (
            <p key={city} style={{ fontSize: 13, margin: '4px 0' }}>
              {city}:{' '}
              <select value={ratings[city] ?? ''} onChange={(e) => setRatings((prev) => (e.target.value ? { ...prev, [city]: Number(e.target.value) } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== city))))} aria-label={`Worth-it rating for ${city}`}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}/5
                  </option>
                ))}
              </select>
            </p>
          ))}
        </div>
      )}

      {msg && <p style={{ fontSize: 13, color: '#b3261e', marginTop: 8 }}>{msg}</p>}
      <p style={{ marginTop: 12 }}>
        <button className="primary" onClick={post} disabled={busy}>
          {busy ? 'Posting…' : 'Share with travelers'}
        </button>
      </p>
      <p className="plan-note">By posting you agree your photo/video and caption are shown to other travelers, with your first name. You can edit the caption or delete the post anytime from the card — the link you share then says the traveler removed it.</p>
    </div>
  );
}
