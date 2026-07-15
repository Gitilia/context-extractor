// popup.js — Context Extractor
//
// buildAIPrompt() comes from core/prompt.js, loaded via a <script> tag in
// popup.html before this file, so it's already in scope here.

const state = {
  tabId: null,
  store: { console: [], network: [], errors: [] },
  lastExtract: null // { meta, markdown }
};

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|brave|edge|about|devtools|chrome-extension|brave-extension|moz-extension):/i.test(url)
    || url.startsWith("https://chrome.google.com/webstore")
    || url.startsWith("https://chromewebstore.google.com");
}

function sendRaw(message) {
  return new Promise((resolve) => {
    if (state.tabId == null) {
      return resolve({ ok: false, error: "No active tab." });
    }
    try {
      chrome.tabs.sendMessage(state.tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          return resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "No content script on this tab."
          });
        }
        resolve(response || { ok: false, error: "Empty response from content script." });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message || err) });
    }
  });
}

async function injectContentScripts() {
  if (state.tabId == null) throw new Error("No active tab.");
  // Isolated world: DOM helpers + messaging/store/picker.
  await chrome.scripting.executeScript({
    target: { tabId: state.tabId },
    files: ["core/dom.js", "content.js"]
  });
  // MAIN world: console/fetch/XHR patches (may miss early page activity if
  // injected late, but still useful going forward).
  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: ["page-patcher.js"],
      world: "MAIN"
    });
  } catch (_) {
    // MAIN-world inject can fail on some pages; extraction still works.
  }
}

/**
 * Send a message to the content script. If it isn't present yet (tab was open
 * before the extension loaded/reloaded), inject it and retry once.
 */
async function sendToContent(message) {
  const first = await sendRaw(message);
  if (first && first.ok) return first;

  const err = (first && first.error) || "";
  const needsInject = /Receiving end does not exist|Could not establish connection|No content script/i.test(err)
    || first == null;

  if (!needsInject) return first;

  try {
    await injectContentScripts();
  } catch (e) {
    return {
      ok: false,
      error: "Could not inject into this tab: " + String(e && e.message || e)
    };
  }

  // Tiny pause so the listener is registered before we message again.
  await new Promise((r) => setTimeout(r, 50));
  return sendRaw(message);
}

function showExtractError(preview, meta, message) {
  preview.classList.add("empty");
  preview.textContent = message || "Could not extract content from this page.";
  meta.textContent = "";
  state.lastExtract = null;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.dataset.panel === name);
  });
}

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => activateTab(t.dataset.tab));
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg || "Copied ✓";
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied ✓");
  } catch (e) {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied ✓"); }
    catch (_) { toast("Copy failed"); }
    ta.remove();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false });
  } catch (_) { return ""; }
}

