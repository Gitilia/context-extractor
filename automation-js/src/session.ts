/**
 * Console/network/error capture + markdown extraction for a Playwright
 * (Node) page — the JS/TS twin of the Python `automation/` package's
 * `ExtractorSession` / `AsyncExtractorSession`. One class here covers both,
 * since Node's Playwright API is async-only to begin with.
 *
 * Works with anything that hands you a real Playwright `Page`: `playwright`,
 * `playwright-core`, `@playwright/test`, and `camoufox-js` (which wraps
 * `playwright-core` directly).
 *
 * Design notes (see the repo README for the full rationale — same as the
 * Python package):
 *   - Console/network/page-error capture uses Playwright's *native* event
 *     hooks (`page.on('console'/'request'/'requestfinished'/'requestfailed'/'pageerror')`)
 *     rather than an injected JS patcher, because:
 *       1. It's more robust — no reliance on `page.addInitScript()`, which is
 *          known to be unreliable under Camoufox's isolated-world execution
 *          model (https://github.com/daijro/camoufox/issues/48).
 *       2. It captures more than the extension does (any resource type, not
 *          just fetch/XHR), and can't be blocked by a page's CSP.
 *   - Markdown extraction and CSS-selector helpers *do* need to run inside
 *     the page (DOM traversal). Those live in `extension/core/*.js` and are
 *     read from disk here, then run via `page.evaluate()`. That's safe under
 *     Camoufox's default isolated world because that code only reads the DOM
 *     — it never writes to the live page — so no `mainWorld`/init-script
 *     workaround is required.
 */

import type { ConsoleMessage, Page, Request } from 'playwright-core';
import { readSharedJs } from './loadJs.js';

const MAX_ENTRIES = 200;

export interface ConsoleEntry {
  level: string;
  ts: number;
  msg: string;
}

export interface ErrorEntry {
  type: string;
  ts: number;
  msg: string;
  source: string;
  line: number;
  col: number;
  stack: string;
}

export interface NetworkEntry {
  type: string;
  method: string;
  url: string;
  status: number;
  ts: number;
  duration: number;
  error: string | null;
}

export interface CaptureStore {
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  network: NetworkEntry[];
}

export interface ExtractedMarkdown {
  url: string;
  title: string;
  ts: number;
  selector: string;
  markdown: string;
}

const CONSOLE_LEVEL_MAP: Record<string, string> = { warning: 'warn' };

function now(): number {
  return Date.now();
}

class RingStore implements CaptureStore {
  console: ConsoleEntry[] = [];
  errors: ErrorEntry[] = [];
  network: NetworkEntry[] = [];

  push<K extends keyof CaptureStore>(which: K, entry: CaptureStore[K][number]): void {
    const arr = this[which];
    (arr as Array<CaptureStore[K][number]>).push(entry);
    while (arr.length > MAX_ENTRIES) arr.shift();
  }

  clear(which?: keyof CaptureStore): void {
    if (which) {
      this[which].length = 0;
    } else {
      this.console.length = 0;
      this.errors.length = 0;
      this.network.length = 0;
    }
  }

  asDict(): CaptureStore {
    return { console: this.console, errors: this.errors, network: this.network };
  }
}

function buildExtractScript(selector: string | null | undefined): string {
  const domJs = readSharedJs('dom.js');
  const selJson = JSON.stringify(selector || '');
  return `
(() => {
${domJs}
let el = null;
const sel = ${selJson};
if (sel) { try { el = document.querySelector(sel); } catch (_) { el = null; } }
if (!el) el = document.body;
return extractMarkdown(el);
})()
`;
}

function buildPromptScript(
  meta: Pick<ExtractedMarkdown, 'url' | 'title' | 'ts' | 'selector'>,
  markdown: string,
  store: CaptureStore,
  maxChars: number | undefined,
): string {
  const promptJs = readSharedJs('prompt.js');
  const maxCharsJs = maxChars === undefined ? 'undefined' : JSON.stringify(maxChars);
  return `
(() => {
${promptJs}
return buildAIPrompt(${JSON.stringify(meta)}, ${JSON.stringify(markdown)}, ${JSON.stringify(store)}, ${maxCharsJs});
})()
`;
}

