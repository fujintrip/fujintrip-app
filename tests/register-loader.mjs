// Registers the extensionless-.ts resolve hook for the test suites.
// Imported via: node --no-warnings --import ./tests/register-loader.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./resolve-ts-hooks.mjs', import.meta.url));
