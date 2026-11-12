// Registers the offline service worker (public/sw.js). The worker
// caches the app shell so the saved plan opens with no connection;
// registration failure (old browser, file://) is silent — the plan in
// localStorage still works while online, and the Today view says so.
'use client';
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
