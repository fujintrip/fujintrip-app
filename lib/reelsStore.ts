// Server-only store for reel posts.
// Data lives in data/reels.json (see lib/serverStore for the durability
// warning: the container filesystem is ephemeral — a redeploy wipes
// these files until Postgres lands).
import path from 'path';
import { randomBytes } from 'crypto';
import { DATA_DIR, readJsonFile, writeJsonFile } from './serverStore';
import type { ReelPost } from './reels';

const POSTS_FILE = path.join(DATA_DIR, 'reels.json');

export type PostsDoc = { posts: ReelPost[] };

export async function listPosts(): Promise<ReelPost[]> {
  const doc = await readJsonFile<PostsDoc>(POSTS_FILE, { posts: [] });
  return Array.isArray(doc.posts) ? doc.posts : [];
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
