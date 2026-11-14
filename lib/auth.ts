// Free-account gate — Clerk sign-in (user chose Clerk + email magic
// link, Nov 14 2026; the full comparison lives in
// files/free-account-signin-options.md).
//
// The rule, from the Nov 13 homepage direction: browsing, the tabs, the
// results and the chat stay completely free — no sign-up wall for
// looking. ONLY saving / downloading a plan needs a free account, and
// the $1 PDF rule sits on top of the gate (free account to save; $1 to
// download unless booked — the plan-download route already returns
// pay_1/stripe_not_configured; this file changes no pricing).
//
// This module is pure logic — no Clerk imports — so the gate rule and
// the merge bookkeeping are unit-testable without keys. The React side
// lives in components/AccountGate.tsx.
//
// Graceful degradation (the user has NOT created the Clerk account yet):
// when the Clerk keys are absent, `isClerkConfigured` is false, the app
// renders no ClerkProvider at all, and the gate shows "sign-in isn't
// set up yet" instead of crashing or looping. Trips keep living in
// localStorage until the Postgres sync build lands — nothing here fakes
// server persistence.

export const CLERK_SIGN_IN_URL = '/sign-in';
export const CLERK_SIGN_UP_URL = '/sign-up';

// A Clerk publishable key looks like pk_test_… or pk_live_… — anything
// else (empty, a placeholder, a secret key pasted by mistake) means
// "not configured". The length check rejects a bare prefix.
export function isClerkConfigured(publishableKey?: string | null): boolean {
  if (typeof publishableKey !== 'string') return false;
  const k = publishableKey.trim();
  if (k.length < 20) return false;
  if (k.includes('REPLACE_ME')) return false;
  return k.startsWith('pk_test_') || k.startsWith('pk_live_');
}

// The gate decision for a Save/Download action. One rule, three states:
// allowed (signed in), needs-signin (Clerk is wired but the traveler
// is signed out), not-configured (no Clerk keys yet — the site owner
// hasn't connected Clerk).
export type GateDecision = 'allowed' | 'needs-signin' | 'not-configured';

export function gateDecision(opts: {
  configured: boolean;
  signedIn: boolean;
}): GateDecision {
  if (!opts.configured) return 'not-configured';
  if (!opts.signedIn) return 'needs-signin';
  return 'allowed';
}

// --- One-tap merge (plan-sync-design.md §3) ---------------------------
// On first sign-in, My Trips offers to move the traveler's localStorage
// trips to their account. The server sync that makes those trips appear
// on other devices is the NEXT build, not this one — so the merge only
// records the link on this device: each trip is stamped with the
// account id, and a merge record is kept per account. The copy in the
// UI says so plainly ("they'll appear on your other devices once
// cross-device sync lands; for now they're still saved on this device").

export const ACCOUNT_MERGE_KEY_PREFIX = 'fujintrip-account-merge';

export interface MergeRecord {
  userId: string;
  movedAt: string; // ISO timestamp
  tripIds: string[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function mergeKeyFor(userId: string): string {
  return `${ACCOUNT_MERGE_KEY_PREFIX}:${userId}`;
}

// Read a merge record, validating shape — a corrupt or foreign record
// is treated as "no merge yet", never thrown on.
export function readMergeRecord(
  userId: string,
  storage: StorageLike
): MergeRecord | null {
  if (!userId) return null;
  try {
    const raw = storage.getItem(mergeKeyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MergeRecord>;
    if (
      parsed.userId !== userId ||
      typeof parsed.movedAt !== 'string' ||
      !Array.isArray(parsed.tripIds) ||
      !parsed.tripIds.every((id) => typeof id === 'string')
    ) {
      return null;
    }
    return { userId: parsed.userId, movedAt: parsed.movedAt, tripIds: parsed.tripIds };
  } catch {
    return null;
  }
}

// Record that this account's local trips were moved to it. Returns the
// record written (so the caller can render the confirmation from it).
export function recordMerge(
  userId: string,
  tripIds: string[],
  storage: StorageLike,
  now: Date = new Date()
): MergeRecord {
  const record: MergeRecord = {
    userId,
    movedAt: now.toISOString(),
    tripIds: [...tripIds],
  };
  storage.setItem(mergeKeyFor(userId), JSON.stringify(record));
  return record;
}

// Show the merge offer only to a signed-in traveler who has local trips
// and has not merged them to this account yet.
export function mergeOfferNeeded(opts: {
  signedIn: boolean;
  userId: string | null;
  tripCount: number;
  merged: boolean;
}): boolean {
  return opts.signedIn && opts.userId !== null && opts.tripCount > 0 && !opts.merged;
}
