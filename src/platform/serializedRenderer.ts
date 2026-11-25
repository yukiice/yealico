import type { WebViewRendererLike } from './webviewFetcher';

/**
 * 把渲染器串行化。
 *
 * 原生 WebView 模块一次只能渲染一个页面，并发调用会直接 reject
 * （`WebViewRenderer is already rendering a page`）。列表、详情、搜索
 * 可能同时发起请求，这里统一排队：后来的等前一个结束再开始。
 *
 * 队列用 promise 链实现，前一个失败不会卡住后续任务。
 */
export function createSerializedRenderer(
  inner: WebViewRendererLike,
): WebViewRendererLike {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    render(url, options) {
      return enqueue(() => inner.render(url, options));
    },
    renderHtml(html, baseUrl, options) {
      return enqueue(() => inner.renderHtml(html, baseUrl, options));
    },
  };
}
