import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextMiddleware, NextRequest } from 'next/server';

// Clerk middleware — guarded, because the Clerk keys do not exist yet
// (the user creates the Clerk account and adds the keys in DigitalOcean;
// until then every request passes straight through, so the site works
// exactly as before with no keys and no Clerk code path is ever
// constructed). Once CLERK_SECRET_KEY exists, Clerk loads the session
// for every request — but NO route is protected here: the gate is the
// Save/Download buttons in the UI, and browsing, the tabs, the results
// and the chat stay public by design. The handler is built lazily so a
// missing key can never throw at module scope.
let clerkHandler: NextMiddleware | null = null;

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY) return NextResponse.next();
  if (!clerkHandler) clerkHandler = clerkMiddleware();
  return clerkHandler(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
