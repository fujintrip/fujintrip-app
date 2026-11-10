import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import './globals.css';

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces' });

export const metadata: Metadata = {
  title: 'FujinTrip — Ride the wind. Pay less.',
  description: 'One complete, customized travel plan — flights, hotels, cars and sightseeing in Cheapest / Best value / Premium. Quality plus affordable prices.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fraunces.variable}>
      <body>{children}</body>
    </html>
  );
}
