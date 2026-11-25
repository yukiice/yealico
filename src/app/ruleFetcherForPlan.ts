import type { RoutePlan, RuleFetcher } from '../engine';
import { createNativeWebViewRenderer } from '../platform/nativeWebView';
import { createFetchRuleFetcher } from '../platform/ruleFetcher';
import { createWebViewRuleFetcher } from '../platform/webviewFetcher';

/**
 * 是否需要 WebView 抓取。
 *
 * 两条来源：
 * - 规则计划声明了 NEEDS_WEBVIEW（规则本身要求 JS）；
 * - 站点级开关 forceWebView（如 Cloudflare JS 挑战，规则无法表达）。
 */
export function shouldUseWebView(
  plan: RoutePlan,
  forceWebView = false,
): boolean {
  if (forceWebView) {
    return true;
  }
  return plan.unsupported.some(item => item.code === 'NEEDS_WEBVIEW');
}

export interface RuleFetcherOptions {
  forceWebView?: boolean;
  /** 站点级 Cookie，两条抓取路径都会带上。 */
  cookie?: string;
  /** WebView 渲染后回传的 Cookie，由调用方决定是否落盘。 */
  onCookies?: (cookie: string) => void;
}

/**
 * 按 RoutePlan 选择页面 fetcher。
 *
 * 声明 WebView 的规则用 DOM 渲染器；其他规则保持普通 fetch。
 * 调用方仍需把同一份 fetcher 传给 load*，否则 execute* 会按计划阻断。
 */
export function createRuleFetcherForPlan(
  plan: RoutePlan,
  options: RuleFetcherOptions = {},
): RuleFetcher {
  if (shouldUseWebView(plan, options.forceWebView)) {
    return createWebViewRuleFetcher(createNativeWebViewRenderer(), {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.onCookies ? { onCookies: options.onCookies } : {}),
    });
  }
  return createFetchRuleFetcher({
    timeoutMs: 15_000,
    ...(options.cookie ? { cookie: options.cookie } : {}),
  });
}
