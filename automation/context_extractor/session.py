"""Console/network/error capture + markdown extraction for a Playwright page.

Works with:
  - Plain Playwright (any browser: chromium, firefox, webkit)
  - Camoufox (daijro/camoufox), sync or async — Camoufox hands you a normal
    Playwright Page/BrowserContext, so everything here works unmodified.

Design notes (see project README for the full rationale):
  - Console/network/page-error capture uses Playwright's *native* event hooks
    (page.on("console"/"request"/"requestfinished"/"requestfailed"/"pageerror")).
    This deliberately avoids injecting a JS patcher into the page (the trick
    the browser extension has to use), because:
      1. It's more robust — no reliance on page.add_init_script(), which is
         known to be unreliable under Camoufox's isolated-world execution
         model (see https://github.com/daijro/camoufox/issues/48).
      2. It captures more than the extension does (any resource type, not
         just fetch/XHR), and can't be blocked by a page's CSP.
  - Markdown extraction and CSS-selector helpers *do* need to run inside the
    page (DOM traversal). Those live in extension/core/*.js and are read from
    disk here, then run via page.evaluate(). This is safe under Camoufox's
    default *isolated* world because that code only reads the DOM / mutates a
    detached clone — it never writes to the live page — so no
    `main_world_eval` workaround is required.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

_JS_DIR = Path(__file__).parent / "js"
MAX_ENTRIES = 200


def _read_js(name: str) -> str:
    path = _JS_DIR / name
    if not path.exists():
        raise FileNotFoundError(
            f"Missing shared JS file: {path}. This package expects to run from "
            "a checkout of the context-extractor repo where automation/context_extractor/js/*.js "
            "are symlinks into extension/core/."
        )
    return path.read_text(encoding="utf-8")


def _now_ms() -> int:
    return int(time.time() * 1000)


class _Store:
    """Bounded ring-buffer store matching the extension's shape exactly, so
    build_ai_prompt() output is identical between the extension and here."""

    def __init__(self) -> None:
        self.console: list[dict[str, Any]] = []
        self.errors: list[dict[str, Any]] = []
        self.network: list[dict[str, Any]] = []

    def push(self, which: str, entry: dict[str, Any]) -> None:
        arr = getattr(self, which)
        arr.append(entry)
        while len(arr) > MAX_ENTRIES:
            arr.pop(0)

    def clear(self, which: Optional[str] = None) -> None:
        if which:
            getattr(self, which).clear()
        else:
            self.console.clear()
            self.errors.clear()
            self.network.clear()

    def as_dict(self) -> dict[str, Any]:
        return {"console": self.console, "errors": self.errors, "network": self.network}


_CONSOLE_LEVEL_MAP = {"warning": "warn"}


def _build_extract_script(selector: Optional[str]) -> str:
    dom_js = _read_js("dom.js")
    sel_json = json.dumps(selector or "")
    return f"""
(() => {{
{dom_js}
let el = null;
const sel = {sel_json};
if (sel) {{ try {{ el = document.querySelector(sel); }} catch (_) {{ el = null; }} }}
if (!el) el = document.body;
return extractMarkdown(el);
}})()
"""


def _build_prompt_script(
    meta: dict[str, Any], markdown: str, store: dict[str, Any], max_chars: Optional[int] = None
) -> str:
    prompt_js = _read_js("prompt.js")
    max_chars_js = json.dumps(max_chars) if max_chars is not None else "undefined"
    return f"""
