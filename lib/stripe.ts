// Stripe merchant checkout — FujinTrip collects payment on
// fujintrip.com (merchant rule, Nov 16 2026) via Stripe PaymentIntents
// + Elements. The traveler never leaves FujinTrip to pay.
//
// TEST MODE ONLY (Nov 20, 2026): there are NO live Stripe keys —
// STRIPE_SECRET_KEY is a placeholder in DigitalOcean. A key only
// counts as "configured" when it looks like a real Stripe secret key
// (sk_test_… / sk_live_…, long enough, no REPLACE_ME/PLACEHOLDER).
// Everything here is honest about that: no real key →
// stripe_not_configured, never a fake charge, never a guessed key.
//
// The Stripe SDK is loaded lazily (dynamic import) inside getStripe(),
// so the pure helpers in this file — key detection, price math,
// intent verification — are unit-testable without keys or network.
// No secrets are ever logged or returned to the browser.

import type Stripe from 'stripe';
import { serviceFee } from './planner';

export type StripeMode = 'test' | 'live' | 'not_configured';

// ---------------------------------------------------------------------------
// Key detection — a placeholder is NOT a configured key
// ---------------------------------------------------------------------------

/** The raw secret key from the environment, or null when unset/blank. */
export function stripeSecretKey(raw?: string | null): string | null {
  const k = typeof raw === 'string' ? raw : process.env.STRIPE_SECRET_KEY;
  if (typeof k !== 'string') return null;
  const trimmed = k.trim();
  return trimmed ? trimmed : null;
}

/**
 * A key counts as configured only when it looks like a real Stripe
 * secret key: sk_test_… or sk_live_… with a real key body. Anything
 * else — empty, a placeholder, a publishable key pasted by mistake —
 * is "not configured", exactly like isClerkConfigured in lib/auth.ts.
 */
export function isStripeConfigured(key?: string | null): boolean {
  const k = stripeSecretKey(key ?? undefined);
  if (!k) return false;
  if (k.length < 24) return false;
  if (k.includes('REPLACE_ME') || k.includes('PLACEHOLDER')) return false;
  return k.startsWith('sk_test_') || k.startsWith('sk_live_');
}

/** test | live | not_configured, from the secret key's shape. */
export function stripeMode(key?: string | null): StripeMode {
  if (!isStripeConfigured(key)) return 'not_configured';
  const k = stripeSecretKey(key ?? undefined)!;
  return k.startsWith('sk_live_') ? 'live' : 'test';
}

/** The browser publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY). */
export function stripePublishableKey(raw?: string | null): string | null {
  const k = typeof raw === 'string' ? raw : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (typeof k !== 'string') return null;
  const trimmed = k.trim();
  return trimmed ? trimmed : null;
}

/** A publishable key counts only as pk_test_… / pk_live_… with a body. */
export function isStripePublishableConfigured(key?: string | null): boolean {
  const k = stripePublishableKey(key ?? undefined);
  if (!k) return false;
  if (k.length < 20) return false;
  if (k.includes('REPLACE_ME') || k.includes('PLACEHOLDER')) return false;
  return k.startsWith('pk_test_') || k.startsWith('pk_live_');
}

// ---------------------------------------------------------------------------
// Stripe client (lazy — null when no real key)
// ---------------------------------------------------------------------------

let stripeClient: Stripe | null | undefined;

export async function getStripe(): Promise<Stripe | null> {
  if (stripeClient !== undefined) return stripeClient;
  const key = stripeSecretKey();
  if (!isStripeConfigured(key)) {
    // Not cached: a key added later (e.g. in tests, or a redeploy
    // that sets the env var) must be picked up on the next call.
    return null;
  }
  const mod = await import('stripe');
  const StripeCtor = mod.default;
  stripeClient = new StripeCtor(key!);
  return stripeClient;
}

// ---------------------------------------------------------------------------
// Money — whole dollars in the app, integer cents at Stripe
// ---------------------------------------------------------------------------

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

// ---------------------------------------------------------------------------
// Price breakdown — fare + tiered service fee + extras at cost = total.
// The fee tiers live in lib/planner's serviceFee ($19 < $250, $35
// $250–$800, $49 > $800 per flight order) and are never re-derived
// here. The fee is shown separately at checkout, never hidden in
// the fare.
// ---------------------------------------------------------------------------

export type PricedExtra = { label: string; amount: number }; // whole dollars, at cost

export type FlightBreakdown = {
  fare: number;
  serviceFee: number;
  extras: PricedExtra[];
  extrasTotal: number;
  total: number;
  currency: string;
};

export function flightPriceBreakdown(
  fare: number,
  currency: string,
  extras: PricedExtra[] = []
): FlightBreakdown {
  const fee = serviceFee(fare);
  const cleanExtras = extras
    .filter((e) => typeof e?.label === 'string' && e.label.trim() && typeof e?.amount === 'number' && Number.isFinite(e.amount) && e.amount >= 0)
    .map((e) => ({ label: e.label.trim(), amount: Math.round(e.amount) }));
  const extrasTotal = cleanExtras.reduce((sum, e) => sum + e.amount, 0);
  return {
    fare: Math.round(fare),
    serviceFee: fee,
    extras: cleanExtras,
    extrasTotal,
    total: Math.round(fare) + fee + extrasTotal,
    currency: (currency || 'USD').toUpperCase(),
  };
}

