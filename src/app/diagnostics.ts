import type { Diagnostic } from '../engine';

/**
 * 把诊断里的 error 级条目压成一小段可读文本。
 *
 * UI 只展示前几条：完整诊断留在引擎结果里，界面不承担调试输出职责。
 */
export function errorText(diagnostics: Diagnostic[], limit = 3): string {
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length === 0) {
    return '';
  }
  return errors
    .slice(0, Math.max(1, limit))
    .map(item => `${item.code}: ${item.detail ?? item.fieldPath}`)
    .join('\n');
}
