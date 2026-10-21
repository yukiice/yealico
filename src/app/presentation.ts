/**
 * 内容区展示状态。
 *
 * 引擎的 `plan.unsupported` 里混着两类诊断：
 * - 真正阻断执行的：`NEEDS_LOGIN` / `NEEDS_CONSENT`；
 * - 只是提示的：`NEEDS_WEBVIEW`（已有 WebView 渲染器）、
 *   `UNSUPPORTED_FEATURE`（例如声明了 `searchUrl`）。
 *
 * 界面不能拿“有没有 error 级诊断”当成“能不能展示内容”：
 * 阿巴基猫的列表能解析出 70 条，却因为一条 search 提示被整块吞掉。
 */
export type ContentState = 'content' | 'blocked' | 'empty';

export function contentState(itemCount: number, error: string): ContentState {
  if (itemCount > 0) {
    return 'content';
  }
  return error ? 'blocked' : 'empty';
}

/**
 * `idCode` 常直接来自 URL 路径（含 percent-encoding）。
 *
 * 列表第二行展示的是它，直接用会出现整屏 `%e3%82%b5` 这类串。
 * 解码失败（非法转义）时原样返回，不影响点击与导航。
 */
export function displayIdCode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
