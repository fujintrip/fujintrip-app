import { SignUp } from '@clerk/nextjs';
import { isClerkConfigured } from '../../../lib/auth';

// Sign-up page — Clerk's prebuilt <SignUp /> (email magic link, per the
// user's Nov 14 2026 pick; Google is NOT enabled — one toggle in the
// Clerk dashboard later if wanted). The dashboard must have "Email
// verification link" enabled (User & Authentication → Email, Phone,
// Username → Authentication strategies).
// When the Clerk keys are absent the prebuilt form cannot render, so
// the page says sign-in isn't set up yet instead of crashing.
export default function SignUpPage() {
  if (!isClerkConfigured(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    return (
      <main className="wrap" style={{ maxWidth: 560, padding: '48px 16px' }}>
        <h1>Sign up isn&apos;t set up yet</h1>
        <p>
          A free account signs you up with a magic link (no password) —
          but sign-in isn&apos;t connected yet. The site owner adds the
          Clerk keys first; until then your trips stay saved on this
          device and everything else on the site works as normal.
        </p>
        <p>
          <a href="/">Back to FujinTrip</a>
        </p>
      </main>
    );
  }
  return (
    <main
      className="wrap"
      style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px' }}
    >
      <SignUp />
    </main>
  );
}
