// Server-only store for reel posts.
// Data lives in data/reels.json (see lib/serverStore for the durability
// warning: the container filesystem is ephemeral — a redeploy wipes
// these files until Postgres lands).
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { DATA_DIR, UPLOADS_DIR, readJsonFile, writeJsonFile } from './serverStore';
import type { ReelMedia, ReelPost } from './reels';
import { REELS_SEED } from './reelsSeed';

const POSTS_FILE = path.join(DATA_DIR, 'reels.json');

export type PostsDoc = { posts: ReelPost[] };

export async function listPosts(): Promise<ReelPost[]> {
  // UX direction round 2 (Nov 21 2026 — P0-6d) + roadmap F3: the
  // checked-in seed is ALWAYS merged in by id. A data file that
  // exists because ANY post was created — even one still in review —
  // used to hide the seed entirely, so the community shelf went empty
  // the moment the first reel was submitted and the homepage section
  // vanished with it. The file version still wins on collision: a
  // seed post that was deleted or sent back to review stays deleted
  // or under review — the seed never resurrects a moderated post.
  // And a seed-id post whose media is a dead local-dev upload falls
  // back to the seed's own media (data/uploads is wiped on deploy,
  // so a /api/reels/media/… URL 404s on a fresh deploy and the reel
  // would render as a grey tile instead of its photo).
  const filePosts = fs.existsSync(POSTS_FILE)
    ? (await readJsonFile<PostsDoc>(POSTS_FILE, { posts: [] })).posts
    : [];
  const posts = Array.isArray(filePosts) ? filePosts : [];
  const seen = new Set<string>();
  const merged: ReelPost[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    const seed = REELS_SEED.find((s) => s.id === post.id);
    merged.push(seed ? { ...post, media: seedMediaFor(post, seed) } : post);
  }
  for (const seed of REELS_SEED) {
    if (!seen.has(seed.id)) merged.push(seed);
  }
  return merged;
}

// The seed post's media: the file version's media is kept when it is
// a durable URL (the seed's own Unsplash photo, a Spaces URL). A
// local-dev upload URL (/api/reels/media/…) whose file is gone from
// this server falls back to the seed's media, so the reel keeps its
// photo instead of a grey tile.
function seedMediaFor(post: ReelPost, seed: ReelPost): ReelMedia[] {
  if (post.media.length === 0) return seed.media;
  const local = post.media.filter((m) => m.url.startsWith('/api/reels/media/'));
  if (local.length === 0) return post.media;
  const dead = local.some((m) => !uploadExists(m.url.slice('/api/reels/media/'.length)));
  return dead ? seed.media : post.media;
}

// Does a local-dev upload still exist on this server? The uploads
// index maps id → ext; the file itself is data/uploads/<id>.<ext>.
function uploadExists(id: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(UPLOADS_DIR, 'index.json'), 'utf8');
    const meta = JSON.parse(raw) as Record<string, { ext: string }>;
    const entry = meta[id];
    if (!entry) return false;
    return fs.existsSync(path.join(UPLOADS_DIR, `${id}.${entry.ext}`));
  } catch {
    return false;
  }
}

export async function getPost(id: string): Promise<ReelPost | null> {
  const posts = await listPosts();
  return posts.find((p) => p.id === id) ?? null;
}

export async function savePost(post: ReelPost): Promise<ReelPost> {
  const posts = await listPosts();
  const idx = posts.findIndex((p) => p.id === post.id);
  if (idx >= 0) posts[idx] = post;
  else posts.push(post);
  await writeJsonFile(POSTS_FILE, { posts });
  return post;
}

export async function deletePost(id: string): Promise<boolean> {
  const posts = await listPosts();
  const next = posts.filter((p) => p.id !== id);
  if (next.length === posts.length) return false;
  await writeJsonFile(POSTS_FILE, { posts: next });
  return true;
}

export function newPostId(): string {
  return `reel_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}
