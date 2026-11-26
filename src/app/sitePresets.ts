import type { ExtractedYealicoSite } from '../engine';
import { MANHUAGUI_RULE_JSON } from '../engine/real-rules.generated';

/**
 * 应用内置站点。
 *
 * 规则正文仍以 `artifacts/yealico-rules` 为准，由
 * `scripts/sync-real-rules.mjs` 同步成 TS 常量；这里只决定「哪几条给用户
 * 一键导入」，不复制规则内容。导入走与粘贴 JSON 相同的管线，因此诊断、
 * 去重和持久化行为完全一致。
 */
export interface SitePreset {
  /** 列表 key 与测试用标识，不参与站点 ID 计算（ID 由规则原文哈希得出）。 */
  id: string;
  name: string;
  domain: string;
  /** 副标题：写明已知限制，避免被理解成「完全适配」。 */
  summary: string;
  rule: ExtractedYealicoSite;
}

export const SITE_PRESETS: readonly SitePreset[] = [
  {
    id: 'manhuagui',
    name: '漫画柜（简体）',
    domain: 'www.manhuagui.com',
    summary: '公开页：列表 / 详情 / 图库可用，章节图片需 WebView 渲染',
    rule: MANHUAGUI_RULE_JSON as unknown as ExtractedYealicoSite,
  },
];

/** 预设规则的 JSON 原文，交给 importRuleText 复用同一套校验与诊断。 */
export function presetRuleText(preset: SitePreset): string {
  return JSON.stringify(preset.rule);
}