(() => {{
{prompt_js}
return buildAIPrompt({json.dumps(meta)}, {json.dumps(markdown)}, {json.dumps(store)}, {max_chars_js});
}})()
"""


class _CaptureMixin:
    """Shared event-handling logic. Playwright event callbacks are plain
    synchronous functions in both the sync and async APIs (Playwright invokes
    them itself; you never await them), so this is safe to share as-is."""

    def _init_capture_state(self) -> None:
        self.store = _Store()
        self._request_starts: dict[int, float] = {}

    def _on_console(self, msg) -> None:
        level = _CONSOLE_LEVEL_MAP.get(msg.type, msg.type)
        self.store.push("console", {"level": level, "ts": _now_ms(), "msg": msg.text})

    def _on_pageerror(self, error) -> None:
        message = getattr(error, "message", None) or str(error)
        stack = getattr(error, "stack", "") or ""
        self.store.push("errors", {
            "type": "error", "ts": _now_ms(), "msg": message,
            "source": "", "line": 0, "col": 0, "stack": stack,
        })

    def _on_request(self, request) -> None:
        self._request_starts[id(request)] = time.monotonic()

    def _on_requestfinished(self, request) -> None:
        start = self._request_starts.pop(id(request), None)
        duration = round((time.monotonic() - start) * 1000) if start else 0
        status = 0
        try:
            response = request.response()
            if response:
                status = response.status
        except Exception:
            pass
        self.store.push("network", {
            "type": request.resource_type, "method": request.method, "url": request.url,
            "status": status, "ts": _now_ms(), "duration": duration, "error": None,
        })

    def _on_requestfailed(self, request) -> None:
        start = self._request_starts.pop(id(request), None)
        duration = round((time.monotonic() - start) * 1000) if start else 0
        failure = getattr(request, "failure", None)
        error_text = failure.get("errorText") if isinstance(failure, dict) else str(failure or "Network error")
        self.store.push("network", {
            "type": request.resource_type, "method": request.method, "url": request.url,
            "status": 0, "ts": _now_ms(), "duration": duration, "error": error_text or "Network error",
        })

    def get_store(self) -> dict[str, Any]:
        return self.store.as_dict()

    def clear(self, which: Optional[str] = None) -> None:
        self.store.clear(which)


class ExtractorSession(_CaptureMixin):
    """Sync API. Use with `playwright.sync_api` or sync `camoufox.Camoufox`.

    Example:
        from playwright.sync_api import sync_playwright
        from context_extractor import ExtractorSession

        with sync_playwright() as p:
            page = p.chromium.launch().new_page()
            session = ExtractorSession(page)
            page.goto("https://example.com")
            print(session.build_ai_prompt())
    """

    def __init__(self, page) -> None:
        self.page = page
        self._init_capture_state()
        page.on("console", self._on_console)
        page.on("pageerror", self._on_pageerror)
        page.on("request", self._on_request)
        page.on("requestfinished", self._on_requestfinished)
        page.on("requestfailed", self._on_requestfailed)

    def extract_markdown(self, selector: Optional[str] = None) -> dict[str, Any]:
        markdown = self.page.evaluate(_build_extract_script(selector))
        return {
            "url": self.page.url,
            "title": self.page.title(),
            "ts": _now_ms(),
            "selector": selector or "body",
            "markdown": markdown or "",
        }

    def build_ai_prompt(self, selector: Optional[str] = None, max_chars: Optional[int] = None) -> str:
        extracted = self.extract_markdown(selector)
        meta = {k: extracted[k] for k in ("url", "title", "ts", "selector")}
        script = _build_prompt_script(meta, extracted["markdown"], self.get_store(), max_chars)
        return self.page.evaluate(script)


class AsyncExtractorSession(_CaptureMixin):
    """Async API. Use with `playwright.async_api` or `camoufox.AsyncCamoufox`.

    Example:
        from camoufox.async_api import AsyncCamoufox
        from context_extractor import AsyncExtractorSession

        async with AsyncCamoufox(headless=True) as browser:
            page = await browser.new_page()
            session = AsyncExtractorSession(page)
            await page.goto("https://example.com")
            print(await session.build_ai_prompt())
    """

    def __init__(self, page) -> None:
        self.page = page
        self._init_capture_state()
        page.on("console", self._on_console)
        page.on("pageerror", self._on_pageerror)
        page.on("request", self._on_request)
        page.on("requestfinished", self._on_requestfinished)
        page.on("requestfailed", self._on_requestfailed)

    async def extract_markdown(self, selector: Optional[str] = None) -> dict[str, Any]:
        markdown = await self.page.evaluate(_build_extract_script(selector))
        return {
            "url": self.page.url,
            "title": await self.page.title(),
            "ts": _now_ms(),
            "selector": selector or "body",
            "markdown": markdown or "",
        }

    async def build_ai_prompt(self, selector: Optional[str] = None, max_chars: Optional[int] = None) -> str:
        extracted = await self.extract_markdown(selector)
        meta = {k: extracted[k] for k in ("url", "title", "ts", "selector")}
        script = _build_prompt_script(meta, extracted["markdown"], self.get_store(), max_chars)
        return await self.page.evaluate(script)
