import { NextRequest, NextResponse } from 'next/server';
import { packagesResponse } from '../../../lib/packages';
import { hotelbedsBundleStatus } from '../../../lib/hotelbeds-bundle';

/**
 * GET /api/packages — the packages API (Nov 17, 2026): the 21
 * ready-made trips as JSON, for the site and the future mobile app
 * (same APIs, web first). Every price is resolved through
 * packagePrice(): a live fare when a tour supplier has connected,
 * the planner's planning estimate otherwise — labeled as such, never
 * a live quote, never an invented number.
 *
 * Query: ?featured=1 → the six featured packages; ?destination=X →
 * that one package (empty list when the planner cannot price it).
 * Always 200. The `sources` block says plainly what is live and
 * what is still waiting: Hotelbeds Bundle (dated flight + hotel
 * packaging, its own route) and the three tour suppliers whose
 * enquiries went out Nov 17, 2026 — TourRadar, Intrepid, Viator.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const featured = params.get('featured') === '1';
  const destination = (params.get('destination') ?? '').trim();
  const bundle = hotelbedsBundleStatus();
  const body = await packagesResponse(
    { featured, destination: destination || undefined },
    { enabled: bundle.enabled, configured: bundle.configured, active: bundle.active, sandbox: true }
  );
  return NextResponse.json(body);
}
