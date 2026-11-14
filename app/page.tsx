import FujinApp from '../components/FujinApp';
import { homeTabIdFromQuery } from '../lib/homeTabs';
import { searchQueryFromParams } from '../lib/searchPlaces';

// The homepage tabs are deep-linkable (?tab=hotels): the server reads
// the param so a shared link — and the tests — land on the right tab.
// A full search deep link (?tab=flights&from=...&to=...&depart=...&return=...)
// also carries the search itself: the widget auto-submits it on mount
// so the results render without another click (direction v3).
export default function HomePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const params = searchParams ?? {};
  return <FujinApp variant="home" initialTab={homeTabIdFromQuery(params.tab ?? null)} initialSearch={searchQueryFromParams(params)} />;
}
