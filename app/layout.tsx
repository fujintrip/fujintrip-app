import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';

// Type system (Layla-interface direction §6): two families + a mono
// accent, self-hosted WOFF2 variable fonts via next/font/google — no
// Google Fonts request at runtime, display:swap so a font never blocks
// first paint. Only the faces the scale uses are requested:
// Bricolage 700/800 (display), Inter 400/600/700 (body), JetBrains Mono
// 600 (prices you compare).
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['700', '800'],
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '600', '700'],
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['600'],
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
      className={`${bricolage.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Offline plan: registers public/sw.js so the app shell loads
            with no connection and the saved plan opens offline. */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
