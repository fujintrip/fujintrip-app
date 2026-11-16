import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';
import { AuthProvider } from '../components/AccountGate';
import { DM_Sans, Inter } from 'next/font/google';

// Type system (Nov 15, 2026): two families, self-hosted WOFF2
// variable fonts via next/font/google — no Google Fonts request at
// runtime, display:swap so a font never blocks first paint. DM Sans
// (variable, 100–1000) is the display face for headings; Inter
// 400/600/700 is the body + UI face. Prices use Inter with
// tabular-nums, not a mono face — the primary font system is
// Inter + DM Sans.
const dmSans = DM_Sans({
  subsets: ['latin'],
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
      className={`${dmSans.variable} ${inter.variable}`}
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