function truncate(s, n) {
  if (s == null) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function statusClass(status, error) {
  if (error || !status) return "err";
  if (status >= 400) return "err";
  if (status >= 300) return "redir";
  if (status >= 200) return "ok";
  return "err";
}

function renderConsole() {
  const list = document.getElementById("consoleList");
  const summary = document.getElementById("consoleSummary");
  const entries = state.store.console || [];

  const counts = { error: 0, warn: 0, info: 0, log: 0, debug: 0 };
  entries.forEach((e) => { if (counts[e.level] != null) counts[e.level]++; });
  summary.innerHTML = `<b>${entries.length}</b> entries · ` +
    `<span style="color:var(--err)">err ${counts.error}</span> · ` +
    `<span style="color:var(--warn)">warn ${counts.warn}</span> · ` +
    `<span style="color:var(--primary)">info ${counts.info}</span> · ` +
    `log ${counts.log} · debug ${counts.debug}`;

  if (!entries.length) {
    list.innerHTML = `<div class="empty">No console activity captured.</div>`;
    return;
  }

  const rows = entries.slice().reverse().map((e) => {
    const lvl = (e.level || "log").toLowerCase();
    return `<div class="log-row ${lvl}">
      <div class="lvl">${lvl}</div>
      <div class="msg">${escapeHtml(truncate(e.msg, 800))}</div>
    </div>`;
  });
  list.innerHTML = rows.join("");
}

function renderNetwork() {
  const list = document.getElementById("networkList");
  const summary = document.getElementById("networkSummary");
  const entries = state.store.network || [];

  const fails = entries.filter((n) => (n.status >= 400) || n.error).length;
  summary.innerHTML = `<b>${entries.length}</b> requests · ` +
    `<span style="color:var(--err)">${fails} failed</span>`;

  if (!entries.length) {
    list.innerHTML = `<div class="empty">No requests captured.</div>`;
    return;
  }

  const rows = entries.slice().reverse().map((n) => {
    const cls = statusClass(n.status, n.error);
    const statusText = n.error ? "ERR" : (n.status || "—");
    return `<div class="net-row ${cls}">
      <div class="method">${escapeHtml(n.method || "")}</div>
      <div class="status">${escapeHtml(String(statusText))}</div>
      <div class="url" title="${escapeHtml(n.url || "")}">${escapeHtml(truncate(n.url, 200))}</div>
      <div class="dur">${n.duration ? n.duration + "ms" : ""}</div>
    </div>`;
  });
  list.innerHTML = rows.join("");
}

function renderErrors() {
  const list = document.getElementById("errorsList");
  const summary = document.getElementById("errorsSummary");
  const entries = state.store.errors || [];

  summary.innerHTML = `<b>${entries.length}</b> JavaScript errors captured.`;

  if (!entries.length) {
    list.innerHTML = `<div class="empty">No JavaScript errors captured.</div>`;
    return;
  }

  const rows = entries.slice().reverse().map((e) => {
    const where = [e.source, e.line ? "line " + e.line : "", e.col ? "col " + e.col : ""]
      .filter(Boolean).join(" · ");
    return `<div class="err-row">
      <div class="head">${escapeHtml(e.type || "error")}: ${escapeHtml(truncate(e.msg, 300))}</div>
      <div class="sub">${escapeHtml(where || fmtTime(e.ts))}</div>
      ${e.stack ? `<div class="stack">${escapeHtml(truncate(e.stack, 1500))}</div>` : ""}
    </div>`;
  });
  list.innerHTML = rows.join("");
}

function updateBadges() {
  const cs = state.store.console || [];
  const ns = state.store.network || [];
  const es = state.store.errors || [];

  document.getElementById("count-console").textContent = cs.length ? " " + cs.length : "";
  document.getElementById("count-network").textContent = ns.length ? " " + ns.length : "";
  document.getElementById("count-errors").textContent  = es.length ? " " + es.length : "";

  const consoleHasIssue = cs.some((e) => e.level === "error" || e.level === "warn");
  const networkHasIssue = ns.some((n) => (n.status >= 400) || n.error);
  const errorsHasIssue  = es.length > 0;

  setIssue("console", consoleHasIssue);
  setIssue("network", networkHasIssue);
  setIssue("errors",  errorsHasIssue);
}

function setIssue(tab, on) {
  const el = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (el) el.classList.toggle("has-issue", !!on);
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Store fetch
// ---------------------------------------------------------------------------
async function refreshStore() {
  const res = await sendToContent({ type: "GET_STORE" });
  if (res && res.ok && res.store) {
    state.store = {
      console: res.store.console || [],
      network: res.store.network || [],
      errors:  res.store.errors  || []
    };
  } else {
    state.store = { console: [], network: [], errors: [] };
  }
  renderConsole();
  renderNetwork();
  renderErrors();
  updateBadges();
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------
async function doExtract() {
  const selector = document.getElementById("selectorInput").value.trim();
  const preview = document.getElementById("contentPreview");
  const meta = document.getElementById("extractMeta");

  const tab = await getActiveTab();
  state.tabId = tab ? tab.id : null;
  if (!tab) {
    showExtractError(preview, meta, "No active tab.");
    return;
  }
  if (isRestrictedUrl(tab.url)) {
    showExtractError(
      preview,
      meta,
      "Can't run on this page (" + (tab.url || "unknown") + "). Open a normal http(s) tab and try again."
    );
    return;
  }

  preview.classList.add("empty");
  preview.textContent = "Extracting…";

  const res = await sendToContent({ type: "EXTRACT_CONTENT", selector });

  if (!res || !res.ok) {
    showExtractError(
      preview,
      meta,
      (res && res.error)
        ? "Could not extract: " + res.error + "\n\nTip: reload the extension on brave://extensions, then click Extract again (injection is automatic now)."
        : "Could not extract content from this page."
    );
    return;
  }

  state.lastExtract = { meta: res.meta, markdown: res.markdown || "" };
  meta.textContent = `${res.meta.selector} · ${res.markdown.length.toLocaleString()} chars · ${fmtTime(res.meta.ts)}`;
  if (res.markdown && res.markdown.length) {
    preview.classList.remove("empty");
    preview.textContent = res.markdown.length > 5000
      ? res.markdown.slice(0, 5000) + "\n\n… [truncated — full content included when you click Copy]"
      : res.markdown;
  } else {
    preview.classList.add("empty");
    preview.textContent = "No content found for that selector.";
  }
}

// ---------------------------------------------------------------------------
// Wire up buttons
// ---------------------------------------------------------------------------
function wire() {
  document.getElementById("extractBtn").addEventListener("click", doExtract);

  document.getElementById("pickBtn").addEventListener("click", async () => {
    const tab = await getActiveTab();
    state.tabId = tab ? tab.id : null;
    if (!tab || isRestrictedUrl(tab.url)) {
      toast("Can't pick on this page");
      return;
    }
    const res = await sendToContent({ type: "START_PICKER" });
    if (!res || !res.ok) {
      toast((res && res.error) || "Picker failed");
      return;
    }
    window.close();
  });

  document.getElementById("copyContent").addEventListener("click", async () => {
    // Make sure we have an extraction
    if (!state.lastExtract) await doExtract();
    const ex = state.lastExtract || { meta: null, markdown: "" };
    await refreshStore(); // ensure store fresh for prompt
    const text = buildAIPrompt(ex.meta, ex.markdown, state.store);
    copyText(text);
  });

  document.getElementById("copyConsole").addEventListener("click", async () => {
    await refreshStore();
    const tab = await getActiveTab();
    const url = tab && tab.url ? tab.url : "";
    const out = [];
    out.push("# Console Output");
    if (url) out.push(`- URL: ${url}`);
    out.push(`- Captured: ${new Date().toISOString()}`);
    out.push(`- Entries: ${state.store.console.length}`);
    out.push("");
    state.store.console.forEach((c) => {
      out.push(`[${new Date(c.ts).toISOString()}] [${(c.level || "log").toUpperCase()}] ${c.msg || ""}`);
    });
    out.push("");
    out.push("---");
    out.push("_Extracted by Context Extractor_");
    copyText(out.join("\n"));
  });

  document.getElementById("copyNetwork").addEventListener("click", async () => {
    await refreshStore();
    const tab = await getActiveTab();
    const url = tab && tab.url ? tab.url : "";
    const out = [];
    out.push("# Network Activity");
    if (url) out.push(`- URL: ${url}`);
    out.push(`- Captured: ${new Date().toISOString()}`);
    out.push(`- Requests: ${state.store.network.length}`);
    out.push("");
    state.store.network.forEach((n) => {
      const status = n.error ? "ERR" : (n.status || "—");
      out.push(`- ${n.method || "GET"} ${status} ${n.url}${n.duration ? " (" + n.duration + "ms)" : ""}${n.error ? " — " + n.error : ""}`);
    });
    out.push("");
    out.push("---");
    out.push("_Extracted by Context Extractor_");
    copyText(out.join("\n"));
  });

  document.getElementById("copyErrors").addEventListener("click", async () => {
    await refreshStore();
    const tab = await getActiveTab();
    const url = tab && tab.url ? tab.url : "";
    const out = [];
    out.push("# JavaScript Errors");
    if (url) out.push(`- URL: ${url}`);
    out.push(`- Captured: ${new Date().toISOString()}`);
    out.push(`- Errors: ${state.store.errors.length}`);
    out.push("");
    state.store.errors.forEach((e, i) => {
      const where = [e.source, e.line ? "line " + e.line : "", e.col ? "col " + e.col : ""]
        .filter(Boolean).join(" ");
      out.push(`## ${i + 1}. ${e.type || "error"}: ${e.msg || ""}`);
      if (where) out.push(`- Location: ${where}`);
      out.push(`- Time: ${new Date(e.ts).toISOString()}`);
      if (e.stack) {
        out.push("");
        out.push("```");
        out.push(e.stack);
        out.push("```");
      }
      out.push("");
    });
    out.push("---");
    out.push("_Extracted by Context Extractor_");
    copyText(out.join("\n"));
  });

  // Clear buttons
  document.getElementById("clearContent").addEventListener("click", async () => {
    state.lastExtract = null;
    document.getElementById("contentPreview").classList.add("empty");
    document.getElementById("contentPreview").textContent = "No content extracted yet.";
    document.getElementById("extractMeta").textContent = "";
    toast("Cleared");
  });

  document.getElementById("clearConsole").addEventListener("click", async () => {
    await sendToContent({ type: "CLEAR_STORE", which: "console" });
    await refreshStore();
    toast("Cleared");
  });

  document.getElementById("clearNetwork").addEventListener("click", async () => {
    await sendToContent({ type: "CLEAR_STORE", which: "network" });
    await refreshStore();
    toast("Cleared");
  });

  document.getElementById("clearErrors").addEventListener("click", async () => {
    await sendToContent({ type: "CLEAR_STORE", which: "errors" });
    await refreshStore();
    toast("Cleared");
  });

  document.getElementById("selectorInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doExtract();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  wire();

  const tab = await getActiveTab();
  state.tabId = tab ? tab.id : null;

  // Set page hint
  if (tab && tab.url) {
    try {
      const u = new URL(tab.url);
      document.getElementById("pageHint").textContent = u.hostname;
    } catch (_) {}
  }

  // Pre-fill selector from session storage
  try {
    const data = await chrome.storage.session.get("pickerSelector");
    if (data && data.pickerSelector) {
      document.getElementById("selectorInput").value = data.pickerSelector;
      // Clear it after consuming so it doesn't stick forever
      await chrome.storage.session.remove("pickerSelector");
    }
  } catch (_) {}

  await refreshStore();
})();
