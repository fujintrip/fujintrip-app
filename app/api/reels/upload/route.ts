import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { REEL_LIMITS, spacesConfiguredMessage, type ReelMedia } from '../../../../lib/reels';
import { putObject, spacesConfigured } from '../../../../lib/spaces';
import { clientIp, rateLimitOk, saveUploadFile } from '../../../../lib/serverStore';

/**
 * POST /api/reels/upload — media for a reel (community round, design §6).
 *
 * Multipart form: file (photo or one video ≤60s), alt (optional),
 * destination (optional — fills the alt text), durationSec (optional,
 * measured in the browser for video).
 *
 * Limits are enforced here too, not just in the composer: photos ≤10 MB,
 * video ≤100 MB, video ≤60 s. Where the bytes land:
 *  - Spaces is configured (SPACES_KEY set) → the FujinTrip media
 *    bucket, public URL returned.
 *  - Not configured → this server's data/uploads (verified path in this
 *    environment), URL /api/reels/media/<id>, and the response says so.
 * The response never claims Spaces storage when it did not happen.
 */
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

export async function POST(req: NextRequest) {
  if (!rateLimitOk(`reels-upload:${clientIp(req)}`, 20, 60 * 1000)) {
    return NextResponse.json({ message: 'Too many uploads just now — wait a moment and try again.' }, { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: 'Send the photo or video as multipart form data.' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ message: 'Attach a photo or a short video first.' }, { status: 400 });
  const isPhoto = PHOTO_MIMES.includes(file.type);
  const isVideo = VIDEO_MIMES.includes(file.type);
  if (!isPhoto && !isVideo) {
    return NextResponse.json({ message: `“${file.type || 'unknown type'}” is not supported — photos (JPEG, PNG, WebP, GIF) or video (MP4, WebM, MOV).` }, { status: 400 });
  }
  if (isPhoto && file.size > REEL_LIMITS.maxPhotoBytes) {
    return NextResponse.json({ message: `That photo is over ${REEL_LIMITS.maxPhotoBytes / (1024 * 1024)} MB — pick a smaller one.` }, { status: 400 });
  }
  if (isVideo && file.size > REEL_LIMITS.maxVideoBytes) {
    return NextResponse.json({ message: `That video is over ${REEL_LIMITS.maxVideoBytes / (1024 * 1024)} MB — trim it to a short reel under ${REEL_LIMITS.maxVideoSec} seconds.` }, { status: 400 });
  }
  const durationRaw = form.get('durationSec');
  const durationSec = typeof durationRaw === 'string' ? Number(durationRaw) : NaN;
  if (isVideo && Number.isFinite(durationSec) && durationSec > REEL_LIMITS.maxVideoSec) {
    return NextResponse.json({ message: `The video is over ${REEL_LIMITS.maxVideoSec} seconds — trim it to a short reel.` }, { status: 400 });
  }
  const destination = typeof form.get('destination') === 'string' ? (form.get('destination') as string).trim() : '';
  const altRaw = typeof form.get('alt') === 'string' ? (form.get('alt') as string).trim() : '';
  const alt = altRaw || (destination ? `${isVideo ? 'Video' : 'Photo'} from ${destination}` : isVideo ? 'Traveler video' : 'Traveler photo');
  if (alt.length > 200) return NextResponse.json({ message: 'Alt text is too long (200 characters).' }, { status: 400 });

  const id = `media_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const ext = isPhoto ? (file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg') : file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
  const buffer = Buffer.from(await file.arrayBuffer());

  if (spacesConfigured()) {
    const key = `reels/${id}.${ext}`;
    const res = await putObject(key, buffer, file.type);
    if (!res.ok) return NextResponse.json({ message: res.message }, { status: 502 });
    const media: ReelMedia = {
      id,
      kind: isVideo ? 'video' : 'photo',
      url: res.url,
      storage: 'spaces',
      alt,
      ...(isVideo && Number.isFinite(durationSec) ? { durationSec } : {}),
    };
    return NextResponse.json({ media, storage: 'spaces' });
  }

  await saveUploadFile(id, file.type, ext, buffer);
  const media: ReelMedia = {
    id,
    kind: isVideo ? 'video' : 'photo',
    url: `/api/reels/media/${id}`,
    storage: 'local-dev',
    alt,
    ...(isVideo && Number.isFinite(durationSec) ? { durationSec } : {}),
  };
  return NextResponse.json({
    media,
    storage: 'local-dev',
    note: spacesConfiguredMessage(),
  });
}
