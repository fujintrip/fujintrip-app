// Order records — the server-side record of every checkout.
// TEST MODE ONLY for now: every order carries mode 'test' and
// testOrder: true until live Stripe keys + Duffel live activation
// land. A test order is never presented as a confirmed live booking.
//
// Storage: Managed Postgres (DATABASE_URL) is the right home — the
// orders table is ORDERS_TABLE_SQL below. This codebase has no local
// Postgres to verify against, so when DATABASE_URL is absent (or
// Postgres is unreachable) orders persist in a clearly-labeled
// server-side JSON store under data/orders/ (gitignored, one file per
// order). The store kind is reported by GET /api/checkout, so the
// fallback is never silent. Persistence is never faked: if an order
// cannot be saved, the caller gets an error, not a success.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type OrderStatus =
  | 'awaiting_payment' // PaymentIntent created, traveler has not paid yet
  | 'paid' // intent succeeded, Duffel order not yet created
  | 'booked' // Duffel test order created (test booking only)
  | 'payment_failed'
  | 'booking_failed' // paid, but the Duffel order failed — needs follow-up
  | 'cancelled';

export type OrderKind = 'flight' | 'plan_pdf';

export type OrderItem = { label: string; amount: number; currency: string };

export type OrderRecord = {
  id: string; // ord_test_… / ord_live_…
  kind: OrderKind;
  items: OrderItem[];
  fare: number; // whole dollars (0 for plan_pdf)
  serviceFee: number; // whole dollars (0 for plan_pdf)
  extrasTotal: number; // whole dollars, bags/seats at cost
  total: number; // whole dollars: fare + serviceFee + extrasTotal
  currency: string;
  paymentIntentId: string | null;
  mode: 'test' | 'live';
  supplier: 'duffel' | 'fujintrip';
  offerId?: string;
  returnOfferId?: string;
  duffelOrderIds?: string[];
  bookingReference?: string;
  travelerEmail?: string;
  travelerName?: string;
  status: OrderStatus;
  testOrder: boolean; // true whenever mode is 'test'
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// ---------------------------------------------------------------------------
// Validation — a corrupt or foreign record reads as "no order", never thrown
// ---------------------------------------------------------------------------

function isRecordShape(v: unknown): v is OrderRecord {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' && r.id.startsWith('ord_') &&
    (r.kind === 'flight' || r.kind === 'plan_pdf') &&
    Array.isArray(r.items) &&
    typeof r.fare === 'number' && typeof r.serviceFee === 'number' &&
    typeof r.extrasTotal === 'number' && typeof r.total === 'number' &&
    typeof r.currency === 'string' &&
    (r.paymentIntentId === null || typeof r.paymentIntentId === 'string') &&
    (r.mode === 'test' || r.mode === 'live') &&
    (r.supplier === 'duffel' || r.supplier === 'fujintrip') &&
    typeof r.status === 'string' &&
    typeof r.testOrder === 'boolean' &&
    typeof r.createdAt === 'string' && typeof r.updatedAt === 'string'
  );
}

