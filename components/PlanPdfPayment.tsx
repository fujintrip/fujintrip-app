// Plan PDF $1 payment (Stripe test mode, Nov 20, 2026).
// Shown by FujinChat when /api/plan-download returns a $1
// PaymentIntent: the traveler pays $1 ON fujintrip.com via Elements
// (test card 4242 4242 4242 4242) — never redirected anywhere.
// onPaid fires with the confirmed payment intent id; FujinChat then
// re-POSTs to /api/plan-download, which verifies the $1 before the
// PDF opens. Without a Stripe key the route never returns a
// clientSecret, so this component never renders.
'use client';
import { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

function PdfPaymentForm({ onPaid, onError }: { onPaid: (paymentIntentId: string) => void; onError: (message: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form
      className="no-print"
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
          onPaid(intent.id);
        } else {
          setMessage('The $1 payment did not confirm — no PDF was downloaded and nothing was charged.');
          setBusy(false);
        }
      }}
    >
      <p style={{ fontSize: 13, margin: '4px 0' }}>
        Test mode — use card 4242 4242 4242 4242, any future expiry, any CVC. No real card is charged.
      </p>
      <PaymentElement />
      {message && <p className="notice" role="alert">{message}</p>}
      <button type="submit" className="primary" disabled={!stripe || busy} style={{ marginTop: 12 }}>
        {busy ? 'Confirming…' : 'Pay $1'}
      </button>
    </form>
  );
}

export default function PlanPdfPayment({
  clientSecret,
  onPaid,
  onCancel,
}: {
  clientSecret: string;
  onPaid: (paymentIntentId: string) => void;
  onCancel: () => void;
}) {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );
  if (!stripePromise) {
    return (
      <p style={{ fontSize: 13, margin: '4px 0' }}>
        The card form needs the publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) — the secret key alone is not
        enough. Nothing was charged and no PDF was downloaded.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { variables: { colorPrimary: '#4a3f4b' } } }}>
        <PdfPaymentForm onPaid={onPaid} onError={() => {}} />
      </Elements>
      <p style={{ margin: '8px 0 0' }}>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </p>
    </div>
  );
}
