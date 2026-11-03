import {
  buildRoutePlan,
  loadDetail,
  loadGalleryPages,
} from '../src/engine';
import type { RuleDocument } from '../src/engine';
import { createWebViewRuleFetcher } from '../src/platform/webviewFetcher';
import type { WebViewRendererLike } from '../src/platform/webviewFetcher';
import { runManhuaguiProbe } from '../src/platform/manhuaguiProbe';
import { runWebViewSelftest } from '../src/platform/webviewSelftest';

function fakeRenderer(
  body: string,
  onRender?: (url: string, waitForSelector?: string) => void,
): WebViewRendererLike {
  return {
    async render(url, options) {
      onRender?.(url, options?.waitForSelector);
      return { url, body };
    },
    async renderHtml(_html, baseUrl) {
      return { url: baseUrl, body };
    },
  };
}

test('WebView fetcher maps waitForSelector and response', async () => {
  let requestedWait: string | undefined;
  const fetcher = createWebViewRuleFetcher(
    fakeRenderer('<div class="ready"></div>', (_url, wait) => {
      requestedWait = wait;
    }),
  );

  const result = await fetcher.fetch({
    url: 'https://example.test/detail',
    method: 'GET',
    headers: {},
    waitForSelector: 'div.ready',
  });

  expect(fetcher.webview).toBe(true);
  expect(requestedWait).toBe('div.ready');
  expect(result).toEqual({
    url: 'https://example.test/detail',
    status: 200,
    body: '<div class="ready"></div>',
  });
});

test('loadDetail allows NEEDS_WEBVIEW only when the fetcher is a WebView renderer', async () => {
  const rule: RuleDocument = {
    name: 'WebView Detail',
    domain: 'example.test',
    flags: { jsNeededDetail: true },
    detailRule: {
      pageReadyMarker: { selector: 'div.ready' },
      title: { selector: 'h1', function: 'text' },
    },
  };
  const plan = buildRoutePlan(rule);
  expect(plan.unsupported.map(item => item.code)).toContain('NEEDS_WEBVIEW');

  let requestedWait: string | undefined;
  const fetcher = createWebViewRuleFetcher(
    fakeRenderer(
      '<div class="ready"></div><h1>Loaded by WebView</h1>',
      (_url, wait) => {
        requestedWait = wait;
      },
    ),
  );

  const result = await loadDetail(
    rule,
    plan,
    fetcher,
    'https://example.test/detail',
    { baseUrl: 'https://example.test/detail', domain: 'example.test' },
  );

  expect(requestedWait).toBe('div.ready');
  expect(result.fields.title).toBe('Loaded by WebView');
  expect(result.diagnostics).toEqual([]);
});

test('loadGalleryPages allows NEEDS_WEBVIEW and waits for the image marker', async () => {
  const rule: RuleDocument = {
    name: 'WebView Gallery',
    domain: 'example.test',
    flags: { jsNeededDetail: true },
    galleryRule: {
      totalPages: { selector: 'span.total', function: 'text' },
      image: { selector: '#manga > img', function: 'attr', param: 'src' },
    },
  };
  const plan = buildRoutePlan(rule);
  let requestedWait: string | undefined;
  const fetcher = createWebViewRuleFetcher(
    fakeRenderer(
      '<span class="total">1</span><div id="manga"><img src="/img/1.jpg"></div>',
      (_url, wait) => {
        requestedWait = wait;
      },
    ),
  );

  const result = await loadGalleryPages(
    rule,
    plan,
    fetcher,
    'https://example.test/gallery/1',
    { baseUrl: 'https://example.test/', domain: 'example.test' },
  );

  expect(requestedWait).toBe('#manga > img');
  expect(result.images).toEqual(['https://example.test/img/1.jpg']);
  expect(result.diagnostics).toEqual([]);
});

test('loadGalleryPages prefers galleryRule.item over image as the wait marker', async () => {
  const rule: RuleDocument = {
    name: 'WebView Gallery Item',
    domain: 'example.test',
    flags: { jsNeededDetail: true },
    galleryRule: {
      item: { selector: 'ul.pages > li > img' },
      image: { selector: 'this', function: 'attr', param: 'src' },
    },
  };
  const plan = buildRoutePlan(rule);
  let requestedWait: string | undefined;
  const fetcher = createWebViewRuleFetcher(
    fakeRenderer(
      '<ul class="pages"><li><img src="/img/1.jpg"></li></ul>',
      (_url, wait) => {
        requestedWait = wait;
      },
    ),
  );

  const result = await loadGalleryPages(
    rule,
    plan,
    fetcher,
    'https://example.test/gallery/1',
    { baseUrl: 'https://example.test/', domain: 'example.test' },
  );

  // image 的 selector 是 this，页面里不存在；等待标记必须优先取 item。
  expect(requestedWait).toBe('ul.pages > li > img');
  expect(result.images).toEqual(['https://example.test/img/1.jpg']);
});

test('WebView fetcher raises the render timeout floor to 30s', async () => {
  let requestedTimeout: number | undefined;
  const renderer: WebViewRendererLike = {
    async render(url, options) {
      requestedTimeout = options?.timeoutMs;
      return { url, body: '<div></div>' };
    },
    async renderHtml(_html, baseUrl) {
      return { url: baseUrl, body: '' };
    },
  };
  const fetcher = createWebViewRuleFetcher(renderer);

  await fetcher.fetch({
    url: 'https://example.test/detail',
    method: 'GET',
    headers: {},
    timeoutMs: 5_000,
  });

  expect(requestedTimeout).toBe(30_000);
});

test('WebView selftest applies the 漫画柜 chapter rule to rendered HTML', async () => {
  const renderer = fakeRenderer(`
    <div class="chapter-list">
      <ul>
        <li><a href="/comic/123/456.html" title="Chapter 1">Chapter 1</a></li>
      </ul>
    </div>
  `);

  const results = await runWebViewSelftest(renderer);
  expect(results).toHaveLength(2);
  expect(results.every(result => result.ok)).toBe(true);
});

test('漫画柜 probe follows detail chapters and first gallery page', async () => {
  const renderer: WebViewRendererLike = {
    async render(url) {
      if (url.endsWith('/comic/1128/')) {
        return {
          url,
          body: `
            <h1>Public Comic</h1>
            <div class="chapter-list">
              <ul>
                <li><a href="/comic/1128/9001.html" title="第 1 话">第 1 话</a></li>
              </ul>
            </div>
          `,
        };
      }
      return {
        url,
        body: `
          <span class="manga-page">第 1 页/3P</span>
          <div id="manga"><img src="/img/page-1.jpg"></div>
        `,
      };
    },
    async renderHtml(_html, baseUrl) {
      return { url: baseUrl, body: '' };
    },
  };

  const results = await runManhuaguiProbe(renderer);
  expect(results).toHaveLength(6);
  expect(results.every(result => result.ok)).toBe(true);

  // 新增的 DOM 结构统计应能识别旧布局（#manga>img）与分页标记。
  const domStats = results.find(
    result => result.name === 'manhuagui: gallery DOM stats',
  );
  expect(domStats?.detail).toContain('legacyImg=1');
  expect(domStats?.detail).toContain('mangaPage=1');
});
