import type { RuleFetcher, RuleRequest, RuleResponse } from '../engine/load';

/**
 * 可执行 JS 的页面渲染器接口。
 *
 * Android 用原生 WebView 实现；Node 测试注入 fake renderer。
 */
export interface WebViewRendererLike {
  render(
    url: string,
    options?: { waitForSelector?: string; timeoutMs?: number },
  ): Promise<{ url: string; body: string }>;
  renderHtml(
    html: string,
    baseUrl: string,
    options?: { waitForSelector?: string; timeoutMs?: number },
  ): Promise<{ url: string; body: string }>;
}

export function createWebViewRuleFetcher(
  renderer: WebViewRendererLike,
): RuleFetcher {
  return {
    webview: true,
    async fetch(request: RuleRequest): Promise<RuleResponse> {
      // WebView 需要等页面 JS 渲染完再匹配选择器；重页面（如 mangacopy
      // 详情页）在真机上可能超过默认 15s，这里给渲染阶段一个更高的下限。
      const timeoutMs = Math.max(request.timeoutMs ?? 0, 30_000);
      const rendered = await renderer.render(request.url, {
        waitForSelector: request.waitForSelector,
        timeoutMs,
      });
      return {
        url: rendered.url,
        status: 200,
        body: rendered.body,
      };
    },
  };
}
