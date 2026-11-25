import { shouldUseWebView } from '../src/app/ruleFetcherForPlan';
import { SiteRepository } from '../src/app/ruleImport';
import type { Diagnostic, RoutePlan } from '../src/engine';

function plan(unsupported: Diagnostic[] = []): RoutePlan {
  return {
    site: { name: 'demo', domain: 'example.com', displayMode: 'list' },
    capabilities: {
      static: true,
      webview: false,
      login: false,
      consent: false,
      post: false,
      charset: 'utf-8',
      gbkUrlEncoding: false,
      ignoreDetail: false,
      repeatedThumbnail: false,
      scroll: false,
    },
    unsupported,
  };
}

function needsWebView(): Diagnostic {
  return {
    fieldPath: 'listRule',
    code: 'NEEDS_WEBVIEW',
    severity: 'warning',
    detail: 'list requires WebView',
  };
}

describe('shouldUseWebView', () => {
  it('默认走普通 fetch', () => {
    expect(shouldUseWebView(plan())).toBe(false);
  });

  it('规则声明 NEEDS_WEBVIEW 时走 WebView', () => {
    expect(shouldUseWebView(plan([needsWebView()]))).toBe(true);
  });

  it('站点级 forceWebView 强制走 WebView', () => {
    expect(shouldUseWebView(plan(), true)).toBe(true);
  });

  it('forceWebView 关闭时不影响规则自身判断', () => {
    expect(shouldUseWebView(plan([needsWebView()]), false)).toBe(true);
  });
});

describe('SiteRepository.setForceWebView', () => {
  it('切换站点开关并可读回', () => {
    const repo = new SiteRepository();
    const added = repo.add({
      id: 'site-1',
      name: 'Demo',
      domain: 'example.com',
      source: 'paste',
      hash: 'demo-hash',
      raw: '{}',
      rule: { meta: { name: 'Demo', domain: 'example.com' } } as never,
      plan: plan(),
      diagnostics: [],
    });
    const id = added.site?.id ?? '';
    expect(repo.list()[0]?.forceWebView).toBeUndefined();
    expect(repo.setForceWebView(id, true)).toBe(true);
    expect(repo.list()[0]?.forceWebView).toBe(true);
    expect(repo.setForceWebView(id, false)).toBe(true);
    expect(repo.list()[0]?.forceWebView).toBe(false);
  });

  it('站点不存在时返回 false', () => {
    const repo = new SiteRepository();
    expect(repo.setForceWebView('missing', true)).toBe(false);
  });
});
