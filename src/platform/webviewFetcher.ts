import type { RuleFetcher, RuleRequest, RuleResponse } from '../engine/load';

/**
 * 可执行 JS 的页面渲染器接口。
 *
 * Android 用原生 WebView 实现；Node 测试注入 fake renderer。
 */
export interface WebViewRendererLike {
  render(
    url: string,
    options?: {
      waitForSelector?: string;
      timeoutMs?: number;
      userAgent?: string;
      /** 渲染前写入 WebView CookieManager，用于 cf_clearance 和登录态。 */
      cookie?: string;
    },
  ): Promise<{ url: string; body: string; cookie?: string }>;
  renderHtml(
    html: string,
    baseUrl: string,
    options?: { waitForSelector?: string; timeoutMs?: number },
  ): Promise<{ url: string; body: string; cookie?: string }>;
}

export interface WebViewFetcherOptions {
  /** 渲染后把站点落下的 Cookie 回传，供调用方持久化。 */
  onCookies?: (cookie: string) => void;
  /** 站点级 Cookie：规则没写 Cookie 时用它。 */
  cookie?: string;
}

export function createWebViewRuleFetcher(
  renderer: WebViewRendererLike,
  options: WebViewFetcherOptions = {},
): RuleFetcher {
  return {
    webview: true,
    async fetch(request: RuleRequest): Promise<RuleResponse> {
      // WebView 需要等页面 JS 渲染完再匹配选择器；重页面（如 mangacopy
      // 详情页）在真机上可能超过默认 15s，这里给渲染阶段一个更高的下限。
      const timeoutMs = Math.max(request.timeoutMs ?? 0, 30_000);
      const userAgent =
        request.headers['User-Agent'] ?? request.headers['user-agent'];
      const cookie =
        request.headers.Cookie ?? request.headers.cookie ?? options.cookie;
      const rendered = await renderer.render(request.url, {
        waitForSelector: request.waitForSelector,
        timeoutMs,
        ...(userAgent ? { userAgent } : {}),
        ...(cookie ? { cookie } : {}),
      });
      if (rendered.cookie && options.onCookies) {
        options.onCookies(rendered.cookie);
      }
      return {
        url: rendered.url,
        status: 200,
        body: unwrapJsonDocument(rendered.body),
      };
    },
  };
}

/**
 * JSON API 被 WebView 包成 <pre> 显示时，outerHTML 不是原始 JSON。
 * 规则引擎需要原始文本才能按 JSONPath 解析，所以这里解包。
 */
function unwrapJsonDocument(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('<')) {
    return body;
  }
  const match = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!match) {
    return body;
  }
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
