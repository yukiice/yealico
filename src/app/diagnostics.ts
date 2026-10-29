import type { Diagnostic } from '../engine';
import { sanitizeText } from './debugReport';

/**
 * 把诊断里的 error 级条目压成一小段可读文本。
 *
 * UI 只展示前几条：完整诊断留在引擎结果里，界面不承担调试输出职责。
 * 文本会过一遍脱敏——阅读器的报错会带图床地址，签名参数不能直接上屏。
 */
export function errorText(diagnostics: Diagnostic[], limit = 3): string {
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length === 0) {
    return '';
  }
  return errors
    .slice(0, Math.max(1, limit))
    .map(item => `${item.code}: ${sanitizeText(item.detail ?? item.fieldPath)}`)
    .join('\n');
}

/**
 * 导入失败的友好文案。
 *
 * 加密导出是用户最可能撞上的“看不懂的 code”：
 * 直接展示 `UNSUPPORTED_ENCRYPTED_EXPORT: ...` 等于让用户自己去翻文档。
 */
const FRIENDLY: Partial<Record<Diagnostic['code'], string>> = {
  UNSUPPORTED_ENCRYPTED_EXPORT:
    '这是 Yealico 加密导出文件，当前无法解密。请使用明文规则 JSON。',
};

export function friendlyDiagnostic(item: Diagnostic): string {
  return (
    FRIENDLY[item.code] ??
    `${item.code}: ${sanitizeText(item.detail ?? item.fieldPath)}`
  );
}
