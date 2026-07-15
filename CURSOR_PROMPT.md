# Cursor consumer prompt

Paste this into another Cursor chat when that project should use Context Extractor
(path below — adjust if you moved the repo).

---

```text
Use Context Extractor from ~/Documents/code/context-extractor for browser capture / scrape debugging.

Setup (once):
  cd ~/Documents/code/context-extractor/automation && python3 -m venv .venv && source .venv/bin/activate
  pip install -e ".[dev]"
  playwright install chromium
  # optional anti-detect: pip install -e ".[camoufox]"

Python scrape / CI loop:
  from playwright.sync_api import sync_playwright
  # or: from camoufox import Camoufox
  from context_extractor import ExtractorSession

  with sync_playwright() as p:
      page = p.chromium.launch(headless=True).new_page()
      session = ExtractorSession(page)          # attach BEFORE goto
      page.goto(URL, wait_until="domcontentloaded")
      prompt = session.build_ai_prompt(SELECTOR)  # None = whole body
      # also available: session.extract_markdown(), session.get_store(), page.content() for raw HTML

  CLI: context-extractor URL --selector CSS --engine chromium|camoufox --out prompt.md

Manual / interactive (Brave or Chrome):
  Load unpacked: ~/Documents/code/context-extractor/extension
  Then use "Copy" on the broken page.

When debugging scrapers or flaky pages in THIS project:
  1. Capture with ExtractorSession / the extension.
  2. Paste the prompt into chat and ask for selector fixes, parse logic, or why the page failed.
  3. Prefer selectors from #main / data-* / stable IDs over brittle chrome-copy paths.
  Do not reinvent markdown extraction or console/network capture — reuse this package.
```
