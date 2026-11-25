import { createFetchRuleFetcher } from '../src/platform/ruleFetcher';
import { createWebViewRuleFetcher } from '../src/platform/webviewFetcher';
import type {
  WebViewRendererLike,
} from '../src/platform/webviewFetcher';
import { SiteRepository } from '../src/app/ruleImport';

function response(body = 'ok') {
  return {
    status: 200,
    text: async () => body,
  };
}

describe('fetch 路径的站点 Cookie', () => {
  it('把站点 Cookie 注入请求头', async () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    const fetcher = createFetchRuleFetcher({
      cookie: '_ga=GA1.1.1; webp=1',
      fetchImpl: async (_url, init) => {
        calls.push({ headers: init?.headers as Record<string, string> });
        return response();
      },
    });

    await fetcher.fetch({
      url: 'https://example.test/list',
      method: 'GET',
      headers: {},
    });

    expect(calls[0].headers).toMatchObject({
      Cookie: '_ga=GA1.1.1; webp=1',
    });
  });

  it('规则自带的 Cookie 优先于站点 Cookie', async () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    const fetcher = createFetchRuleFetcher({
      cookie: 'site=1',
      fetchImpl: async (_url, init) => {
        calls.push({ headers: init?.headers as Record<string, string> });
        return response();
      },
    });

    await fetcher.fetch({
      url: 'https://example.test/list',
      method: 'GET',
      headers: { cookie: 'rule=1' },
    });

    expect(calls[0].headers?.cookie).toBe('rule=1');
    expect(calls[0].headers?.Cookie).toBeUndefined();
  });

  it('没有站点 Cookie 时不添加请求头', async () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    const fetcher = createFetchRuleFetcher({
      fetchImpl: async (_url, init) => {
        calls.push({ headers: init?.headers as Record<string, string> });
        return response();
      },
    });

    await fetcher.fetch({
      url: 'https://example.test/list',
      method: 'GET',
      headers: {},
    });

    expect(calls[0].headers?.Cookie).toBeUndefined();
  });
});

describe('WebView 路径的站点 Cookie', () => {
  it('渲染前带上站点 Cookie，并把回传 Cookie 交给 onCookies', async () => {
    const seen: Array<string | undefined> = [];
    const captured: string[] = [];
    const renderer: WebViewRendererLike = {
      async render(_url, options) {
        seen.push(options?.cookie);
        return {
          url: 'https://example.test/list',
          body: '<html></html>',
          cookie: 'cf_clearance=abc; webp=1',
        };
      },
      async renderHtml() {
        return { url: 'about:blank', body: '' };
      },
    };

    const fetcher = createWebViewRuleFetcher(renderer, {
      cookie: 'site=1',
      onCookies: cookie => captured.push(cookie),
    });

    await fetcher.fetch({
      url: 'https://example.test/list',
      method: 'GET',
      headers: {},
    });

    expect(seen).toEqual(['site=1']);
    expect(captured).toEqual(['cf_clearance=abc; webp=1']);
  });

  it('规则请求头里的 Cookie 优先', async () => {
    const seen: Array<string | undefined> = [];
    const renderer: WebViewRendererLike = {
      async render(_url, options) {
        seen.push(options?.cookie);
        return { url: 'https://example.test/list', body: '<html></html>' };
      },
      async renderHtml() {
        return { url: 'about:blank', body: '' };
      },
    };

    const fetcher = createWebViewRuleFetcher(renderer, { cookie: 'site=1' });
    await fetcher.fetch({
      url: 'https://example.test/list',
      method: 'GET',
      headers: { Cookie: 'rule=1' },
    });

    expect(seen).toEqual(['rule=1']);
  });
});

describe('SiteRepository.setCookies', () => {
  it('写入、覆盖与清除', () => {
    const repo = new SiteRepository();
    const added = repo.add({
      id: 'site-1',
      name: 'Demo',
      domain: 'example.com',
      source: 'paste',
      hash: 'demo-hash',
      raw: '{}',
      rule: { meta: { name: 'Demo', domain: 'example.com' } } as never,
      plan: {
        site: { name: 'Demo', domain: 'example.com', displayMode: 'list' },
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
        unsupported: [],
      },
      diagnostics: [],
    });
    const id = added.site?.id ?? '';

    expect(repo.setCookies(id, ' a=1 ')).toBe(true);
    expect(repo.get(id)?.cookies).toBe('a=1');

    repo.setCookies(id, 'b=2');
    expect(repo.get(id)?.cookies).toBe('b=2');

    repo.setCookies(id, '   ');
    expect(repo.get(id)?.cookies).toBeUndefined();
  });

  it('站点不存在时返回 false', () => {
    expect(new SiteRepository().setCookies('missing', 'a=1')).toBe(false);
  });
});