/**
 * Attach to a page BEFORE navigating, so no console/network/error activity
 * from the initial load is missed.
 *
 * @example
 * ```ts
 * import { chromium } from 'playwright-core';
 * import { ExtractorSession } from 'context-extractor';
 *
 * const page = await (await chromium.launch()).newPage();
 * const session = new ExtractorSession(page);
 * await page.goto('https://example.com', { waitUntil: 'networkidle' });
 * console.log(await session.buildAiPrompt());       // or session.extractMarkdown('#main')
 * ```
 */
export class ExtractorSession {
  readonly page: Page;
  private readonly store = new RingStore();
  private readonly requestStarts = new WeakMap<Request, number>();

  constructor(page: Page) {
    this.page = page;
    page.on('console', this.onConsole);
    page.on('pageerror', this.onPageError);
    page.on('request', this.onRequest);
    page.on('requestfinished', this.onRequestFinished);
    page.on('requestfailed', this.onRequestFailed);
  }

  /** Stop listening. Call this if you keep a page open long after you're done capturing. */
  detach(): void {
    this.page.off('console', this.onConsole);
    this.page.off('pageerror', this.onPageError);
    this.page.off('request', this.onRequest);
    this.page.off('requestfinished', this.onRequestFinished);
    this.page.off('requestfailed', this.onRequestFailed);
  }

  getStore(): CaptureStore {
    return this.store.asDict();
  }

  clear(which?: keyof CaptureStore): void {
    this.store.clear(which);
  }

  async extractMarkdown(selector?: string | null): Promise<ExtractedMarkdown> {
    const markdown = (await this.page.evaluate(buildExtractScript(selector))) as string;
    return {
      url: this.page.url(),
      title: await this.page.title(),
      ts: now(),
      selector: selector || 'body',
      markdown: markdown || '',
    };
  }

  async buildAiPrompt(selector?: string | null, maxChars?: number): Promise<string> {
    const extracted = await this.extractMarkdown(selector);
    const meta = {
      url: extracted.url,
      title: extracted.title,
      ts: extracted.ts,
      selector: extracted.selector,
    };
    const script = buildPromptScript(meta, extracted.markdown, this.getStore(), maxChars);
    return (await this.page.evaluate(script)) as string;
  }

  private onConsole = (msg: ConsoleMessage): void => {
    const type = msg.type();
    const level = CONSOLE_LEVEL_MAP[type] ?? type;
    this.store.push('console', { level, ts: now(), msg: msg.text() });
  };

  private onPageError = (error: Error): void => {
    this.store.push('errors', {
      type: 'error',
      ts: now(),
      msg: error?.message ?? String(error),
      source: '',
      line: 0,
      col: 0,
      stack: error?.stack ?? '',
    });
  };

  private onRequest = (request: Request): void => {
    this.requestStarts.set(request, Date.now());
  };

  private onRequestFinished = async (request: Request): Promise<void> => {
    const start = this.requestStarts.get(request);
    this.requestStarts.delete(request);
    const duration = start ? Date.now() - start : 0;
    let status = 0;
    try {
      const response = await request.response();
      if (response) status = response.status();
    } catch {
      /* response unavailable — leave status 0 */
    }
    this.store.push('network', {
      type: request.resourceType(),
      method: request.method(),
      url: request.url(),
      status,
      ts: now(),
      duration,
      error: null,
    });
  };

  private onRequestFailed = (request: Request): void => {
    const start = this.requestStarts.get(request);
    this.requestStarts.delete(request);
    const duration = start ? Date.now() - start : 0;
    const failure = request.failure();
    this.store.push('network', {
      type: request.resourceType(),
      method: request.method(),
      url: request.url(),
      status: 0,
      ts: now(),
      duration,
      error: failure?.errorText || 'Network error',
    });
  };
}
