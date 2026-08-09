import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExtractorSession } from '../src/session.js';

// Same golden fixture the Python `automation/tests/` suite uses — one file,
// two automation layers, so a markdown-formatting bug can't silently diverge
// between them.
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = pathToFileURL(
  join(here, '..', '..', 'automation', 'tests', 'fixtures', 'sample.html'),
).toString();

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const p = await browser.newPage();
  try {
    return await fn(p);
  } finally {
    await p.close();
  }
}

describe('ExtractorSession', () => {
  it('captures console messages, page errors, and network activity', async () => {
    await withPage(async (page) => {
      const session = new ExtractorSession(page);
      await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);

      const store = session.getStore();
      const levels = new Set(store.console.map((e) => e.level));
      expect(levels.has('warn')).toBe(true);
      expect(
        levels.has('error') ||
          store.console.some((e) => (e.msg || '').toLowerCase().includes('error')),
      ).toBe(true);

      expect(store.errors.some((e) => (e.msg || '').includes('fixture boom'))).toBe(true);
      expect(store.network.length).toBeGreaterThan(0);
    });
  });

  it('extracts markdown from the full body and from a selector', async () => {
    await withPage(async (page) => {
      const session = new ExtractorSession(page);
      await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });

      const full = await session.extractMarkdown();
      expect(full.title).toBe('Context Extractor Fixture');
      expect(full.markdown).toContain('Fixture Page');
      expect(full.markdown).toContain('**world**');
      expect(full.markdown).toContain('[docs](/docs)');
      expect(full.markdown).toContain('- Alpha');
      expect(full.markdown).toContain('[tiny-jpeg](data:image/jpeg;base64,…[');
      expect(full.markdown).toContain('bytes truncated])');
      expect(full.markdown).not.toMatch(/4AAQSkZJRgABAQAAAQABAAD/);

      const scoped = await session.extractMarkdown('#main-content');
      expect(scoped.selector).toBe('#main-content');
      expect(scoped.markdown).toContain('Section');
      expect(scoped.markdown).not.toContain('Skip this noise');
    });
  });

  it('excludes hidden nodes (inline style, stylesheet class, [hidden], aria-hidden) from markdown', async () => {
    await withPage(async (page) => {
      const session = new ExtractorSession(page);
      await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });

      const { markdown } = await session.extractMarkdown('#main-content');
      expect(markdown).not.toContain('should-not-appear');
      expect(markdown).not.toContain('secretConfig');
      expect(markdown).not.toContain('lixTracking');
      expect(markdown).toContain('Alpha');
      expect(markdown).toContain('Beta');
    });
  });

  it('builds an AI prompt with the expected sections', async () => {
    await withPage(async (page) => {
      const session = new ExtractorSession(page);
      await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);

      const prompt = await session.buildAiPrompt('#main-content');
      expect(prompt.startsWith('# Page Context')).toBe(true);
      expect(prompt).toContain('## Page Content');
      expect(prompt).toContain('Hello **world**');
      expect(prompt).toContain('## Interesting Controls');
      expect(prompt).toContain('[visible]');
      expect(prompt).toContain('Document options');
      expect(prompt).toContain('### Hidden');
      expect(/JavaScript Errors|Console Errors/.test(prompt)).toBe(true);
      expect(prompt).toContain('_Extracted by Context Extractor_');
    });
  });

  it('inventories visible and hidden controls', async () => {
    await withPage(async (page) => {
      const session = new ExtractorSession(page);
      await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
      const controls = await session.inventoryControls('#main-content');
      const docs = controls.filter((c) => c.ariaLabel === 'Document options');
      expect(docs.length).toBe(2);
      expect(docs.some((c) => c.visible)).toBe(true);
      expect(docs.some((c) => !c.visible)).toBe(true);
      expect(controls.some((c) => c.ariaLabel === 'Upload file' && c.visible)).toBe(true);
    });
  });

  it('clears the capture store, selectively and fully', async () => {
    await withPage(async (page) => {
      const session = new ExtractorSession(page);
      await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(100);

      expect(session.getStore().console.length).toBeGreaterThan(0);
      session.clear('console');
      expect(session.getStore().console).toEqual([]);

      session.clear();
      expect(session.getStore()).toEqual({ console: [], errors: [], network: [] });
    });
  });
});
