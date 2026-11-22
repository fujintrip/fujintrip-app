// Checkout flow — traveler pays ON fujintrip.com (merchant rule,
// Nov 16 2026) via Stripe PaymentIntents + Elements. Steps:
//   traveler details → validate → price breakdown + payment
//   (Elements) → confirmation.
// TEST MODE ONLY (Nov 20, 2026): no live Stripe keys exist. While
// Stripe is in test mode the page carries an unmissable TEST MODE
// banner and names the test card. Duffel test fares are test-only,
// never real prices, and the confirmation says so. If Stripe is not
// configured at all, the page says so instead of showing a card form.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

export type CheckoutParams = {
  offerId: string;
  returnOfferId: string;
  origin: string;
  destination: string;
  date: string;
  returnDate: string;
  travelers: number;
  fare: number;
  currency: string;
  airline: string;
};

type PassengerForm = {
  given_name: string;
  family_name: string;
  born_on: string;
  gender: 'm' | 'f';
  email: string;
  phone_number: string;
};

type Breakdown = {
  fare: number;
  serviceFee: number;
  extras: Array<{ label: string; amount: number }>;
  extrasTotal: number;
  total: number;
  currency: string;
};

type CheckoutStatus = {
  stripeConfigured: boolean;
  stripeMode: 'test' | 'live' | 'not_configured';
  stripePublishableConfigured: boolean;
  duffelMode: 'test' | 'live' | 'none';
};

