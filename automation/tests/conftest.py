from __future__ import annotations

from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

FIXTURE = Path(__file__).parent / "fixtures" / "sample.html"


@pytest.fixture(scope="session")
def playwright_browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(playwright_browser):
    page = playwright_browser.new_page()
    yield page
    page.close()


@pytest.fixture
def fixture_url() -> str:
    return FIXTURE.resolve().as_uri()
