"""Minimal example: capture context from a page using Camoufox (anti-detect Firefox).

Camoufox hands you a normal Playwright Page, so ExtractorSession works
unmodified. No `main_world_eval` or init-script workarounds are needed here:
capture uses Playwright's native page.on(...) hooks (not JS injection), and
markdown extraction only *reads* the DOM, which works fine in Camoufox's
default isolated world.

Run:
    pip install -e ./automation[camoufox]
    python automation/examples/scrape_camoufox.py https://example.com
"""

import sys

from camoufox import Camoufox

from context_extractor import ExtractorSession


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"

    with Camoufox(headless=True, geoip=True) as browser:
        page = browser.new_page()

        session = ExtractorSession(page)

        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(1000)  # let SPA fetches settle

        print(session.build_ai_prompt())

        # Or grab pieces individually:
        # extracted = session.extract_markdown("#main-content")
        # store = session.get_store()  # {"console": [...], "errors": [...], "network": [...]}


if __name__ == "__main__":
    main()
