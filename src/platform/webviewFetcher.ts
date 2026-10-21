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
      const rendered = await renderer.render(request.url, {
        waitForSelector: request.waitForSelector,
        timeoutMs: request.timeoutMs,
      });
      return {
        url: rendered.url,
        status: 200,
        body: rendered.body,
      };
    },
  };
}
