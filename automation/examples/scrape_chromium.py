"""Minimal example: capture context from a page using plain Playwright + Chromium.

Run:
    pip install -e ./automation
    playwright install chromium
    python automation/examples/scrape_chromium.py https://example.com
"""

import sys

from playwright.sync_api import sync_playwright

from context_extractor import ExtractorSession


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Attach capture *before* navigating so console/network from the very
        # first load are seen.
        session = ExtractorSession(page)

        page.goto(url, wait_until="networkidle")

        print(session.build_ai_prompt())  # selector=None -> whole <body>

        browser.close()


if __name__ == "__main__":
    main()
