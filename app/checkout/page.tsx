// /checkout — Stripe test-mode checkout (Nov 20, 2026).
// Traveler details → price breakdown → payment (Stripe Elements,
// on fujintrip.com) → confirmation. Test mode only: no live keys
// exist, so no real card is ever charged and no real ticket booked.
'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import SiteHeader from '../../components/SiteHeader';
import CheckoutFlow, { type CheckoutParams } from '../../components/CheckoutFlow';
import { useTheme } from '../../lib/theme';

function paramsFromSearch(searchParams: URLSearchParams): CheckoutParams {
  const num = (key: string, fallback: number) => {
    const v = Number(searchParams.get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    offerId: searchParams.get('offerId') ?? '',
    returnOfferId: searchParams.get('returnOfferId') ?? '',
    origin: searchParams.get('origin') ?? '',
    destination: searchParams.get('destination') ?? '',
    date: searchParams.get('date') ?? '',
    returnDate: searchParams.get('returnDate') ?? '',
    travelers: Math.min(9, Math.max(1, num('travelers', 1))),
    fare: num('fare', 0),
    currency: searchParams.get('currency') ?? 'USD',
    airline: searchParams.get('airline') ?? '',
  };
}

function CheckoutInner() {
  const searchParams = useSearchParams();
  const [theme, setTheme] = useTheme();
  return (
    <>
      <SiteHeader theme={theme} onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} myTripsHref="/account" />
      <main className="wrap">
        <CheckoutFlow params={paramsFromSearch(searchParams)} />
      </main>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<main className="wrap"><p>Loading checkout…</p></main>}>
      <CheckoutInner />
    </Suspense>
  );
}