// ---------------------------------------------------------------------------
// PaymentIntents — create + verify. The traveler confirms on
// fujintrip.com via Elements; the server only books after the intent
// reads `succeeded` for the exact total (see verifyPaymentIntent).
// ---------------------------------------------------------------------------

export type PaymentIntentResult =
  | {
      ok: true;
      paymentIntentId: string;
      clientSecret: string;
      amountCents: number;
      currency: string;
      status: string;
    }
  | { ok: false; error: 'stripe_not_configured' | 'stripe_error'; message: string };

export async function createPaymentIntent(opts: {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
  description?: string;
}): Promise<PaymentIntentResult> {
  const stripe = await getStripe();
  if (!stripe) {
    return {
      ok: false,
      error: 'stripe_not_configured',
      message:
        'Stripe is not connected — set STRIPE_SECRET_KEY (a real sk_test_… test key) in DigitalOcean and Deploy. Nothing was charged.',
    };
  }
  if (!Number.isInteger(opts.amountCents) || opts.amountCents <= 0) {
    return { ok: false, error: 'stripe_error', message: 'Payment amount must be a positive whole number of cents.' };
  }
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: opts.amountCents,
        currency: opts.currency.toLowerCase(),
        ...(opts.description ? { description: opts.description } : {}),
        metadata: { mode: stripeMode(), ...opts.metadata },
      },
      ...(opts.idempotencyKey ? [{ idempotencyKey: opts.idempotencyKey }] : [])
    );
    if (!intent.client_secret) {
      return { ok: false, error: 'stripe_error', message: 'Stripe created the payment but returned no client secret — do not retry the charge.' };
    }
    return {
      ok: true,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amountCents: intent.amount,
      currency: intent.currency.toUpperCase(),
      status: intent.status,
    };
  } catch {
    return { ok: false, error: 'stripe_error', message: 'Stripe could not create the payment — check the key in DigitalOcean and try again. Nothing was charged.' };
  }
}

export type RetrieveIntentResult =
  | { ok: true; intent: Stripe.PaymentIntent }
  | { ok: false; error: 'stripe_not_configured' | 'not_found' | 'stripe_error'; message: string };

export async function retrievePaymentIntent(paymentIntentId: string): Promise<RetrieveIntentResult> {
  if (typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_') || paymentIntentId.length < 8) {
    return { ok: false, error: 'not_found', message: 'That payment reference is not a Stripe payment intent.' };
  }
  const stripe = await getStripe();
  if (!stripe) {
    return {
      ok: false,
      error: 'stripe_not_configured',
      message: 'Stripe is not connected — set STRIPE_SECRET_KEY in DigitalOcean. Nothing was charged.',
    };
  }
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return { ok: true, intent };
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e?.statusCode === 404) {
      return { ok: false, error: 'not_found', message: 'Stripe has no payment with that reference — it may belong to another account or was never created.' };
    }
    return { ok: false, error: 'stripe_error', message: 'Could not check that payment with Stripe right now — do not book on an unverified payment.' };
  }
}

/**
 * Pure check, no network: is this intent a confirmed payment for
 * exactly this total? The book step refuses anything else — a
 * requires_payment_method intent, a different amount, or a different
 * currency is never treated as paid.
 */
export function verifyPaymentIntentForTotal(
  intent: { status: string; amount_received?: number | null; amount?: number; currency?: string },
  expectedCents: number,
  currency: string
): { ok: true } | { ok: false; reason: 'not_succeeded' | 'amount_mismatch' | 'currency_mismatch'; status: string } {
  if (intent.status !== 'succeeded') {
    return { ok: false, reason: 'not_succeeded', status: intent.status };
  }
  const received = intent.amount_received ?? intent.amount ?? 0;
  if (received !== expectedCents) {
    return { ok: false, reason: 'amount_mismatch', status: intent.status };
  }
  if ((intent.currency || '').toUpperCase() !== currency.toUpperCase()) {
    return { ok: false, reason: 'currency_mismatch', status: intent.status };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Webhooks — verify the Stripe signature when a secret is set; degrade
// gracefully (log + reject unsigned) when it is not. Never trust an
// unverified payload.
// ---------------------------------------------------------------------------

export type WebhookVerifyResult =
  | { ok: true; event: Stripe.Event }
  | { ok: false; error: 'webhook_secret_not_configured' | 'missing_signature' | 'invalid_signature' | 'stripe_not_configured'; message: string };

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): Promise<WebhookVerifyResult> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      error: 'webhook_secret_not_configured',
      message: 'STRIPE_WEBHOOK_SECRET is not set — unsigned webhook payloads are rejected, never trusted.',
    };
  }
  if (!signature) {
    return { ok: false, error: 'missing_signature', message: 'Webhook arrived without a Stripe-Signature header — rejected.' };
  }
  const stripe = await getStripe();
  if (!stripe) {
    return {
      ok: false,
      error: 'stripe_not_configured',
      message: 'Stripe is not connected, so the webhook signature cannot be verified — rejected.',
    };
  }
  try {
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return { ok: true, event };
  } catch {
    return { ok: false, error: 'invalid_signature', message: 'Webhook signature did not verify — rejected.' };
  }
}
