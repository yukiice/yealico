import type { RuleDocument, RuleFields } from './types';

/**
 * 把 macOS Yealico 容器里提取出的站点 JSON 转成项目的 RuleDocument。
 *
 * 输入来自 scripts/extract_yealico_rules.py：
 * - 只包含站点元数据、URL、规则 JSON、命名规则和页面；
 * - 不包含 Cookie、账号、收藏、历史。
 */

export interface ExtractedYealicoNamedRule {
  pk: number;
  name: string;
  rule: RuleFields | null;
}

export interface ExtractedYealicoPage {
  pk: number;
  name: string;
  listUrl?: string | null;
  detailUrl?: string | null;
  galleryUrl?: string | null;
  displayMode?: string | null;
  flags?: string | null;
  listRulePk?: number | null;
  detailRulePk?: number | null;
  galleryRulePk?: number | null;
  seriesRulePk?: number | null;
  listRule?: RuleFields | null;
  detailRule?: RuleFields | null;
  galleryRule?: RuleFields | null;
  seriesRule?: RuleFields | null;
}

export interface ExtractedYealicoSite {
  meta: {
    bundleId?: string;
    sitePk: number;
    name: string;
    domain: string;
    version?: string;
    author?: string;
    displayMode?: string;
    flags?: string;
    extractedAt?: string;
  };
  urls: {
    index?: string | null;
    detail?: string | null;
    gallery?: string | null;
    search?: string | null;
  };
  loginUrl?: string | null;
  headers?: Record<string, string | null | undefined>;
  rules: {
    index?: RuleFields | null;
    detail?: RuleFields | null;
    gallery?: RuleFields | null;
    series?: RuleFields | null;
    search?: RuleFields | null;
    tagSearch?: RuleFields | null;
    extra?: RuleFields | null;
  };
  namedRules: {
    list?: ExtractedYealicoNamedRule[];
    detail?: ExtractedYealicoNamedRule[];
    gallery?: ExtractedYealicoNamedRule[];
    series?: ExtractedYealicoNamedRule[];
  };
  pages: ExtractedYealicoPage[];
}

export function parseFlagString(value: string | null | undefined): Record<string, boolean> {
  if (!value) {
    return {};
  }
  const flags: Record<string, boolean> = {};
  for (const item of value.split(',')) {
    const flag = item.trim();
    if (!flag || flag.toLowerCase() === 'default') {
      continue;
    }
    flags[flag] = true;
  }
  return flags;
}

export function firstDisplayMode(value: string | null | undefined): string {
  if (!value) {
    return 'collection';
  }
  const modes = value
    .split(',')
    .map(mode => mode.trim())
    .filter(Boolean);
  const selected = modes.find(mode => mode.toLowerCase() !== 'default') ?? modes[0];
  return selected ? selected.toLowerCase() : 'collection';
}

function parseHeaders(
  value: string | Record<string, string> | null | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // 非 JSON headers 暂不解析，保留为未支持能力。
  }
  return undefined;
}

export function toRuleDocument(site: ExtractedYealicoSite): RuleDocument {
  const pages = site.pages.map(page => ({
    pk: page.pk,
    name: page.name,
    displayMode: firstDisplayMode(page.displayMode),
    flags: parseFlagString(page.flags),
    indexUrl: page.listUrl || undefined,
    detailUrl: page.detailUrl || undefined,
    galleryUrl: page.galleryUrl || undefined,
    indexRule: page.listRule ?? undefined,
    detailRule: page.detailRule ?? undefined,
    galleryRule: page.galleryRule ?? undefined,
    seriesRule: page.seriesRule ?? undefined,
  }));

  return {
    name: site.meta.name,
    domain: site.meta.domain,
    displayMode: firstDisplayMode(site.meta.displayMode),
    loginUrl: site.loginUrl || undefined,
    indexUrl: site.urls.index || undefined,
    detailUrl: site.urls.detail || undefined,
    galleryUrl: site.urls.gallery || undefined,
    searchUrl: site.urls.search || undefined,
    headers: parseHeaders(site.headers?.site),
    flags: parseFlagString(site.meta.flags),
    indexRule: site.rules.index ?? undefined,
    detailRule: site.rules.detail ?? undefined,
    galleryRule: site.rules.gallery ?? undefined,
    seriesRule: site.rules.series ?? undefined,
    searchRule: site.rules.search ?? undefined,
    tagSearchRule: site.rules.tagSearch ?? undefined,
    pages,
  };
}
