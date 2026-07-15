# Context Extractor

**Repo:** [git.levkin.ca/ilia/context-extractor](https://git.levkin.ca/ilia/context-extractor)  
**Clone:** `gitea@git.levkin.ca:ilia/context-extractor.git`

Capture console logs, network activity, JS errors, and clean markdown content
from a webpage, formatted as an AI-ready prompt. Ships two ways from one
shared core:

- **`extension/`** — a browser extension (Manifest V3) for interactive use.
- **`automation/`** — a Python package for scripted/headless use with
  Playwright or [Camoufox](https://camoufox.com).

```
context-extractor/
├── extension/                   browser extension (Chrome + Brave, unpacked)
│   ├── core/dom.js              ← shared: selector + markdown extraction
│   ├── core/prompt.js           ← shared: AI-prompt formatter
│   ├── page-patcher.js          MAIN-world console/fetch/XHR/error capture
│   ├── content.js               ISOLATED-world store, picker, messaging
│   ├── background.js
│   └── popup.html / popup.js
├── automation/                  Python package for Playwright / Camoufox
│   ├── context_extractor/       session + CLI
│   │   └── js/                  symlinks → extension/core/*.js
│   └── tests/                   pytest + fixture page
├── scripts/package_extension.py optional zip for distribution
├── .gitea/workflows/ci.yml      Gitea Actions: JS lint + pytest + package smoke
├── CURSOR_PROMPT.md             paste into other Cursor chats
└── Makefile                     make test / make lint / make package
```

`extension/core/dom.js` and `extension/core/prompt.js` are the single source
of truth for DOM/markdown/prompt logic — the extension loads them directly as
content-script files, and the Python package reads the exact same files
(via symlinks) and runs them with `page.evaluate()`. There's only one place
to fix a markdown-formatting bug.

## Use from another Cursor project

Copy the block in [`CURSOR_PROMPT.md`](CURSOR_PROMPT.md) into that project's chat
(or drop it in `.cursor/rules/`).

## Tests

```bash
make install   # once
make ci        # lint + pytest + package smoke (same checks as GitHub Actions)
```

Or manually:

```bash
cd automation
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium
pytest -q
```

## 1. Browser extension (Chrome and Brave)

Brave is Chromium under the hood and loads unpacked Manifest V3 extensions
exactly like Chrome does — there is no separate "Brave build." Same steps in
both:

1. Go to `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer Mode**.
3. **Load unpacked** → select the `extension/` folder.
4. Reload any tab you want to capture from (content scripts only attach to
   pages loaded/reloaded after install).

Click the toolbar icon to see captured console/network/errors, extract
markdown from the whole page or a CSS selector (use **Pick** to click an
element), and **Copy** to put a ready-to-paste prompt on the clipboard.

### What changed vs. a typical extension implementation

The original console/fetch/XHR patcher was injected as an inline `<script>`
tag, which strict-CSP sites (`script-src` without `'unsafe-inline'`) silently
block. This version declares `page-patcher.js` as a second content script
with `"world": "MAIN"` (Chrome/Brave 111+) instead — it runs directly in the
page's own JS realm without ever going through the page's HTML parser, so
it isn't subject to that CSP restriction. It talks back to the isolated-world
`content.js` (which owns the store, the element picker, and
`chrome.runtime` messaging) via a `CustomEvent` bridge, since MAIN and
ISOLATED worlds don't share JS globals.

### Packaging a zip (optional)

```bash
python3 scripts/package_extension.py   # -> dist/context-extractor-extension.zip
```

Not needed for local use — "Load unpacked" against `extension/` is enough.

## 2. Playwright / Camoufox automation

```bash
cd automation
python3 -m venv .venv && source .venv/bin/activate
pip install -e .                 # plain Playwright
pip install -e ".[camoufox]"     # + Camoufox extra
playwright install chromium      # only needed for the plain-Playwright path
```

```python
from playwright.sync_api import sync_playwright
from context_extractor import ExtractorSession

with sync_playwright() as p:
    page = p.chromium.launch().new_page()
    session = ExtractorSession(page)   # attach BEFORE navigating
    page.goto("https://example.com", wait_until="networkidle")
    print(session.build_ai_prompt())    # or session.extract_markdown("#main")
```

Camoufox (sync or async) works the same way — see
`automation/examples/scrape_camoufox.py` and
`automation/examples/scrape_camoufox_async.py`. Use `AsyncExtractorSession`
for `camoufox.async_api.AsyncCamoufox` / `playwright.async_api`.

Headless CLI, handy in CI:

```bash
context-extractor https://example.com --selector "#main" --engine camoufox --out prompt.md
```

### Why automation doesn't reuse the extension's patcher

Camoufox executes Playwright's own JS (`page.add_init_script()`,
`page.evaluate()` writes) in an isolated context by design, as an
anti-fingerprinting measure — this is a
[known, documented limitation](https://github.com/daijro/camoufox/issues/48)
that breaks naive init-script injection. Rather than fight that, the
automation layer captures console/network/errors via Playwright's *native*
event hooks (`page.on("console"/"request"/"requestfinished"/"requestfailed"/"pageerror")`)
instead of injecting JS into the page at all. This is more robust than the
extension's approach (it can't be blocked by page CSP, and it's not limited
to fetch/XHR — it sees every resource type), and it works identically
whether the page is Chromium, Firefox, WebKit, or Camoufox.

Markdown extraction and CSS-selector logic *do* run inside the page (they
need real DOM traversal), via `page.evaluate()` against `core/dom.js`. That's
safe under Camoufox's default isolated world because that code only *reads*
the DOM and mutates a detached clone — it never writes to the live page —
so no `main_world_eval` workaround is needed there either.

## Extraction behavior worth knowing

- `extractMarkdown()` walks the *rendered* page and skips anything actually
  invisible: `display:none`, `visibility:hidden`, `[hidden]`,
  `aria-hidden="true"` — however it's hidden (inline style, stylesheet class,
  or attribute). SPAs routinely stash large hydration/experiment JSON
  payloads in hidden DOM nodes, not just `<script>` tags (LinkedIn is a good
  example — its DOM without this filter is 700k+ characters, almost all of
  it invisible config junk). Without this check you'd be feeding an LLM
  chameleon experiment payloads instead of page content.
- `build_ai_prompt()` / the extension **Copy** button cap page content at **20,000 chars**
  by default (`maxChars` in JS, `max_chars=`/`--max-chars` in Python/CLI). A
  full `<body>` extraction on a JS-heavy SPA can still be enormous even after
  hidden-node filtering — the cap is a safety net, not a summarizer. Prefer
  a narrower selector (**Pick** in the extension, or a known selector in
  automation) over relying on the cap for real content.

## Known limitations

- The element-picker UI (click-to-grab-a-selector) is extension-only; it's a
  visual affordance that doesn't make sense in headless automation. For
  scripted use, pass the selector you already know to `extract_markdown()` /
  `build_ai_prompt()`.
- The extension's network capture only sees `fetch` + `XMLHttpRequest` (it's
  patched in JS). The automation layer sees every resource type since it
  uses Playwright's own request events.
- `page-patcher.js` still can't see activity from a page's Web Workers or
  Service Workers; neither can the automation layer without additional
  `page.on("worker")` wiring (not implemented — open an issue/extend
  `session.py` if you need it).
- Hidden-node filtering catches `display:none`/`visibility:hidden`/`[hidden]`/
  `aria-hidden`, but not "visually clipped but AT-readable" sr-only patterns
  (e.g. `position:absolute;clip:rect(0,0,0,0)`) — those are left in on
  purpose since they're usually real text, not hydration data.