const emptyPassenger = (): PassengerForm => ({
  given_name: '',
  family_name: '',
  born_on: '',
  gender: 'f',
  email: '',
  phone_number: '',
});

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString()}`;
}

// The card form inside Elements. Separated so it can use the
// useStripe/useElements hooks (they only work under <Elements>).
function PaymentForm({
  total,
  currency,
  onConfirmed,
  onError,
}: {
  total: number;
  currency: string;
  onConfirmed: (paymentIntentId: string) => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements || busy) return;
        setBusy(true);
        setMessage('');
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: { return_url: window.location.href },
          redirect: 'if_required',
        });
        if (result.error) {
          setMessage(result.error.message ?? 'The card was declined — try another card.');
          onError(result.error.message ?? 'The card was declined.');
          setBusy(false);
          return;
        }
        const intent = result.paymentIntent;
        if (intent && intent.status === 'succeeded') {
          onConfirmed(intent.id);
        } else {
          setMessage(
            intent
              ? `The payment is ${intent.status} — it has not been confirmed yet, so nothing was booked.`
              : 'The payment did not confirm — nothing was booked.'
          );
          setBusy(false);
        }
      }}
    >
      <PaymentElement />
      {message && <p className="notice" role="alert">{message}</p>}
      <button type="submit" className="primary" disabled={!stripe || busy} style={{ marginTop: 16 }}>
        {busy ? 'Confirming…' : `Pay ${money(total, currency)}`}
      </button>
      <p className="card-note" style={{ marginTop: 8 }}>
        You pay FujinTrip on this page. FujinTrip settles with the airline after booking — you never pay on a supplier page.
      </p>
    </form>
  );
}

export default function CheckoutFlow({ params }: { params: CheckoutParams }) {
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [step, setStep] = useState<'details' | 'payment' | 'done'>('details');
  const [passengers, setPassengers] = useState<PassengerForm[]>(() =>
    Array.from({ length: Math.min(9, Math.max(1, params.travelers)) }, emptyPassenger)
  );
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [clientSecret, setClientSecret] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [bookingReference, setBookingReference] = useState('');
  const [duffelOrderIds, setDuffelOrderIds] = useState<string[]>([]);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/checkout')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setStatus({
          stripeConfigured: Boolean(j.stripeConfigured),
          stripeMode: j.stripeMode ?? 'not_configured',
          stripePublishableConfigured: Boolean(j.stripePublishableConfigured),
          duffelMode: j.duffelMode ?? 'none',
        });
      })
      .catch(() => {
        if (!cancelled) setStatusError('Couldn’t reach the checkout service — try again in a moment.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A 3-D Secure redirect returns here with ?payment_intent=… — the
  // intent is already confirmed, so the traveler finishes the booking
  // from the saved details instead of paying twice.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pi = q.get('payment_intent');
    const redirectStatus = q.get('redirect_status');
    if (pi && redirectStatus === 'succeeded') {
      try {
        const saved = JSON.parse(sessionStorage.getItem('fujintrip-checkout') ?? 'null') as
          | { passengers: PassengerForm[]; offerId: string; returnOfferId: string }
          | null;
        if (saved && saved.offerId === params.offerId) {
          setPassengers(saved.passengers);
          setPaymentIntentId(pi);
          setStep('payment');
          setFormError('Your card payment was confirmed — press “Complete booking” below to finish.');
        }
      } catch {
        // Corrupt saved details — the traveler re-enters them; the
        // payment itself is verified server-side at book time.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasOffer = Boolean(params.offerId);
  const testMode = status?.stripeMode === 'test';

  const setPassenger = (i: number, patch: Partial<PassengerForm>) => {
    setPassengers((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  const validateDetails = async () => {
    setFormError('');
    for (let i = 0; i < passengers.length; i += 1) {
      const p = passengers[i];
      if (!p.given_name.trim() || !p.family_name.trim()) {
        setFormError(`Traveler ${i + 1}: first and last name are needed.`);
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.born_on)) {
        setFormError(`Traveler ${i + 1}: date of birth must be YYYY-MM-DD.`);
        return;
      }
      if (i === 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
        setFormError('Traveler 1: a valid email is needed — the booking confirmation goes there.');
        return;
      }
    }
    setBusy(true);
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate',
          offerId: params.offerId,
          passengers: passengers.map((p) => ({
            given_name: p.given_name.trim(),
            family_name: p.family_name.trim(),
            born_on: p.born_on,
            gender: p.gender,
            ...(p.email ? { email: p.email.trim() } : {}),
            ...(p.phone_number ? { phone_number: p.phone_number.trim() } : {}),
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.readyToBook) {
        setFormError(
          j.label ||
            (j.errors?.[0] as string | undefined) ||
            'Those traveler details did not validate — check the names and dates of birth.'
        );
        return;
      }
      // Create the payment intent — the exact total comes back from
      // the server (fare + service fee), never from this page.
      const pay = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pay',
          offerId: params.offerId,
          ...(params.returnOfferId ? { returnOfferId: params.returnOfferId } : {}),
          origin: params.origin,
          destination: params.destination,
          passengers: passengers.map((p) => ({
            given_name: p.given_name.trim(),
            family_name: p.family_name.trim(),
            born_on: p.born_on,
            gender: p.gender,
            ...(p.email ? { email: p.email.trim() } : {}),
            ...(p.phone_number ? { phone_number: p.phone_number.trim() } : {}),
          })),
        }),
      });
      const pj = await pay.json().catch(() => ({}));
      if (!pay.ok || !pj.ok) {
        setFormError(pj.message ?? 'The payment could not be prepared — nothing was charged.');
        return;
      }
      try {
        sessionStorage.setItem(
          'fujintrip-checkout',
          JSON.stringify({ passengers, offerId: params.offerId, returnOfferId: params.returnOfferId })
        );
      } catch {
        // Storage unavailable — the 3-D Secure return path just asks
        // the traveler to re-enter details; payment stays safe.
      }
      setBreakdown(pj.breakdown as Breakdown);
      setClientSecret(pj.clientSecret as string);
      setPaymentIntentId(pj.paymentIntentId as string);
      setOrderId(pj.orderId as string);
      setStep('payment');
    } catch {
      setFormError('Couldn’t reach the checkout service — try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const completeBooking = async (intentId: string) => {
    setBusy(true);
    setFormError('');
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'book',
          offerId: params.offerId,
          ...(params.returnOfferId ? { returnOfferId: params.returnOfferId } : {}),
          confirm: true,
          paymentIntentId: intentId,
          passengers: passengers.map((p) => ({
            given_name: p.given_name.trim(),
            family_name: p.family_name.trim(),
            born_on: p.born_on,
            gender: p.gender,
            ...(p.email ? { email: p.email.trim() } : {}),
            ...(p.phone_number ? { phone_number: p.phone_number.trim() } : {}),
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setFormError(j.message ?? 'The booking could not be completed — the payment status was not confirmed.');
        return;
      }
      setOrderId(j.orderId as string);
      setBookingReference((j.bookingReference as string | undefined) ?? '');
      setDuffelOrderIds((j.duffelOrderIds as string[] | undefined) ?? []);
      setStep('done');
    } catch {
      setFormError('Couldn’t reach the checkout service — check My Trips before retrying, so the booking is not made twice.');
    } finally {
      setBusy(false);
    }
  };

  if (!hasOffer) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Checkout</h2>
        <p>No flight was selected for checkout. Pick a fare from the flight results first — the Duffel cards link here with the fare.</p>
        <a className="primary" href="/?tab=flights">Search flights</a>
      </div>
    );
  }

  return (
    <div className="checkout-wrap">
      <h1 style={{ marginBottom: 4 }}>Checkout</h1>
      <p className="card-note" style={{ marginTop: 0 }}>
        {params.airline ? `${params.airline} · ` : ''}
        {params.origin} → {params.destination}
        {params.date ? ` · ${params.date}` : ''}
        {params.returnDate ? ` – ${params.returnDate}` : ''} · {params.travelers} traveler
        {params.travelers > 1 ? 's' : ''}
      </p>

      {testMode && (
        <p className="fare-test-warning" role="status">
          TEST MODE — no real card is charged and no real ticket is booked. Use test card 4242 4242 4242 4242, any
          future expiry, any CVC.
        </p>
      )}
      {status && !status.stripeConfigured && (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ margin: 0 }}>
            Payments aren’t connected yet — Stripe needs its test key before anyone can pay. Your fare is saved;
            nothing was charged.
          </p>
        </div>
      )}
      {statusError && <p className="notice" role="alert">{statusError}</p>}

      {step === 'details' && (
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Traveler details</h2>
          {params.fare > 0 && (
            <p className="card-note">
              Fare from your search: {money(params.fare, params.currency)} — the exact total (fare + service fee) is
              confirmed at payment. Duffel test fare — not a real price.
            </p>
          )}
          {passengers.map((p, i) => (
            <fieldset key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <legend style={{ fontWeight: 600 }}>Traveler {i + 1}</legend>
              <div className="checkout-fields">
                <label>
                  First name
                  <input value={p.given_name} onChange={(e) => setPassenger(i, { given_name: e.target.value })} autoComplete="given-name" />
                </label>
                <label>
                  Last name
                  <input value={p.family_name} onChange={(e) => setPassenger(i, { family_name: e.target.value })} autoComplete="family-name" />
                </label>
                <label>
                  Date of birth
                  <input type="date" value={p.born_on} onChange={(e) => setPassenger(i, { born_on: e.target.value })} />
                </label>
                <label>
                  Gender
                  <select value={p.gender} onChange={(e) => setPassenger(i, { gender: e.target.value as 'm' | 'f' })}>
                    <option value="f">Female</option>
                    <option value="m">Male</option>
                  </select>
                </label>
                <label>
                  Email {i === 0 ? '(required — confirmation goes here)' : '(optional)'}
                  <input type="email" value={p.email} onChange={(e) => setPassenger(i, { email: e.target.value })} autoComplete="email" />
                </label>
                <label>
                  Phone (optional)
                  <input type="tel" value={p.phone_number} onChange={(e) => setPassenger(i, { phone_number: e.target.value })} autoComplete="tel" />
                </label>
              </div>
            </fieldset>
          ))}
          {formError && <p className="notice" role="alert">{formError}</p>}
          <button type="button" className="primary" onClick={validateDetails} disabled={busy || !status?.stripeConfigured}>
            {busy ? 'Checking…' : 'Review & pay'}
          </button>
          {!status?.stripeConfigured && (
            <p className="card-note">The payment step unlocks once Stripe’s test key is connected.</p>
          )}
        </div>
      )}

      {step === 'payment' && (breakdown || paymentIntentId) && (
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Price breakdown</h2>
          {breakdown ? (
            <>
              <dl className="price-rows">
                <div>
                  <dt>Airfare (passed through at cost)</dt>
                  <dd>{money(breakdown.fare, breakdown.currency)}</dd>
                </div>
                <div>
                  <dt>FujinTrip service fee</dt>
                  <dd>{money(breakdown.serviceFee, breakdown.currency)}</dd>
                </div>
                {breakdown.extras.map((e, i) => (
                  <div key={i}>
                    <dt>{e.label} (at cost)</dt>
                    <dd>{money(e.amount, breakdown.currency)}</dd>
                  </div>
                ))}
                <div className="price-total">
                  <dt>Total</dt>
                  <dd>{money(breakdown.total, breakdown.currency)}</dd>
                </div>
              </dl>
              <p className="card-note">
                The service fee is shown separately — never hidden in the fare. Duffel test fare: this is a test booking,
                not a real ticket.
              </p>
            </>
          ) : (
            <p className="card-note">
              Your card payment was confirmed — press “Complete booking” below to finish the test booking.
            </p>
          )}
          {formError && <p className="notice" role="alert">{formError}</p>}
          {clientSecret && stripePromise && breakdown ? (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { variables: { colorPrimary: '#0066cc' } } }}>
              <PaymentForm
                total={breakdown.total}
                currency={breakdown.currency}
                onConfirmed={(intentId) => completeBooking(intentId)}
                onError={(msg) => setFormError(msg)}
              />
            </Elements>
          ) : clientSecret ? (
            <p className="notice">
              The card form needs the publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) — the secret key alone is
              not enough. Nothing was charged.
            </p>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => completeBooking(paymentIntentId)}>
              {busy ? 'Completing…' : 'Complete booking'}
            </button>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Booking confirmed — test booking</h2>
          <p>
            Thank you — your test booking is confirmed. This is a Duffel test order: no real ticket was issued and no
            real card was charged.
          </p>
          <dl className="price-rows">
            <div>
              <dt>Order</dt>
              <dd>{orderId}</dd>
            </div>
            {bookingReference && (
              <div>
                <dt>Booking reference</dt>
                <dd>{bookingReference}</dd>
              </div>
            )}
            {duffelOrderIds.length > 0 && (
              <div>
                <dt>Duffel test order{duffelOrderIds.length > 1 ? 's' : ''}</dt>
                <dd>{duffelOrderIds.join(', ')}</dd>
              </div>
            )}
            {breakdown && (
              <div className="price-total">
                <dt>Total paid (test)</dt>
                <dd>{money(breakdown.total, breakdown.currency)}</dd>
              </div>
            )}
          </dl>
          <p>
            <a className="primary" href="/account">View in My Trips</a>{' '}
            <a className="ghost" href="/">Back to search</a>
          </p>
        </div>
      )}
    </div>
  );
}
