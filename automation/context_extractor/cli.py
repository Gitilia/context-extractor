"""Headless CLI: fetch a URL, capture console/network/errors, print an AI-ready prompt.

Usage:
    context-extractor https://example.com
    context-extractor https://example.com --selector "#main" --engine camoufox
    context-extractor https://example.com --wait 2000 --out prompt.md
"""

from __future__ import annotations

import argparse
import sys

from .session import ExtractorSession


def main() -> int:
    parser = argparse.ArgumentParser(prog="context-extractor", description=__doc__)
    parser.add_argument("url", help="URL to load")
    parser.add_argument("--selector", default=None, help="CSS selector to extract (default: body)")
    parser.add_argument("--wait", type=int, default=0, help="Extra milliseconds to wait after load")
    parser.add_argument(
        "--max-chars", type=int, default=None,
        help="Cap page content in the prompt to this many chars (default: 20000). "
             "SPA pages can extract hundreds of thousands of chars; this keeps output LLM-sized.",
    )
    parser.add_argument(
        "--engine", choices=["chromium", "firefox", "webkit", "camoufox"], default="chromium",
        help="Which browser engine to drive (default: chromium)",
    )
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    parser.add_argument("--out", default=None, help="Write the prompt to a file instead of stdout")
    args = parser.parse_args()

    if args.engine == "camoufox":
        try:
            from camoufox import Camoufox
        except ImportError:
            print(
                "camoufox is not installed. Install with: pip install 'context-extractor[camoufox]'",
                file=sys.stderr,
            )
            return 1
        with Camoufox(headless=not args.headed) as browser:
            page = browser.new_page()
            prompt = _run(page, args)
    else:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = getattr(p, args.engine).launch(headless=not args.headed)
            page = browser.new_page()
            prompt = _run(page, args)
            browser.close()

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(prompt)
        print(f"Wrote {len(prompt):,} chars to {args.out}", file=sys.stderr)
    else:
        print(prompt)
    return 0


def _run(page, args) -> str:
    session = ExtractorSession(page)
    page.goto(args.url, wait_until="domcontentloaded")
    if args.wait:
        page.wait_for_timeout(args.wait)
    return session.build_ai_prompt(args.selector, max_chars=args.max_chars)


if __name__ == "__main__":
    raise SystemExit(main())
