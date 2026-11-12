// Server-only store for plan-share snapshots ("Send this plan to my
// phone"). A snapshot is the plan as JSON under a short id; /plan/<id>
// opens the same Today view on another device.
//
// Durability warning (same as lib/serverStore): data/ lives on the
// container filesystem and does not survive a redeploy. A share link is
// a copy, not account sync — see files/plan-sync-design.md.
import path from 'path';
import { randomBytes } from 'crypto';
import { DATA_DIR, readJsonFile, writeJsonFile } from './serverStore';
import type { OfflineSnapshot } from './today';

const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

export type SharesDoc = { shares: Record<string, { snapshot: OfflineSnapshot; createdAt: string }> };

export function newShareId(): string {
  // Short, URL-safe id for /plan/<id>. Collision-checked by the caller.
  return randomBytes(6).toString('base64url');
}

export async function saveShare(id: string, snapshot: OfflineSnapshot): Promise<void> {
  const doc = await readJsonFile<SharesDoc>(SHARES_FILE, { shares: {} });
  doc.shares[id] = { snapshot, createdAt: new Date().toISOString() };
  await writeJsonFile(SHARES_FILE, doc);
}

export async function getShare(id: string): Promise<OfflineSnapshot | null> {
  const doc = await readJsonFile<SharesDoc>(SHARES_FILE, { shares: {} });
  return doc.shares[id]?.snapshot ?? null;
}
