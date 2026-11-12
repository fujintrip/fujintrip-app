// Server-only file store (Next.js route handlers + server components).
//
// FujinTrip has no database layer yet — the Managed Postgres cluster
// exists on DigitalOcean but the app has never used it (DATABASE_URL is
// bound, unused in code). Until accounts + Postgres land (see
// files/plan-sync-design.md and files/reels-design.md), server-persisted
// data (reel posts, plan-share snapshots, uploaded media) lives in JSON
// files under data/ — gitignored, created on demand.
//
// HONEST LIMIT, stated here and in the design docs: the App Platform
// container filesystem is EPHEMERAL. A redeploy wipes data/. Posts and
// share links made on the live site do not survive a deploy. This store
// is the dev + verification path and the shape of the real one — the
// Postgres replacement keeps the same function signatures.
import { promises as fs } from 'fs';
import path from 'path';

export const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Writes are serialized through one promise chain per process so two
// concurrent posts cannot overwrite each other's file.
let writeQueue: Promise<unknown> = Promise.resolve();

export function writeJsonFile(file: string, value: unknown): Promise<void> {
  const run = writeQueue.then(async () => {
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  });
  writeQueue = run.catch(() => {});
  return run;
}

export async function readUploadFile(id: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const meta = await readJsonFile<Record<string, { mime: string; ext: string }>>(
    path.join(UPLOADS_DIR, 'index.json'),
    {}
  );
  const entry = meta[id];
  if (!entry) return null;
  try {
    const buffer = await fs.readFile(path.join(UPLOADS_DIR, `${id}.${entry.ext}`));
    return { buffer, mime: entry.mime };
  } catch {
    return null;
  }
}

export async function saveUploadFile(id: string, mime: string, ext: string, buffer: Buffer): Promise<void> {
  await ensureDir(UPLOADS_DIR);
  await fs.writeFile(path.join(UPLOADS_DIR, `${id}.${ext}`), buffer);
  const meta = await readJsonFile<Record<string, { mime: string; ext: string }>>(
    path.join(UPLOADS_DIR, 'index.json'),
    {}
  );
  meta[id] = { mime, ext };
  await writeJsonFile(path.join(UPLOADS_DIR, 'index.json'), meta);
}

// Basic anti-spam guard for unauthenticated writes (no accounts yet):
// N requests per IP per window. In-memory per process — a restart resets
// it. It is a speed bump, not abuse-proofing; the design docs say so.
const hits = new Map<string, number[]>();

export function rateLimitOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
