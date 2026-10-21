import {
  buildRoutePlan,
  buildPageUrls,
  executeDetail,
} from '../engine';
import type { RuleDocument } from '../engine';
import type { SelftestResult } from '../engine/selftest';
import type { WebViewRendererLike } from './webviewFetcher';

const WEBVIEW_DETAIL_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body>
    <div id="root"></div>
    <script>
      setTimeout(function () {
        document.getElementById('root').innerHTML =
          '<div class="chapter-list"><ul>' +
          '<li><a href="/comic/123/456.html" title="Chapter 1">Chapter 1</a></li>' +
          '</ul></div>';
      }, 100);
    </script>
  </body>
</html>`;

const WEBVIEW_DETAIL_RULE: RuleDocument = {
  name: 'WebView Manhuagui Detail',
  domain: 'www.manhuagui.com',
  flags: { jsNeededDetail: true },
  detailRule: {
    pageReadyMarker: { selector: 'div.chapter-list ul li' },
    chapterRule: {
      item: { selector: 'div.chapter-list ul li' },
      idCode: {
        selector: 'a',
        function: 'attr',
        param: 'href',
        regex: '/comic/(\\d+)/(\\d+)\\.html',
        replacement: '$2',
      },
      title: {
        selector: 'a',
        function: 'attr',
        param: 'title',
      },
      url: {
        selector: 'a',
        function: 'attr',
        param: 'href',
        regex: '(.*)',
        replacement: 'https://{domain:}$1#p={page:1}',
      },
    },
  },
};

/**
 * 本地 JS 页面验证：隐藏 WebView 等待并取得 outerHTML 后，
 * 再交给真实漫画柜形态的 chapterRule 执行，不访问在线站点。
 */
export async function runWebViewSelftest(
  renderer: WebViewRendererLike,
): Promise<SelftestResult[]> {
  const rendered = await renderer.renderHtml(
    WEBVIEW_DETAIL_HTML,
    'https://www.manhuagui.com/comic/123/',
    {
      waitForSelector: 'div.chapter-list ul li',
      timeoutMs: 5_000,
    },
  );
  const plan = buildRoutePlan(WEBVIEW_DETAIL_RULE);
  const detail = executeDetail(
    WEBVIEW_DETAIL_RULE,
    plan,
    rendered.body,
    {
      baseUrl: 'https://www.manhuagui.com/comic/123/',
      domain: 'www.manhuagui.com',
    },
    { allowWebView: true },
  );
  const chapterPages = buildPageUrls(
    detail.chapters[0]?.url ?? '',
    {
      baseUrl: 'https://www.manhuagui.com/comic/123/',
      domain: 'www.manhuagui.com',
    },
    1,
  );
  const chapterUrl = chapterPages.urls[0];

  return [
    {
      name: 'webview: waited for JS marker',
      ok: rendered.body.includes('Chapter 1'),
      detail: `html=${rendered.body.length} chars`,
    },
    {
      name: 'webview: 漫画柜 chapter rule',
      ok:
        detail.chapters.length === 1 &&
        detail.chapters[0].idCode === '456' &&
        chapterUrl === 'https://www.manhuagui.com/comic/123/456.html#p=1',
      detail: JSON.stringify({
        chapters: detail.chapters,
        chapterUrl,
      }),
    },
  ];
}
