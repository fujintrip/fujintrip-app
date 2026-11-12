import type { Metadata } from 'next';
import './globals.css';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';
// Modern look, like Layla: the system sans stack — no display serif,
// no downloaded font. (Fraunces was the old Japanese gold-leaf theme.)

export const metadata: Metadata = {
  title: 'FujinTrip — Ride the wind. Pay less.',
  description: 'One complete, customized travel plan — flights, hotels, cars and sightseeing in Cheapest / Best value / Premium. Quality plus affordable prices.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Offline plan: registers public/sw.js so the app shell loads
            with no connection and the saved plan opens offline. */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
