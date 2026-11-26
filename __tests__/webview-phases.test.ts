import {
  buildPagePlan,
  buildRoutePlan,
  executeDetail,
  executeGallery,
  executeList,
  needsWebViewForPhase,
  toRuleDocument,
} from '../src/engine';
import type { RuleDocument } from '../src/engine';
import { MANHUAGUI_RULE_JSON } from '../src/engine/real-rules.generated';
import { shouldUseWebView } from '../src/app/ruleFetcherForPlan';

const CONTEXT = { baseUrl: 'https://www.manhuagui.com/', domain: 'www.manhuagui.com' };

/** 首页列表最小样例：字段与漫画柜 pages[0].listRule 对齐。 */
const HOME_HTML = `
<div id="updateWrap"><ul>
  <li>
    <a class="bcover" href="/comic/32602/" title="罗宾V4">
      <img src="//cf.mhgui.com/cpic/b/32602.jpg" alt="罗宾V4" />
    </a>
  </li>
</ul></div>
`;

function ruleWithFlags(flags: string): RuleDocument {
  return toRuleDocument({
    meta: {
      flags,
      sitePk: 1,
      name: '测试站点',
      domain: 'example.test',
    },
    urls: { index: 'https://example.test/list/{page:1}.html' },
    pages: [],
    namedRules: {},
    rules: {
      index: { item: { selector: 'li.item' } },
      detail: { title: { selector: 'h1' } },
      gallery: { image: { selector: '#mangaBox img.mangaFile' } },
    },
  });
}

describe('按阶段判定是否需要 WebView', () => {
  test('jsNeededDetail 只影响详情，不拖累列表和图库', () => {
    const plan = buildRoutePlan(ruleWithFlags('jsNeededDetail'));
    expect(needsWebViewForPhase(plan, 'index')).toBe(false);
    expect(needsWebViewForPhase(plan, 'detail')).toBe(true);
    expect(needsWebViewForPhase(plan, 'gallery')).toBe(false);
  });

  test('jsNeededGallery 只影响图库', () => {
    const plan = buildRoutePlan(ruleWithFlags('jsNeededGallery'));
    expect(needsWebViewForPhase(plan, 'index')).toBe(false);
    expect(needsWebViewForPhase(plan, 'detail')).toBe(false);
    expect(needsWebViewForPhase(plan, 'gallery')).toBe(true);
  });

  test('未指明阶段的 jsNeeded 保守地要求所有阶段', () => {
    const plan = buildRoutePlan(ruleWithFlags('jsNeeded'));
    expect(needsWebViewForPhase(plan, 'index')).toBe(true);
    expect(needsWebViewForPhase(plan, 'detail')).toBe(true);
    expect(needsWebViewForPhase(plan, 'gallery')).toBe(true);
  });

  test('forceWebView 站点开关仍然覆盖阶段判断', () => {
    const plan = buildRoutePlan(ruleWithFlags('jsNeededDetail'));
    expect(shouldUseWebView(plan, true, 'index')).toBe(true);
    expect(shouldUseWebView(plan, false, 'index')).toBe(false);
    expect(shouldUseWebView(plan, false, 'detail')).toBe(true);
  });
});

describe('漫画柜按阶段走不同抓取路径', () => {
  const site = toRuleDocument(MANHUAGUI_RULE_JSON);
  const built = buildPagePlan(site, 0);

  test('列表可用普通请求，详情与图库都要 WebView', () => {
    expect(needsWebViewForPhase(built.plan, 'index')).toBe(false);
    expect(needsWebViewForPhase(built.plan, 'detail')).toBe(true);
    expect(needsWebViewForPhase(built.plan, 'gallery')).toBe(true);
  });

  test('首页 HTML 用普通请求也能抽出条目', () => {
    const result = executeList(built.rule, built.plan, HOME_HTML, CONTEXT, {
      allowWebView: false,
    });
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('罗宾V4');
    expect(result.items[0]?.idCode).toBe('32602');
    expect(result.items[0]?.cover).toBe(
      'https://cf.mhgui.com/cpic/h/32602.jpg',
    );
  });

  test('详情页缺 WebView 时仍然阻断，不会静默返回空', () => {
    const result = executeDetail(built.rule, built.plan, '', CONTEXT, {
      allowWebView: false,
    });
    expect(result.chapters).toEqual([]);
    expect(result.diagnostics.map(d => d.code)).toContain('NEEDS_WEBVIEW');
  });

  test('图库页缺 WebView 时阻断，避免拿到 JS 注入前的空壳', () => {
    const result = executeGallery(built.rule, built.plan, '', CONTEXT, {
      allowWebView: false,
    });
    expect(result.images).toEqual([]);
    expect(result.diagnostics.map(d => d.code)).toContain('NEEDS_WEBVIEW');
  });
});
