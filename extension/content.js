// content.js — Context Extractor (isolated world)
//
// Loaded together with core/dom.js in the same content_scripts entry (see
// manifest.json), so getSelector() and extractMarkdown() are already in
// scope here — no import needed. Also injected on-demand by the popup via
// chrome.scripting.executeScript when a tab was open before the extension
// loaded (or after a reload of the extension without a page reload).
//
// Capture (console/fetch/XHR/errors) happens in page-patcher.js, which runs
// in the MAIN world and forwards entries here via a CustomEvent, since the
// isolated and main worlds don't share JS globals.
(() => {
  // Guard against double injection (manifest auto-inject + popup inject).
  if (window.__ctxExtractorIsolated) return;
  window.__ctxExtractorIsolated = true;

  const MAX_ENTRIES = 200;
  const BRIDGE_EVENT = "__ctxExtractorEvent";

  const store = {
    console: [], // { level, ts, msg }
    errors: [],  // { type, ts, msg, source, line, col, stack }
    network: []  // { type, method, url, status, ts, duration, error }
  };

  function push(arr, entry) {
    arr.push(entry);
    while (arr.length > MAX_ENTRIES) arr.shift();
  }

  document.addEventListener(BRIDGE_EVENT, (ev) => {
    const detail = ev && ev.detail;
    if (!detail) return;
    const { kind, payload } = detail;
    if (!payload) return;
    if (kind === "console") push(store.console, payload);
    else if (kind === "error") push(store.errors, payload);
    else if (kind === "network") push(store.network, payload);
  });

  // ---------------------------------------------------------------------------
  // Element picker
  // ---------------------------------------------------------------------------
  let pickerActive = false;
  let pickerNodes = null;

  function startPicker() {
    if (pickerActive) return;
    pickerActive = true;

    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483646",
      "background:transparent", "cursor:crosshair", "pointer-events:auto"
    ].join(";");

    const highlight = document.createElement("div");
    highlight.style.cssText = [
      "position:fixed", "z-index:2147483647",
      "border:2px solid #4f98a3",
      "background:rgba(79,152,163,0.18)",
      "pointer-events:none",
      "transition:all 40ms linear",
      "box-sizing:border-box",
      "border-radius:2px"
    ].join(";");

    const label = document.createElement("div");
    label.style.cssText = [
      "position:fixed", "z-index:2147483647",
      "background:#1c1b19", "color:#e8e6e3",
      "font:12px/1.4 ui-monospace,Menlo,Consolas,monospace",
      "padding:4px 8px", "border-radius:4px",
      "border:1px solid #4f98a3",
      "pointer-events:none",
      "max-width:60vw", "overflow:hidden",
      "text-overflow:ellipsis", "white-space:nowrap"
    ].join(";");
    label.textContent = "Pick an element — ESC to cancel";

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(highlight);
    document.documentElement.appendChild(label);

    let currentEl = null;

    function positionHighlight(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      highlight.style.left = r.left + "px";
      highlight.style.top = r.top + "px";
      highlight.style.width = r.width + "px";
      highlight.style.height = r.height + "px";

      const sel = getSelector(el);
      label.textContent = sel || el.tagName.toLowerCase();
      const lx = Math.min(r.left, window.innerWidth - 320);
      const ly = r.top > 28 ? r.top - 24 : r.bottom + 4;
      label.style.left = Math.max(4, lx) + "px";
      label.style.top = Math.max(4, ly) + "px";
    }

    function onMove(e) {
      overlay.style.pointerEvents = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = "auto";
      if (el && el !== highlight && el !== label && el !== overlay) {
        currentEl = el;
        positionHighlight(el);
      }
    }

    function cleanup() {
      pickerActive = false;
      overlay.removeEventListener("mousemove", onMove, true);
      overlay.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      highlight.remove();
      label.remove();
      pickerNodes = null;
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      overlay.style.pointerEvents = "none";
      const el = currentEl || document.elementFromPoint(e.clientX, e.clientY);
      const sel = el ? getSelector(el) : "";
      try {
        chrome.runtime.sendMessage({ type: "PICKER_SELECTED", selector: sel });
      } catch (_) {}
      cleanup();
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    }

    overlay.addEventListener("mousemove", onMove, true);
    overlay.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);

    pickerNodes = { overlay, highlight, label, cleanup };
  }

  function stopPicker() {
    if (pickerNodes && pickerNodes.cleanup) pickerNodes.cleanup();
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) {
      sendResponse({ ok: false, error: "No message type" });
      return true;
    }

    try {
      switch (msg.type) {
        case "GET_STORE": {
          sendResponse({ ok: true, store });
          break;
        }
        case "EXTRACT_CONTENT": {
          const selector = (msg.selector || "").trim();
          let target = null;
          if (selector) {
            try { target = document.querySelector(selector); } catch (_) { target = null; }
          }
          if (!target) target = document.body;
          const markdown = extractMarkdown(target);
          sendResponse({
            ok: true,
            meta: {
              url: location.href,
              title: document.title || "",
              ts: Date.now(),
              selector: selector || "body"
            },
            markdown
          });
          break;
        }
        case "START_PICKER": {
          startPicker();
          sendResponse({ ok: true });
          break;
        }
        case "STOP_PICKER": {
          stopPicker();
          sendResponse({ ok: true });
          break;
        }
        case "CLEAR_STORE": {
          const which = msg.which;
          if (which && store[which]) store[which].length = 0;
          else {
            store.console.length = 0;
            store.errors.length = 0;
            store.network.length = 0;
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown type: " + msg.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
    return true; // keep channel open for async
  });
})();
