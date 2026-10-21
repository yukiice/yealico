import { NativeModules } from 'react-native';

import type { WebViewRendererLike } from './webviewFetcher';

interface NativeWebViewRenderer {
  render(
    url: string,
    waitForSelector: string | null,
    timeoutMs: number,
  ): Promise<{ url: string; body: string }>;
  renderHtml(
    html: string,
    baseUrl: string,
    waitForSelector: string | null,
    timeoutMs: number,
  ): Promise<{ url: string; body: string }>;
}

function nativeRenderer(): NativeWebViewRenderer {
  const module = NativeModules.WebViewRenderer as
    | NativeWebViewRenderer
    | undefined;
  if (
    !module ||
    typeof module.render !== 'function' ||
    typeof module.renderHtml !== 'function'
  ) {
    throw new Error('Native WebViewRenderer module is not available');
  }
  return module;
}

/**
 * Android 原生 WebView renderer 的 JS 包装。
 *
 * 原生模块负责把页面挂到 Activity、执行 JS、等待 DOM 标记并返回 outerHTML；
 * 这里是产品路径，Node 测试不会加载。
 */
export function createNativeWebViewRenderer(): WebViewRendererLike {
  const module = nativeRenderer();
  return {
    render(url, options = {}) {
      return module.render(
        url,
        options.waitForSelector ?? null,
        options.timeoutMs ?? 15_000,
      );
    },
    renderHtml(html, baseUrl, options = {}) {
      return module.renderHtml(
        html,
        baseUrl,
        options.waitForSelector ?? null,
        options.timeoutMs ?? 15_000,
      );
    },
  };
}
