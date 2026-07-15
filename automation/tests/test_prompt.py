"""Unit-style tests for the shared prompt.js formatter (via page.evaluate)."""

from __future__ import annotations

from pathlib import Path

from context_extractor.session import _build_prompt_script, _read_js

CORE = Path(__file__).resolve().parents[2] / "extension" / "core"


def test_shared_js_files_exist_and_match_package():
    assert (CORE / "dom.js").is_file()
    assert (CORE / "prompt.js").is_file()
    # package-side copies/symlinks must resolve to the same source
    assert "function extractMarkdown" in _read_js("dom.js")
    assert "function buildAIPrompt" in _read_js("prompt.js")


def test_build_ai_prompt_script_formats_errors_and_failures(page):
    page.goto("about:blank")
    meta = {
        "url": "https://example.test/page",
        "title": "T",
        "ts": 1_700_000_000_000,
        "selector": "body",
    }
    store = {
        "console": [{"level": "warn", "ts": 1, "msg": "careful"}],
        "errors": [{
            "type": "error", "ts": 2, "msg": "boom",
            "source": "a.js", "line": 3, "col": 4, "stack": "Error: boom\n  at x",
        }],
        "network": [{
            "type": "fetch", "method": "GET", "url": "https://example.test/api",
            "status": 500, "ts": 3, "duration": 12, "error": None,
        }],
    }
    script = _build_prompt_script(meta, "# Hello", store)
    out = page.evaluate(script)
    assert "# Page Context" in out
    assert "https://example.test/page" in out
    assert "## Page Content" in out
    assert "# Hello" in out
    assert "## JavaScript Errors" in out
    assert "boom" in out
    assert "## Console Errors & Warnings" in out
    assert "[WARN] careful" in out
    assert "## Failed Requests" in out
    assert "GET 500 https://example.test/api" in out


def test_build_ai_prompt_truncates_huge_markdown_by_default(page):
    """Regression test: a JS-heavy SPA (e.g. LinkedIn) can extract 700k+ chars
    of body content. The prompt must not blindly include all of it."""
    page.goto("about:blank")
    meta = {"url": "https://example.test/huge", "title": "T", "ts": 1, "selector": "body"}
    huge_markdown = "x" * 50_000
    script = _build_prompt_script(meta, huge_markdown, {"console": [], "errors": [], "network": []})
    out = page.evaluate(script)
    assert "truncated to 20,000 of 50,000 chars" in out
    assert len(out) < 21_000  # header/footer overhead + capped body, nowhere near 50k


def test_build_ai_prompt_respects_custom_max_chars(page):
    page.goto("about:blank")
    meta = {"url": "https://example.test/huge", "title": "T", "ts": 1, "selector": "body"}
    markdown = "y" * 1000
    script = _build_prompt_script(meta, markdown, {"console": [], "errors": [], "network": []}, max_chars=200)
    out = page.evaluate(script)
    assert "truncated to 200 of 1,000 chars" in out
