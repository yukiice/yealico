import type {
  Diagnostic,
  RuleDocument,
  RulePage,
  RulePageSelection,
  RulePageSummary,
} from './types';

/**
 * 站点多页面配置。
 *
 * 提取后的 `pages` 是站点页面列表，不是规则文档本身。选择页面时：
 * - 页面 URL / rule / displayMode 覆盖站点默认值；
 * - 页面没有提供的字段回退到站点级规则；
 * - flags 和 headers 合并，页面优先；
 * - 选中的页面不会继续携带 `pages`，避免递归扫描。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageName(value: unknown, index: number): string {
  if (isRecord(value) && typeof value.name === 'string' && value.name.trim()) {
    return value.name;
  }
  return `Page ${index + 1}`;
}

export function listRulePages(rule: RuleDocument): RulePageSummary[] {
  if (!Array.isArray(rule.pages)) {
    return [];
  }
  return rule.pages.map((page, index) => ({
    index,
    name: pageName(page, index),
    ...(page && typeof page === 'object' && typeof page.pk === 'number'
      ? { pk: page.pk }
      : {}),
    ...(page && typeof page === 'object' && typeof page.displayMode === 'string'
      ? { displayMode: page.displayMode }
      : {}),
  }));
}

export interface ResolvedRulePage {
  rule: RuleDocument;
  page?: RulePage;
  index?: number;
  diagnostics: Diagnostic[];
}

function pageDisplayMode(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'default') {
    return undefined;
  }
  return trimmed;
}

function mergeHeaders(
  base: RuleDocument['headers'],
  page: RulePage,
  fieldPath: string,
  diagnostics: Diagnostic[],
): Record<string, string> | undefined {
  if (page.headers !== undefined && !isRecord(page.headers)) {
    diagnostics.push({
      fieldPath: `${fieldPath}.headers`,
      code: 'INVALID_RULE',
      detail: 'page headers must be an object',
      severity: 'error',
    });
    return base;
  }

  const merged = { ...(isRecord(base) ? base : {}) };
  for (const [key, value] of Object.entries(page.headers ?? {})) {
    if (typeof value !== 'string') {
      diagnostics.push({
        fieldPath: `${fieldPath}.headers.${key}`,
        code: 'INVALID_RULE',
        detail: 'header value must be string',
        severity: 'error',
      });
      continue;
    }
    merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeFlags(
  base: RuleDocument['flags'],
  page: RulePage,
  fieldPath: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  if (page.flags !== undefined && !isRecord(page.flags)) {
    diagnostics.push({
      fieldPath: `${fieldPath}.flags`,
      code: 'INVALID_RULE',
      detail: 'page flags must be an object',
      severity: 'error',
    });
    return base;
  }

  const merged = {
    ...(isRecord(base) ? base : {}),
    ...(isRecord(page.flags) ? page.flags : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * 按名称或 0 起的索引选择页面。
 *
 * 未传 selection 时返回站点级默认规则；这保留“站点默认首页”行为，
 * 不擅自把 pages[0] 当成首页（真实规则里第一页可能是登录后的收藏页）。
 */
export function resolveRulePage(
  rule: RuleDocument,
  selection?: RulePageSelection,
): ResolvedRulePage {
  const diagnostics: Diagnostic[] = [];

  if (rule.pages !== undefined && !Array.isArray(rule.pages)) {
    diagnostics.push({
      fieldPath: 'pages',
      code: 'INVALID_RULE',
      detail: 'pages must be an array',
      severity: 'error',
    });
    return { rule, diagnostics };
  }

  const pages = rule.pages ?? [];
  if (selection === undefined) {
    return { rule, diagnostics };
  }

  let index = -1;
  if (typeof selection === 'number') {
    if (Number.isInteger(selection) && selection >= 0 && selection < pages.length) {
      index = selection;
    }
  } else if (typeof selection === 'string') {
    index = pages.findIndex(page => pageName(page, 0) === selection);
  }

  if (index < 0) {
    diagnostics.push({
      fieldPath: 'pages',
      code: 'MISSING_FIELD',
      detail: `page "${String(selection)}" not found`,
      severity: 'error',
    });
    return { rule, diagnostics };
  }

  const rawPage = pages[index];
  if (!isRecord(rawPage)) {
    diagnostics.push({
      fieldPath: `pages[${index}]`,
      code: 'INVALID_RULE',
      detail: 'page must be an object',
      severity: 'error',
    });
    return { rule, diagnostics };
  }

  const rawName = typeof rawPage.name === 'string' ? rawPage.name : '';
  const page: RulePage = { ...(rawPage as RulePage), name: pageName(rawPage, index) };
  const name = page.name;
  const fieldPath = `pages[${index}]`;
  if (!rawName.trim()) {
    diagnostics.push({
      fieldPath: `${fieldPath}.name`,
      code: 'MISSING_FIELD',
      detail: 'page name is missing; using a positional label',
      severity: 'warning',
    });
  }

  const flags = mergeFlags(rule.flags, page, fieldPath, diagnostics);
  const headers = mergeHeaders(rule.headers, page, fieldPath, diagnostics);
  const displayMode = pageDisplayMode(page.displayMode) ?? rule.displayMode;

  const scoped: RuleDocument = {
    ...rule,
    displayMode,
    indexUrl: page.indexUrl || rule.indexUrl,
    detailUrl: page.detailUrl || rule.detailUrl,
    galleryUrl: page.galleryUrl || rule.galleryUrl,
    indexRule: page.indexRule ?? rule.indexRule,
    detailRule: page.detailRule ?? rule.detailRule,
    galleryRule: page.galleryRule ?? rule.galleryRule,
    seriesRule: page.seriesRule ?? rule.seriesRule,
    flags,
    headers,
    pages: undefined,
    selectedPage: {
      index,
      name,
      ...(typeof page.pk === 'number' ? { pk: page.pk } : {}),
    },
  };

  return { rule: scoped, page, index, diagnostics };
}
