"""Async variant, using AsyncCamoufox + AsyncExtractorSession.

Run:
    pip install -e ./automation[camoufox]
    python automation/examples/scrape_camoufox_async.py https://example.com
"""

import asyncio
import sys

from camoufox.async_api import AsyncCamoufox

from context_extractor import AsyncExtractorSession


async def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"

    async with AsyncCamoufox(headless=True, geoip=True) as browser:
        page = await browser.new_page()

        session = AsyncExtractorSession(page)

        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(1000)

        print(await session.build_ai_prompt())


if __name__ == "__main__":
    asyncio.run(main())
