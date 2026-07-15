import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read one of the shared `extension/core/*.js` files from disk, the same way
 * the Python `automation/` package's `_read_js()` does — so both automation
 * layers (and the browser extension) run byte-identical DOM/prompt logic.
 *
 * Resolves `js/<name>` next to this module: `src/js/*.js` (symlinks into
 * `../../extension/core/`) when running from TS source, or `dist/js/*.js`
 * (copied by `npm run build`) once built.
 */
export function readSharedJs(name: 'dom.js' | 'prompt.js'): string {
  const path = join(here, 'js', name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing shared JS file: ${path}. This package expects to run from a checkout of the ` +
        'context-extractor repo where automation-js/src/js/*.js are symlinks into extension/core/ ' +
        '(and, once built, dist/js/*.js — see the copy-js build step).',
    );
  }
  return readFileSync(path, 'utf-8');
}
