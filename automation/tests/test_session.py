from __future__ import annotations

from context_extractor import AsyncExtractorSession, ExtractorSession, __version__


def test_version_semverish():
    assert __version__.count(".") >= 1


def test_capture_console_errors_and_network(page, fixture_url):
    session = ExtractorSession(page)
    page.goto(fixture_url, wait_until="domcontentloaded")
    page.wait_for_timeout(150)

    store = session.get_store()
    levels = {e["level"] for e in store["console"]}
    assert "warn" in levels
    assert "error" in levels or any("error" in (e.get("msg") or "").lower() for e in store["console"])

    assert any(e["msg"] == "fixture boom" or "fixture boom" in (e.get("msg") or "") for e in store["errors"])
    assert store["network"], "expected at least the document request"


def test_extract_markdown_body_and_selector(page, fixture_url):
    session = ExtractorSession(page)
    page.goto(fixture_url, wait_until="domcontentloaded")

    full = session.extract_markdown()
    assert full["title"] == "Context Extractor Fixture"
    assert "Fixture Page" in full["markdown"]
    assert "**world**" in full["markdown"]
    assert "[docs](/docs)" in full["markdown"]
    assert "- Alpha" in full["markdown"]

    scoped = session.extract_markdown("#main-content")
    assert scoped["selector"] == "#main-content"
    assert "Section" in scoped["markdown"]
    assert "Skip this noise" not in scoped["markdown"]


def test_hidden_nodes_are_excluded_from_markdown(page, fixture_url):
    """Regression test: SPAs (e.g. LinkedIn) stash hydration/experiment JSON in
    hidden DOM nodes, not just <script> tags. Any hidden node must be excluded
    regardless of *how* it's hidden (inline style, stylesheet class, [hidden],
    aria-hidden)."""
    session = ExtractorSession(page)
    page.goto(fixture_url, wait_until="domcontentloaded")

    markdown = session.extract_markdown("#main-content")["markdown"]
    assert "should-not-appear" not in markdown
    assert "secretConfig" not in markdown
    assert "lixTracking" not in markdown
    # Sanity: visible content in the same container still comes through.
    assert "Alpha" in markdown
    assert "Beta" in markdown


def test_build_ai_prompt_has_sections(page, fixture_url):
    session = ExtractorSession(page)
    page.goto(fixture_url, wait_until="domcontentloaded")
    page.wait_for_timeout(150)

    prompt = session.build_ai_prompt("#main-content")
    assert prompt.startswith("# Page Context")
    assert "## Page Content" in prompt
    assert "Hello **world**" in prompt
    assert "JavaScript Errors" in prompt or "Console Errors" in prompt
    assert "_Extracted by Context Extractor_" in prompt


def test_clear_store(page, fixture_url):
    session = ExtractorSession(page)
    page.goto(fixture_url, wait_until="domcontentloaded")
    page.wait_for_timeout(100)
    assert session.get_store()["console"]
    session.clear("console")
    assert session.get_store()["console"] == []
    session.clear()
    store = session.get_store()
    assert store == {"console": [], "errors": [], "network": []}


def test_async_session_exported():
    assert AsyncExtractorSession is not None
