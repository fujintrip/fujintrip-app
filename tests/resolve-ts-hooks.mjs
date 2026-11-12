// Node ESM resolve hook for the durable test suites in this folder.
//
// The app's lib/*.ts files import each other with extensionless relative
// paths ('./planner'), which Node's ESM loader rejects. This hook retries
// a failed relative resolution with '.ts' appended, so `node` can import
// the TypeScript sources directly (Node 24 strips types natively) — no
// build step, no copies in /tmp that get wiped.
//
// Usage: node --no-warnings --import ./tests/register-loader.mjs tests/<suite>.mjs
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return nextResolve(specifier + '.ts', context);
    }
  }
  return nextResolve(specifier, context);
}
