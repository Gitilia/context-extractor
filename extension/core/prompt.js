// core/prompt.js — shared AI-prompt formatter (Context Extractor)
//
// Pure string formatting, no DOM/chrome.* dependency. Shared by:
//   1. Extension popup (popup.html loads this before popup.js).
//   2. Automation (evaluated in-page via page.evaluate so both surfaces
//      produce byte-identical output for the same inputs).
//
// store shape: { console: [{level,ts,msg}], errors: [{type,ts,msg,source,line,col,stack}],
//                network: [{type,method,url,status,ts,duration,error}] }
// meta shape:  { url, title, ts, selector }
//
// markdown is capped at maxChars (default 20,000) before it goes in the
// prompt. Extracting the whole <body> of a JS-heavy SPA easily produces
// hundreds of thousands of characters (LinkedIn: 700k+) — most LLM context
// windows can't take that, and it's rarely what you want to paste anyway.
// Pass a tighter selector (or a larger maxChars) instead of relying on this
// cap for real content; it exists as a safety net, not a summarizer.
const DEFAULT_MAX_MARKDOWN_CHARS = 20000;

function buildAIPrompt(meta, markdown, store, maxChars) {
  const limit = maxChars || DEFAULT_MAX_MARKDOWN_CHARS;
  const parts = [];

  parts.push("# Page Context");
  if (meta) {
    if (meta.url) parts.push(`- URL: ${meta.url}`);
    if (meta.title) parts.push(`- Title: ${meta.title}`);
    if (meta.ts) parts.push(`- Captured: ${new Date(meta.ts).toISOString()}`);
    if (meta.selector) parts.push(`- Selector: \`${meta.selector}\``);
  }
  parts.push("");

  const trimmed = markdown && markdown.trim();
  if (trimmed) {
    const truncated = trimmed.length > limit;
    const heading = truncated
      ? `## Page Content (truncated to ${limit.toLocaleString()} of ${trimmed.length.toLocaleString()} chars — use a narrower selector to see more)`
      : "## Page Content";
    parts.push(heading);
    parts.push("");
    parts.push(truncated ? trimmed.slice(0, limit) + "\n…" : trimmed);
    parts.push("");
  }

  const errors = (store && store.errors) || [];
  if (errors.length) {
    parts.push("## JavaScript Errors");
    parts.push("");
    errors.forEach((e, i) => {
      const where = [e.source, e.line ? "line " + e.line : "", e.col ? "col " + e.col : ""]
        .filter(Boolean).join(" ");
      parts.push(`### ${i + 1}. ${e.type || "error"}: ${e.msg || ""}`);
      if (where) parts.push(`- Location: ${where}`);
      if (e.ts) parts.push(`- Time: ${new Date(e.ts).toISOString()}`);
      if (e.stack) {
        parts.push("");
        parts.push("```");
        parts.push(e.stack);
        parts.push("```");
      }
      parts.push("");
    });
  }

  const consoleEntries = (store && store.console) || [];
  const consoleIssues = consoleEntries.filter((c) => c.level === "error" || c.level === "warn");
  if (consoleIssues.length) {
    parts.push("## Console Errors & Warnings");
    parts.push("");
    consoleIssues.forEach((c) => {
      parts.push(`- [${(c.level || "log").toUpperCase()}] ${c.msg || ""}`);
    });
    parts.push("");
  }

  const network = (store && store.network) || [];
  const failed = network.filter((n) => (n.status >= 400) || n.error);
  if (failed.length) {
    parts.push("## Failed Requests");
    parts.push("");
    failed.forEach((n) => {
      const status = n.error ? "ERR" : n.status;
      parts.push(`- ${n.method || "GET"} ${status} ${n.url}${n.duration ? " (" + n.duration + "ms)" : ""}${n.error ? " — " + n.error : ""}`);
    });
    parts.push("");
  } else if (network.length) {
    parts.push("## Recent Requests");
    parts.push("");
    network.slice(-15).forEach((n) => {
      parts.push(`- ${n.method || "GET"} ${n.status || "—"} ${n.url}${n.duration ? " (" + n.duration + "ms)" : ""}`);
    });
    parts.push("");
  }

  parts.push("---");
  parts.push("_Extracted by Context Extractor_");

  return parts.join("\n");
}
