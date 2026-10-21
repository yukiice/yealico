import type { RoutePlan, RuleFetcher } from '../engine';
import { createNativeWebViewRenderer } from '../platform/nativeWebView';
import { createFetchRuleFetcher } from '../platform/ruleFetcher';
import { createWebViewRuleFetcher } from '../platform/webviewFetcher';

/**
 * 按 RoutePlan 选择页面 fetcher。
 *
 * 声明 WebView 的规则用 DOM 渲染器；其他规则保持普通 fetch。
 * 调用方仍需把同一份 fetcher 传给 load*，否则 execute* 会按计划阻断。
 */
export function createRuleFetcherForPlan(plan: RoutePlan): RuleFetcher {
  const needsWebView = plan.unsupported.some(
    item => item.code === 'NEEDS_WEBVIEW',
  );
  if (needsWebView) {
    return createWebViewRuleFetcher(createNativeWebViewRenderer());
  }
  return createFetchRuleFetcher({ timeoutMs: 15_000 });
}
