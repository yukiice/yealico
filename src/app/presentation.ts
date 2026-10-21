/**
 * 内容区展示状态。
 *
 * 引擎的 `plan.unsupported` 里混着两类诊断：
 * - 真正阻断执行的：`NEEDS_WEBVIEW` / `NEEDS_LOGIN` / `NEEDS_CONSENT`；
 * - 只是提示的：例如站点声明了 `searchUrl`，得到 `UNSUPPORTED_FEATURE`。
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
