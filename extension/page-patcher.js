// page-patcher.js — Context Extractor
//
// Declared in manifest.json with "world": "MAIN" (Chrome/Brave 111+), so this
// file executes directly in the page's own JS realm — no inline <script>
// element is created, which means it is NOT subject to the page's script-src
// CSP the way a page-inserted inline script would be. This replaces the old
// approach (content.js injecting a <script> tag), which silently failed to
// capture page-script activity on strict-CSP sites.
//
// MAIN world scripts cannot call chrome.runtime.* directly, so results are
// handed to the isolated-world content.js via a CustomEvent bridge.
(() => {
  if (window.__ctxExtractorMain) return;
  window.__ctxExtractorMain = true;

  const BRIDGE_EVENT = "__ctxExtractorEvent";

  const SEND = (kind, payload) => {
    try {
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { kind, payload } }));
    } catch (_) {}
  };

  const safeStringify = (v) => {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "string") return v;
    if (t === "number" || t === "boolean" || t === "bigint") return String(v);
    if (t === "function") return "[Function" + (v.name ? " " + v.name : "") + "]";
    if (t === "symbol") return v.toString();
    if (v instanceof Error) return v.stack || (v.name + ": " + v.message);
    try {
      const seen = new WeakSet();
      return JSON.stringify(v, (k, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        if (typeof val === "function") return "[Function]";
        if (typeof val === "bigint") return val.toString() + "n";
        return val;
      });
    } catch (_) {
      try { return String(v); } catch (__) { return "[Unserializable]"; }
    }
  };

  const fmtArgs = (args) => Array.from(args).map(safeStringify).join(" ");

  // --- console ---
  const levels = ["log", "warn", "error", "info", "debug"];
  for (const lvl of levels) {
    const orig = console[lvl];
    if (typeof orig !== "function") continue;
    console[lvl] = function (...args) {
      try {
        SEND("console", { level: lvl, ts: Date.now(), msg: fmtArgs(args) });
      } catch (_) {}
      return orig.apply(this, args);
    };
  }

  // --- window errors ---
  window.addEventListener("error", (e) => {
    SEND("error", {
      type: "error",
      ts: Date.now(),
      msg: (e && e.message) || "Unknown error",
      source: (e && e.filename) || "",
      line: (e && e.lineno) || 0,
      col: (e && e.colno) || 0,
      stack: (e && e.error && e.error.stack) || ""
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    let msg = "Unhandled promise rejection";
    let stack = "";
    const r = e && e.reason;
    if (r instanceof Error) { msg = r.message; stack = r.stack || ""; }
    else if (r !== undefined) { msg = safeStringify(r); }
    SEND("error", { type: "unhandledrejection", ts: Date.now(), msg, source: "", line: 0, col: 0, stack });
  });

  // --- XHR ---
  const XHRProto = XMLHttpRequest.prototype;
  const origOpen = XHRProto.open;
  const origSend = XHRProto.send;
  XHRProto.open = function (method, url) {
    try {
      this.__ctx = { method: String(method || "GET").toUpperCase(), url: String(url || ""), start: 0 };
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XHRProto.send = function () {
    try {
      if (this.__ctx) this.__ctx.start = performance.now();
      this.addEventListener("loadend", () => {
        try {
          const ctx = this.__ctx || {};
          SEND("network", {
            type: "xhr",
            method: ctx.method || "GET",
            url: ctx.url || "",
            status: this.status || 0,
            ts: Date.now(),
            duration: ctx.start ? Math.round(performance.now() - ctx.start) : 0,
            error: null
          });
        } catch (_) {}
      });
      this.addEventListener("error", () => {
        try {
          const ctx = this.__ctx || {};
          SEND("network", {
            type: "xhr",
            method: ctx.method || "GET",
            url: ctx.url || "",
            status: 0,
            ts: Date.now(),
            duration: ctx.start ? Math.round(performance.now() - ctx.start) : 0,
            error: "Network error"
          });
        } catch (_) {}
      });
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  // --- fetch ---
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const start = performance.now();
      let method = "GET";
      let url = "";
      try {
        if (typeof input === "string") { url = input; }
        else if (input && typeof input.url === "string") { url = input.url; method = input.method || method; }
        if (init && init.method) method = init.method;
        method = String(method).toUpperCase();
      } catch (_) {}
      return origFetch.apply(this, arguments).then(
        (res) => {
          try {
            SEND("network", {
              type: "fetch",
              method,
              url,
              status: res.status || 0,
              ts: Date.now(),
              duration: Math.round(performance.now() - start),
              error: null
            });
          } catch (_) {}
          return res;
        },
        (err) => {
          try {
            SEND("network", {
              type: "fetch",
              method,
              url,
              status: 0,
              ts: Date.now(),
              duration: Math.round(performance.now() - start),
              error: (err && err.message) || String(err)
            });
          } catch (_) {}
          throw err;
        }
      );
    };
  }
})();
