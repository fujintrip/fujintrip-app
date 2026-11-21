import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';
import { AuthProvider } from '../components/AccountGate';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';

// Type system (Nov 15, 2026; display face changed Nov 21 — UX
// direction round 2, P0-2): two families, self-hosted WOFF2 variable
// fonts via next/font/google — no Google Fonts request at runtime,
// display:swap so a font never blocks first paint. Plus Jakarta Sans
// (variable, 200–800) is the display face for headings, the hero and
// prices; Inter 400/600/700 is the body + UI face. DM Sans was dropped
// — it spoke in the same voice as Inter, so headings and body looked
// identical. Prices use the display face with tabular-nums, not a mono
// face.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '600', '700'],
  display: 'swap',
});

// The theme script runs BEFORE first paint (no flash): a stored choice
// beats the OS preference, because the traveler chose it on purpose.
// Kept in sync with lib/theme.ts (readTheme/applyTheme).
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('fujintrip-theme');if(!t)t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'FujinTrip — Ride the wind. Pay less.',
  description: 'One complete, customized travel plan — flights, hotels, cars and sightseeing in Cheapest / Best value / Premium. Quality plus affordable prices.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Offline plan: registers public/sw.js so the app shell loads
            with no connection and the saved plan opens offline. */}
        <ServiceWorkerRegister />
        {/* Free-account gate (Clerk, Nov 14 2026): renders no
            ClerkProvider at all until the Clerk keys are set, so the
            site works exactly as before with no keys. */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