export function isOrderRecord(v: unknown): v is OrderRecord {
  return isRecordShape(v);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function newOrderId(mode: 'test' | 'live'): string {
  return `ord_${mode}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function newOrder(opts: {
  kind: OrderKind;
  items: OrderItem[];
  fare: number;
  serviceFee: number;
  extrasTotal: number;
  total: number;
  currency: string;
  paymentIntentId: string | null;
  mode: 'test' | 'live';
  supplier: 'duffel' | 'fujintrip';
  offerId?: string;
  returnOfferId?: string;
  travelerEmail?: string;
  travelerName?: string;
  now?: Date;
}): OrderRecord {
  const now = (opts.now ?? new Date()).toISOString();
  return {
    id: newOrderId(opts.mode),
    kind: opts.kind,
    items: opts.items,
    fare: opts.fare,
    serviceFee: opts.serviceFee,
    extrasTotal: opts.extrasTotal,
    total: opts.total,
    currency: opts.currency.toUpperCase(),
    paymentIntentId: opts.paymentIntentId,
    mode: opts.mode,
    supplier: opts.supplier,
    ...(opts.offerId ? { offerId: opts.offerId } : {}),
    ...(opts.returnOfferId ? { returnOfferId: opts.returnOfferId } : {}),
    ...(opts.travelerEmail ? { travelerEmail: opts.travelerEmail } : {}),
    ...(opts.travelerName ? { travelerName: opts.travelerName } : {}),
    status: 'awaiting_payment',
    testOrder: opts.mode === 'test',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Postgres — the production home. Table SQL is exported so the schema
// is reviewable and testable without a live database.
// ---------------------------------------------------------------------------

export const ORDERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  fare INTEGER NOT NULL,
  service_fee INTEGER NOT NULL,
  extras_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_intent_id TEXT,
  mode TEXT NOT NULL,
  supplier TEXT NOT NULL,
  offer_id TEXT,
  return_offer_id TEXT,
  duffel_order_ids JSONB,
  booking_reference TEXT,
  traveler_email TEXT,
  traveler_name TEXT,
  status TEXT NOT NULL,
  test_order BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_payment_intent_id_idx ON orders (payment_intent_id);
`.trim();

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export type OrderStore = {
  kind: 'postgres' | 'file';
  save(record: OrderRecord): Promise<OrderRecord>;
  get(id: string): Promise<OrderRecord | null>;
  findByPaymentIntent(paymentIntentId: string): Promise<OrderRecord | null>;
  update(id: string, patch: Partial<OrderRecord>): Promise<OrderRecord | null>;
};

function fileOrdersDir(): string {
  const override = process.env.FUJIN_ORDERS_DIR?.trim();
  if (override) return override;
  return path.join(process.cwd(), 'data', 'orders');
}

function fileStore(): OrderStore {
  const dir = fileOrdersDir();
  const fileFor = (id: string) => path.join(dir, `${id}.json`);
  const readOne = async (file: string): Promise<OrderRecord | null> => {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return isOrderRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  return {
    kind: 'file',
    async save(record) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${fileFor(record.id)}.tmp-${process.pid}`;
      await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
      await fs.rename(tmp, fileFor(record.id));
      return record;
    },
    async get(id) {
      return readOne(fileFor(id));
    },
    async findByPaymentIntent(paymentIntentId) {
      let files: string[] = [];
      try {
        files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
      } catch {
        return null;
      }
      let best: OrderRecord | null = null;
      for (const f of files) {
        const rec = await readOne(path.join(dir, f));
        if (rec && rec.paymentIntentId === paymentIntentId) {
          if (!best || rec.createdAt >= best.createdAt) best = rec;
        }
      }
      return best;
    },
    async update(id, patch) {
      const current = await readOne(fileFor(id));
      if (!current) return null;
      const next: OrderRecord = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
      await this.save(next);
      return next;
    },
  };
}

type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

function rowToRecord(row: Record<string, unknown>): OrderRecord | null {
  const rec = {
    id: row.id,
    kind: row.kind,
    items: row.items,
    fare: row.fare,
    serviceFee: row.service_fee,
    extrasTotal: row.extras_total,
    total: row.total,
    currency: row.currency,
    paymentIntentId: row.payment_intent_id ?? null,
    mode: row.mode,
    supplier: row.supplier,
    ...(typeof row.offer_id === 'string' && row.offer_id ? { offerId: row.offer_id } : {}),
    ...(typeof row.return_offer_id === 'string' && row.return_offer_id ? { returnOfferId: row.return_offer_id } : {}),
    ...(Array.isArray(row.duffel_order_ids) && row.duffel_order_ids.length ? { duffelOrderIds: row.duffel_order_ids as string[] } : {}),
    ...(typeof row.booking_reference === 'string' && row.booking_reference ? { bookingReference: row.booking_reference } : {}),
    ...(typeof row.traveler_email === 'string' && row.traveler_email ? { travelerEmail: row.traveler_email } : {}),
    ...(typeof row.traveler_name === 'string' && row.traveler_name ? { travelerName: row.traveler_name } : {}),
    status: row.status,
    testOrder: row.test_order === true,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ''),
  };
  return isOrderRecord(rec) ? rec : null;
}

async function postgresStore(connectionString: string): Promise<OrderStore | null> {
  try {
    const mod = await import('pg');
    const pool: PgPoolLike = new mod.Pool({
      connectionString,
      // DigitalOcean Managed Postgres requires SSL.
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(ORDERS_TABLE_SQL);
    await pool.query('SELECT 1');
    return {
      kind: 'postgres',
      async save(record) {
        await pool.query(
          `INSERT INTO orders (id, kind, items, fare, service_fee, extras_total, total, currency,
             payment_intent_id, mode, supplier, offer_id, return_offer_id, duffel_order_ids,
             booking_reference, traveler_email, traveler_name, status, test_order, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (id) DO UPDATE SET
             items = EXCLUDED.items, fare = EXCLUDED.fare, service_fee = EXCLUDED.service_fee,
             extras_total = EXCLUDED.extras_total, total = EXCLUDED.total, currency = EXCLUDED.currency,
             payment_intent_id = EXCLUDED.payment_intent_id, mode = EXCLUDED.mode, supplier = EXCLUDED.supplier,
             offer_id = EXCLUDED.offer_id, return_offer_id = EXCLUDED.return_offer_id,
             duffel_order_ids = EXCLUDED.duffel_order_ids, booking_reference = EXCLUDED.booking_reference,
             traveler_email = EXCLUDED.traveler_email, traveler_name = EXCLUDED.traveler_name,
             status = EXCLUDED.status, test_order = EXCLUDED.test_order, updated_at = EXCLUDED.updated_at`,
          [
            record.id, record.kind, JSON.stringify(record.items), record.fare, record.serviceFee,
            record.extrasTotal, record.total, record.currency, record.paymentIntentId, record.mode,
            record.supplier, record.offerId ?? null, record.returnOfferId ?? null,
            record.duffelOrderIds ? JSON.stringify(record.duffelOrderIds) : null,
            record.bookingReference ?? null, record.travelerEmail ?? null, record.travelerName ?? null,
            record.status, record.testOrder, record.createdAt, record.updatedAt,
          ]
        );
        return record;
      },
      async get(id) {
        const res = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        return res.rows.length ? rowToRecord(res.rows[0]) : null;
      },
      async findByPaymentIntent(paymentIntentId) {
        const res = await pool.query(
          'SELECT * FROM orders WHERE payment_intent_id = $1 ORDER BY created_at DESC LIMIT 1',
          [paymentIntentId]
        );
        return res.rows.length ? rowToRecord(res.rows[0]) : null;
      },
      async update(this: OrderStore, id, patch) {
        const current = await this.get(id);
        if (!current) return null;
        const next: OrderRecord = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
        await this.save(next);
        return next;
      },
    };
  } catch (err) {
    // Postgres unreachable or misconfigured — log server-side and let
    // the caller fall back to the file store. Never pretend the
    // Postgres write happened.
    console.error('[orders] Postgres unavailable, falling back to file store:', err instanceof Error ? err.message : 'unknown error');
    return null;
  }
}

// The store decision is cached per environment (DATABASE_URL /
// FUJIN_ORDERS_DIR), so tests can point at a temp dir and get a
// fresh store without a reset hook.
const storeCache = new Map<string, Promise<OrderStore>>();

export function getOrderStore(): Promise<OrderStore> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || '';
  const dir = process.env.FUJIN_ORDERS_DIR?.trim() || '';
  const cacheKey = `${databaseUrl}|${dir}`;
  const cached = storeCache.get(cacheKey);
  if (cached) return cached;
  const resolved: Promise<OrderStore> = (async () => {
    if (databaseUrl) {
      const pgStore = await postgresStore(databaseUrl);
      if (pgStore) return pgStore;
    }
    return fileStore();
  })();
  storeCache.set(cacheKey, resolved);
  return resolved;
}

export async function orderStoreKind(): Promise<'postgres' | 'file'> {
  return (await getOrderStore()).kind;
}

// ---------------------------------------------------------------------------
// Convenience wrappers — the routes call these, never the store directly
// ---------------------------------------------------------------------------

export async function saveOrder(record: OrderRecord): Promise<OrderRecord> {
  return (await getOrderStore()).save(record);
}

export async function getOrder(id: string): Promise<OrderRecord | null> {
  return (await getOrderStore()).get(id);
}

export async function findOrderByPaymentIntent(paymentIntentId: string): Promise<OrderRecord | null> {
  return (await getOrderStore()).findByPaymentIntent(paymentIntentId);
}

export async function updateOrder(id: string, patch: Partial<OrderRecord>): Promise<OrderRecord | null> {
  return (await getOrderStore()).update(id, patch);
}
