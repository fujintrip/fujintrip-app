import { NextRequest, NextResponse } from 'next/server';
import { packagesResponse } from '../../../lib/packages';
import { hotelbedsBundleStatus } from '../../../lib/hotelbeds-bundle';

/**
 * GET /api/packages — the packages API (Nov 17, 2026): the 21
 * ready-made trips as JSON, for the site and the future mobile app
 * (same APIs, web first). Every price is resolved through
 * packagePrice(): a Hotelbeds Bundle fare when the packaging search
 * returns one for the package (sandbox test data, labeled as such),
 * a live tour-supplier fare when one connects, the planner's
 * planning estimate otherwise — labeled as such, never a live quote,
 * never an invented number.
 *
 * Query: ?featured=1 → the six featured packages; ?destination=X →
 * that one package (empty list when the planner cannot price it);
 * ?checkIn=YYYY-MM-DD → the Bundle search start date (the stay
 * length is always the package's nights; without it each package is
 * searched on the 1st of its best month at its next occurrence).
 * Always 200. The `sources` block says plainly what is live and
 * what is still waiting: Hotelbeds Bundle (packaged hotel rates, its
 * own route at /api/hotelbeds-bundle) and the three tour suppliers
 * whose enquiries went out Nov 17, 2026 — TourRadar, Intrepid,
 * Viator.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const featured = params.get('featured') === '1';
  const destination = (params.get('destination') ?? '').trim();
  const checkIn = (params.get('checkIn') ?? '').trim();
  const bundle = hotelbedsBundleStatus();
  const body = await packagesResponse(
    { featured, destination: destination || undefined, checkIn: checkIn || undefined },
    { enabled: bundle.enabled, configured: bundle.configured, active: bundle.active, sandbox: true }
  );
  return NextResponse.json(body);
}
