// Offline banner (community round, design §7): a slim banner instead of
// a dead screen. When the connection drops, the traveler sees what still
// works (the saved plan) and what does not (live fares, chat replies,
// new posts). The saved-at time is the offline snapshot's timestamp —
// the plan is never presented as fresher than it is.
'use client';
import { useEffect, useState } from 'react';

export default function OfflineBanner({ savedAt }: { savedAt?: string | null }) {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <strong>You&apos;re offline</strong> — showing your saved plan
      {savedAt ? `, updated ${new Date(savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.
      Live fares, chat replies and new posts need a connection.
    </div>
  );
}
