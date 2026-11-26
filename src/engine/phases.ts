import type { PagePhase, RoutePlan } from './types';

/**
 * 该阶段是否必须用 WebView 渲染。
 *
 * 判定依据是计划里的 `NEEDS_WEBVIEW` 诊断，而诊断的 fieldPath 保留了原始
 * 标记名（`flags.jsNeededDetail` 等），所以能反推出阶段：
 *
 * - `jsNeededIndex`   → 只有列表需要
 * - `jsNeededDetail`  → 只有详情需要
 * - `jsNeededGallery` → 只有图库需要
 * - 其他 `jsNeeded*`  → 未指明阶段，保守地认为所有阶段都需要
 *
 * 这样「详情要 JS、列表是静态 HTML」的站点（如漫画柜）仍能用普通 fetch
 * 拉列表，不必为一个标记把所有页面都塞进 WebView。
 */
export function needsWebViewForPhase(
  plan: RoutePlan,
  phase: PagePhase,
): boolean {
  return plan.unsupported.some(item => {
    if (item.code !== 'NEEDS_WEBVIEW') {
      return false;
    }
    const path = item.fieldPath.toLowerCase();
    if (path.includes('jsneededindex')) {
      return phase === 'index';
    }
    if (path.includes('jsneededdetail')) {
      return phase === 'detail';
    }
    if (path.includes('jsneededgallery')) {
      return phase === 'gallery';
    }
    return true;
  });
}
