# context-extractor (JS/TS automation)

Node/Playwright twin of the Python `automation/` package — same
`extension/core/dom.js` + `extension/core/prompt.js` (via symlinks in
`src/js/`), same output shape, same test fixture. Use this one from Node
tooling (Playwright, `playwright-core`, or [camoufox-js](https://www.npmjs.com/package/camoufox-js))
instead of shelling out to Python.

One `ExtractorSession` class covers both sync/async use cases — Node's
Playwright API is async-only to begin with, so there's no sync/async split
like the Python package's `ExtractorSession` / `AsyncExtractorSession`.

## Install

```bash
cd automation-js
npm install
npm run build
```

Not published to a registry yet — consume it from this checkout via a
relative `file:` dependency, or copy `dist/` + `dist/js/` into a consumer.

## Use

```ts
import { chromium } from 'playwright-core'; // or 'playwright', or camoufox-js
import { ExtractorSession } from 'context-extractor'; // this package

const browser = await chromium.launch();
const page = await browser.newPage();
const session = new ExtractorSession(page); // attach BEFORE navigating

await page.goto('https://example.com', { waitUntil: 'networkidle' });

console.log(await session.buildAiPrompt()); // or session.extractMarkdown('#main')
console.log(session.getStore());            // { console, errors, network }
```

With [camoufox-js](https://www.npmjs.com/package/camoufox-js) — same idea,
`launchServer`/`launchOptions` differ but the returned `page` is a normal
Playwright `Page`:

```ts
import { launchOptions } from 'camoufox-js';
import { firefox } from 'playwright-core';
import { ExtractorSession } from 'context-extractor';

const browser = await firefox.launch(await launchOptions({ headless: false }));
const page = await browser.newPage();
const session = new ExtractorSession(page);
```

## Why this exists (vs. shelling out to the Python package)

If your automation is already Node/Playwright (Cursor-driven scripts, a
`camoufox-js` session, a Playwright test suite), the Python package meant
spawning a subprocess and shipping JSON across a process boundary just to get
a markdown dump. This package removes that boundary — same core JS, same
output, but a normal `import` + `await` in the same process/event loop as the
rest of your automation.

## Tests

```bash
npm test
```

Runs against a real headless Chromium (`playwright-core`) loading the shared
fixture at `../automation/tests/fixtures/sample.html` — the exact same file
the Python `automation/tests/test_session.py` suite uses, so a
markdown-formatting regression can't silently diverge between the two
automation layers.

## Notes

- `extractMarkdown(selector?)` returns `{ url, title, ts, selector, markdown }`.
- `buildAiPrompt(selector?, maxChars?)` wraps that in the same
  `# Page Context` / `## Page Content` / errors / console / network prompt
  format as the extension's Copy button and the Python package.
- `getStore()` / `clear(which?)` expose the same bounded ring buffers
  (`console`, `errors`, `network`, capped at 200 entries each) as the Python
  `_Store`.
- Call `session.detach()` if you keep a page open long after you're done
  capturing and want to stop accumulating entries.
