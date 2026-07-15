// core/dom.js — shared DOM helpers (Context Extractor)
//
// Pure, read-only DOM logic with no chrome.* / node dependency. Loaded two ways:
//   1. Extension: listed before content.js in manifest.json's content_scripts,
//      so these top-level declarations land in the same isolated-world scope.
//   2. Automation (Playwright/Camoufox): file contents are read from disk and
//      evaluated in-page via page.evaluate(). Safe under Camoufox's default
//      isolated world since it only *reads* the DOM (getComputedStyle included)
//      — it never writes to the live page, and no longer even clones it.
//
// Do not add chrome.*, window.close(), or any write to the live document here.

// ---------------------------------------------------------------------------
// CSS selector synthesis
// ---------------------------------------------------------------------------
function getSelector(el) {
  if (!(el instanceof Element)) return "";
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return "#" + el.id;

  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
      parts.unshift("#" + node.id);
      break;
    }
    if (node.classList && node.classList.length) {
      const cls = Array.from(node.classList)
        .filter((c) => /^[A-Za-z_][\w-]*$/.test(c))
        .slice(0, 2)
        .map((c) => "." + c)
        .join("");
      part += cls;
    }
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === node.tagName
      );
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(node) + 1;
        part += ":nth-of-type(" + idx + ")";
      }
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

// ---------------------------------------------------------------------------
// Markdown extraction
//
// Walks the *live* node directly — no cloning needed. Only ever reads
// (textContent, attributes, getComputedStyle); never mutates. Skips tags that
// never carry visible content, plus anything actually invisible to a human
// (display:none / visibility:hidden / [hidden] / [aria-hidden="true"]).
// SPAs routinely stash large hydration/experiment JSON payloads in hidden DOM
// nodes (not just <script> tags) — without this check that JSON gets read as
// if it were visible page text.
// ---------------------------------------------------------------------------
const NEVER_RENDERED_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe", "canvas"]);

function isHidden(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.hidden) return true;
  const ariaHidden = el.getAttribute && el.getAttribute("aria-hidden");
  if (ariaHidden === "true") return true;
  try {
    const cs = window.getComputedStyle(el);
    if (cs && (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse")) {
      return true;
    }
  } catch (_) {
    // getComputedStyle can throw on detached/foreign nodes; treat as visible.
  }
  return false;
}

function shouldSkip(el) {
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  return NEVER_RENDERED_TAGS.has(tag) || isHidden(el);
}

function extractMarkdown(node) {
  if (!node) return "";

  const out = [];

  function emit(s) { out.push(s); }

  function inline(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const kids = walkInline(el);
    switch (tag) {
      case "a": {
        const href = el.getAttribute("href") || "";
        return "[" + kids + "](" + href + ")";
      }
      case "strong":
      case "b":
        return "**" + kids + "**";
      case "em":
      case "i":
        return "_" + kids + "_";
      case "code":
        return "`" + kids + "`";
      case "br":
        return "\n";
      default:
        return kids;
    }
  }

  function walkInline(el) {
    let s = "";
    el.childNodes.forEach((c) => {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1 && !shouldSkip(c)) s += inline(c);
    });
    return s;
  }

  function block(el) {
    if (shouldSkip(el)) return;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      emit("\n" + "#".repeat(level) + " " + walkInline(el).trim() + "\n");
      return;
    }

    switch (tag) {
      case "p":
        emit("\n" + walkInline(el).trim() + "\n");
        return;
      case "br":
        emit("\n");
        return;
      case "hr":
        emit("\n---\n");
        return;
      case "li":
        emit("- " + walkInline(el).trim() + "\n");
        return;
      case "pre":
        emit("\n```\n" + (el.textContent || "").replace(/\n+$/, "") + "\n```\n");
        return;
      case "blockquote":
        emit("\n> " + walkInline(el).trim().replace(/\n/g, "\n> ") + "\n");
        return;
      case "ul":
      case "ol":
      case "div":
      case "section":
      case "article":
      case "main":
      case "header":
      case "footer":
      case "nav":
      case "aside":
      case "body":
        el.childNodes.forEach((c) => {
          if (c.nodeType === 1) block(c);
          else if (c.nodeType === 3) {
            const t = c.nodeValue;
            if (t && t.trim()) emit(t);
          }
        });
        return;
      default: {
        const text = walkInline(el);
        if (text) emit(text);
      }
    }
  }

  block(node);

  let md = out.join("");
  md = md.replace(/[ \t]+\n/g, "\n");
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}
