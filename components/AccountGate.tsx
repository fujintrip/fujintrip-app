'use client';

// Free-account gate — the React side of lib/auth.ts (Clerk, email magic
// link, user chose Nov 14 2026). Two branches, never mixed:
//
//  - Keys set: <ClerkProvider> wraps the app; Clerk's prebuilt
//    sign-in / sign-up components do the work. No Google sign-in —
//    that is one toggle in the Clerk dashboard later if the user wants
//    it. The dashboard must have "Email verification link" enabled
//    (User & Authentication → Email, Phone, Username → Authentication
//    strategies) so the magic link is what travelers get.
//  - Keys absent: NO ClerkProvider is rendered at all (Clerk throws
//    without a publishable key), no Clerk component is ever mounted,
//    and useAccount() reports configured:false. The gate then shows
//    "sign-in isn't set up yet" and the rest of the app works exactly
//    as before — the chat, tabs and results never depend on Clerk.
//
// Sign-in must never gate the chat: these components only appear on
// the Save/Download path (the plan panel) and in My Trips.
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from '@clerk/nextjs';
import {
  CLERK_SIGN_IN_URL,
  CLERK_SIGN_UP_URL,
  isClerkConfigured,
} from '../lib/auth';

export interface AccountState {
  configured: boolean;
  signedIn: boolean;
  userId: string | null;
  email: string | null;
}

const AccountContext = createContext<AccountState>({
  configured: false,
  signedIn: false,
  userId: null,
  email: null,
});

export function useAccount(): AccountState {
  return useContext(AccountContext);
}

// Inside <ClerkProvider>: read the real session. useUser() must only
// ever run under a ClerkProvider, so it lives in this branch alone.
function ClerkAccount({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const state: AccountState = {
    configured: true,
    signedIn: isLoaded && !!isSignedIn,
    userId: user?.id ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
  };
  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>;
}

function NoClerkAccount({ children }: { children: ReactNode }) {
  return (
    <AccountContext.Provider
      value={{ configured: false, signedIn: false, userId: null, email: null }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!isClerkConfigured(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    return <NoClerkAccount>{children}</NoClerkAccount>;
  }
  return (
    <ClerkProvider signInUrl={CLERK_SIGN_IN_URL} signUpUrl={CLERK_SIGN_UP_URL}>
      <ClerkAccount>{children}</ClerkAccount>
    </ClerkProvider>
  );
}

// App-bar account control: nothing at all until Clerk is wired (no dead
// "Sign in" button while the keys are missing); a user button once
// signed in; sign-in / create-account (modal, prebuilt) while signed
// out. The modal keeps the traveler on the page they were on.
export function AccountButton() {
  const { configured, signedIn } = useAccount();
  if (!configured) return null;
  if (signedIn) return <UserButton />;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <SignInButton mode="modal">
        <button type="button" className="ghost">
          Sign in
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button type="button" className="primary">
          Create free account
        </button>
      </SignUpButton>
    </span>
  );
}

// The Save/Download gate notice for the plan panel: shown when an
// unsigned traveler taps "Save as PDF". After signing in (the modal
// closes on the same page) they tap Save as PDF again — the notice says
// so. When Clerk isn't wired yet, it says that plainly instead of
// offering a sign-in that cannot work.
export function SavePdfGateNotice({ onDismiss }: { onDismiss?: () => void }) {
  const { configured } = useAccount();
  if (!configured) {
    return (
      <div style={{ fontSize: 13, color: '#111', marginTop: 8 }}>
        <p style={{ margin: '4px 0' }}>
          Saving your plan as a PDF needs a free account — and sign-in
          isn&apos;t set up yet. The site owner connects Clerk first;
          until then your plan stays saved here and nothing is charged.
        </p>
        {onDismiss ? (
          <p style={{ margin: '4px 0' }}>
            <button type="button" className="ghost" onClick={onDismiss}>
              Dismiss
            </button>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13, color: '#111', marginTop: 8 }}>
      <p style={{ margin: '4px 0' }}>
        Saving your plan as a PDF needs a free account — sign in with a
        magic link (no password) and it&apos;s ready to download. The
        download itself is $1 unless you booked with us.
      </p>
      <p style={{ margin: '4px 0' }}>
        <SignInButton mode="modal">
          <button type="button" className="ghost">
            Sign in with a magic link
          </button>
        </SignInButton>{' '}
        <a href={CLERK_SIGN_UP_URL} className="ghost" style={{ textDecoration: 'none' }}>
          Create a free account
        </a>
        {onDismiss ? (
          <>
            {' '}
            <button type="button" className="ghost" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
