import FujinApp from '../components/FujinApp';
import { homeTabIdFromQuery } from '../lib/homeTabs';

// The homepage tabs are deep-linkable (?tab=hotels): the server reads
// the param so a shared link — and the tests — land on the right panel.
export default function HomePage({ searchParams }: { searchParams?: { tab?: string | string[] } }) {
  return <FujinApp variant="home" initialTab={homeTabIdFromQuery(searchParams?.tab ?? null)} />;
}
