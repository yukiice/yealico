import { resolveRulePage } from './pages';
import { scanPlaceholderDiagnostics } from './placeholder';
import { validateJsonPath } from './jsonpath';
import {
  parseFunctionChain,
  SUPPORTED_FUNCTIONS,
  UnsupportedFunctionSyntaxError,
} from './selector';
import type {
  Capabilities,
  Diagnostic,
  RuleDocument,
  RulePage,
  RulePageSelection,
  RoutePlan,
  SelectorSpec,
} from './types';

/**
 * 规则 -> RoutePlan。
 *
 * P1 只做“能不能执行”的静态判断：
 * - 能力扫描（WebView / 登录 / 字符集 / POST / ignoreDetail）。
 * - 未知字段、未知函数、未知占位符、非法正则。
 * - 首版不实现的 search / series；pages 通过 buildPagePlan 选择。
 *
 * 不在这一层发网络请求，也不猜测站点内容。
 */

const SELECTOR_KEYS = new Set([
  'selector',
  'function',
  'param',
  'regex',
  'replacement',
  'absoluteUrl',
]);

const LIST_FIELDS = new Set([
  'name',
  'index',
  'text',
  'item',
  'idCode',
  'title',
  'cover',
  'coverWidth',
  'coverHeight',
  'largeImage',
  'Video',
  'video',
  'category',
  'author',
  'uploader',
  'published',
  'datetime',
  'rating',
  'likes',
  'totalImages',
]);

const DETAIL_FIELDS = new Set([
  ...LIST_FIELDS,
  'tagRule',
  'pictureRule',
  'chapterRule',
  'commentRule',
  'videoRule',
  'photoAlbumLink',
  'pageReadyMarker',
  'desc',
]);

const GALLERY_FIELDS = new Set([
  'secondLevelPageUrl',
  'totalPages',
  'item',
  'image',
  'httpHeaders',
  'videoRule',
]);

const PICTURE_FIELDS = new Set(['item', 'thumbnail', 'url', 'link']);
const CHAPTER_FIELDS = new Set(['item', 'idCode', 'title', 'datetime', 'url']);
const TAG_FIELDS = new Set(['item', 'name', 'url']);
const COMMENT_FIELDS = new Set(['item', 'avatar', 'username', 'datetime', 'content']);

const SUPPORTED_DISPLAY_MODES = new Set(['text', 'collection']);

const KNOWN_FLAGS = new Set([
  'loginrequired',
  'consentrequired',
  'repeatedthumbnail',
  'ignoredetail',
  'useragentmobile',
  'gbkurlencodingall',
]);

const KNOWN_FLAG_PREFIXES = ['jsneeded', 'post', 'scroll', 'big5charset', 'gbkcharset'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function push(
  diagnostics: Diagnostic[],
  fieldPath: string,
  code: Diagnostic['code'],
  detail?: string,
  severity: Diagnostic['severity'] = 'error',
): void {
  diagnostics.push({ fieldPath, code, detail, severity });
}

export function normalizeSelector(value: unknown): SelectorSpec | null {
  if (typeof value === 'string') {
    return { selector: value };
  }
  if (isRecord(value) && typeof value.selector === 'string') {
    return value as unknown as SelectorSpec;
  }
  return null;
}

/**
 * 页面级 URL 选择器允许省略 selector：此时默认作用于整页。
 * 真实规则（M-ngabz GalleryRule.secondLevelPageUrl）采用这种写法，
 * 不能按普通 SelectorSpec 直接判为非法。
 */
export function normalizePageSelector(value: unknown): SelectorSpec | null {
  const spec = normalizeSelector(value);
  if (spec) {
    return spec;
  }
  if (
    isRecord(value) &&
    (typeof value.regex === 'string' || typeof value.replacement === 'string')
  ) {
    return { selector: 'this', ...value } as unknown as SelectorSpec;
  }
  return null;
}

function validatePageSelector(
  value: unknown,
  fieldPath: string,
  diagnostics: Diagnostic[],
): void {
  const spec = normalizePageSelector(value);
  if (!spec) {
    push(diagnostics, fieldPath, 'INVALID_RULE', 'page selector must be a string or object');
    return;
  }
  validateSelector(spec, fieldPath, diagnostics);
}

function flagName(key: string): string {
  return key.toLowerCase();
}

function isKnownFlag(key: string): boolean {
  const lower = flagName(key);
  if (KNOWN_FLAGS.has(lower)) {
    return true;
  }
  return KNOWN_FLAG_PREFIXES.some(prefix => lower.startsWith(prefix));
}

function scanFlags(
  flags: Record<string, unknown>,
  capabilities: Capabilities,
  diagnostics: Diagnostic[],
): void {
  for (const [key, raw] of Object.entries(flags)) {
    const lower = flagName(key);
    if (!isKnownFlag(key)) {
      push(diagnostics, `flags.${key}`, 'UNKNOWN_FIELD', 'unknown flag', 'warning');
      continue;
    }
    if (!raw) {
      continue;
    }
    if (lower.startsWith('jsneeded')) {
      capabilities.webview = true;
      // WebView 渲染器已经实现，renderer 切换按 code 判断而不是 severity，
      // 所以这里只声明能力，不再把“需要 WebView”当成阻断错误。
      push(
        diagnostics,
        `flags.${key}`,
        'NEEDS_WEBVIEW',
        `${key} requires WebView`,
        'warning',
      );
      continue;
    }
    if (lower === 'loginrequired') {
      capabilities.login = true;
      push(diagnostics, `flags.${key}`, 'NEEDS_LOGIN', 'site requires login');
      continue;
    }
    if (lower === 'consentrequired') {
      capabilities.consent = true;
      push(diagnostics, `flags.${key}`, 'NEEDS_CONSENT', 'site requires consent');
      continue;
    }
    if (lower.startsWith('post')) {
      capabilities.post = true;
      continue;
    }
    if (lower.startsWith('scroll')) {
      capabilities.scroll = true;
      continue;
    }
    if (lower.startsWith('gbkcharset')) {
      capabilities.charset = 'gbk';
      continue;
    }
    if (lower.startsWith('big5charset')) {
      capabilities.charset = 'big5';
      continue;
    }
    if (lower === 'gbkurlencodingall') {
      capabilities.gbkUrlEncoding = true;
      continue;
    }
    if (lower === 'ignoredetail') {
      capabilities.ignoreDetail = true;
      continue;
    }
    if (lower === 'repeatedthumbnail') {
      capabilities.repeatedThumbnail = true;
    }
  }
  capabilities.static = !capabilities.webview;
}

function validateSelector(
  value: unknown,
  fieldPath: string,
  diagnostics: Diagnostic[],
): void {
  const spec = normalizeSelector(value);
  if (!spec) {
    push(diagnostics, fieldPath, 'INVALID_RULE', 'selector must be a string or object');
    return;
  }
  if (!spec.selector.trim()) {
    push(diagnostics, `${fieldPath}.selector`, 'INVALID_RULE', 'empty selector');
  }
  if (spec.selector.trim().startsWith('$')) {
    const raw = spec.selector.trim();
    if (raw.includes('+')) {
      push(
        diagnostics,
        `${fieldPath}.selector`,
        'UNSUPPORTED_FEATURE',
        'multi JSONPath (+) is not implemented in v1',
      );
    } else {
      const rest = raw.startsWith('$root') ? raw.slice('$root'.length) : raw;
      const normalized =
        raw.startsWith('$root') && !rest.startsWith('$') ? `$${rest}` : rest;
      const jsonPathError = validateJsonPath(normalized);
      if (jsonPathError) {
        push(
          diagnostics,
          `${fieldPath}.selector`,
          'UNSUPPORTED_JSONPATH',
          jsonPathError,
        );
      }
    }
  }
  for (const key of Object.keys(spec)) {
    if (!SELECTOR_KEYS.has(key)) {
      push(diagnostics, `${fieldPath}.${key}`, 'UNKNOWN_FIELD', key);
    }
  }
  for (const key of ['selector', 'function', 'param', 'regex', 'replacement'] as const) {
    if (spec[key] !== undefined && typeof spec[key] !== 'string') {
      push(diagnostics, `${fieldPath}.${key}`, 'INVALID_RULE', `${key} must be string`);
    }
  }
  if (spec.regex) {
    try {
      RegExp(spec.regex);
    } catch (error) {
      push(
        diagnostics,
        `${fieldPath}.regex`,
        'UNSUPPORTED_REGEX',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  try {
    for (const call of parseFunctionChain(spec.function)) {
      const name = call.indexOf('(') === -1 ? call : call.slice(0, call.indexOf('('));
      if (!SUPPORTED_FUNCTIONS.has(name.trim().toLowerCase())) {
        push(
          diagnostics,
          `${fieldPath}.function`,
          'UNSUPPORTED_FUNCTION',
          call,
        );
      }
    }
  } catch (error) {
    push(
      diagnostics,
      `${fieldPath}.function`,
      'UNSUPPORTED_FUNCTION_SYNTAX',
      error instanceof UnsupportedFunctionSyntaxError
        ? error.message
        : String(error),
    );
  }
  if (spec.absoluteUrl !== undefined && typeof spec.absoluteUrl !== 'boolean') {
    push(
      diagnostics,
      `${fieldPath}.absoluteUrl`,
      'INVALID_RULE',
      'absoluteUrl must be boolean',
    );
  }
}

function scanRule(
  value: unknown,
  allowed: Set<string>,
  fieldPath: string,
  diagnostics: Diagnostic[],
  root = false,
): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    push(diagnostics, fieldPath, 'INVALID_RULE', 'rule must be an object');
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${fieldPath}.${key}`;
    if (
      child &&
      typeof child === 'object' &&
      !Array.isArray(child) &&
      Object.keys(child).length === 0
    ) {
      // 真实规则常用空对象表示“该字段不存在”，不是非法 selector。
      continue;
    }
    if (root && key === 'name' && typeof child === 'string') {
      continue;
    }
    if (root && key === 'index' && typeof child === 'number') {
      continue;
    }
    if (!allowed.has(key)) {
      push(diagnostics, childPath, 'UNKNOWN_FIELD', key);
      continue;
    }
    if (key === 'tagRule') {
      scanRule(child, TAG_FIELDS, childPath, diagnostics);
      continue;
    }
    if (key === 'secondLevelPageUrl' || key === 'photoAlbumLink') {
      validatePageSelector(child, childPath, diagnostics);
      continue;
    }
    if (key === 'pictureRule' || key === 'videoRule') {
      scanRule(child, PICTURE_FIELDS, childPath, diagnostics);
      continue;
    }
    if (key === 'chapterRule') {
      scanRule(child, CHAPTER_FIELDS, childPath, diagnostics);
      continue;
    }
    if (key === 'commentRule') {
      scanRule(child, COMMENT_FIELDS, childPath, diagnostics);
      continue;
    }
    validateSelector(child, childPath, diagnostics);
  }
}

function scanUrl(
  value: unknown,
  fieldPath: string,
  diagnostics: Diagnostic[],
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string') {
    push(diagnostics, fieldPath, 'INVALID_RULE', 'url must be string');
    return;
  }
  if (!value.trim()) {
    push(diagnostics, fieldPath, 'INVALID_RULE', 'empty url');
    return;
  }
  diagnostics.push(...scanPlaceholderDiagnostics(value, fieldPath));
}

export interface PageRoutePlan {
  rule: RuleDocument;
  page?: RulePage;
  plan: RoutePlan;
}

/**
 * 选择站点页面并生成该页面的执行计划。
 *
 * 返回的 rule 已合并页面覆盖值，调用方应把它传给 execute* / load*，
 * 而不是继续使用原始站点规则。
 */
export function buildPagePlan(
  rule: RuleDocument,
  page: RulePageSelection,
): PageRoutePlan {
  const resolved = resolveRulePage(rule, page);
  const plan = buildRoutePlan(resolved.rule);
  if (resolved.diagnostics.length > 0) {
    plan.unsupported.unshift(...resolved.diagnostics);
  }
  if (resolved.page) {
    plan.site.page = {
      index: resolved.index ?? 0,
      name: resolved.page.name,
      ...(typeof resolved.page.pk === 'number' ? { pk: resolved.page.pk } : {}),
    };
  }
  return { rule: resolved.rule, page: resolved.page, plan };
}

export function buildRoutePlan(rule: RuleDocument): RoutePlan {
  const diagnostics: Diagnostic[] = [];
  const capabilities: Capabilities = {
    static: true,
    webview: false,
    login: false,
    consent: false,
    post: false,
    charset: 'utf-8',
    gbkUrlEncoding: false,
    ignoreDetail: false,
    repeatedThumbnail: false,
    scroll: false,
  };

  if (!isRecord(rule)) {
    push(diagnostics, '', 'INVALID_RULE', 'rule must be an object');
    return {
      site: { name: '', domain: '', displayMode: 'collection' },
      capabilities,
      unsupported: diagnostics,
    };
  }

  if (rule.flags !== undefined) {
    if (!isRecord(rule.flags)) {
      push(diagnostics, 'flags', 'INVALID_RULE', 'flags must be an object');
    } else {
      scanFlags(rule.flags, capabilities, diagnostics);
    }
  }

  if (rule.headers !== undefined) {
    if (!isRecord(rule.headers)) {
      push(diagnostics, 'headers', 'INVALID_RULE', 'headers must be an object');
    } else {
      for (const [key, value] of Object.entries(rule.headers)) {
        if (typeof value !== 'string') {
          push(diagnostics, `headers.${key}`, 'INVALID_RULE', 'header value must be string');
        }
      }
    }
  }

  scanUrl(rule.indexUrl, 'indexUrl', diagnostics);
  scanUrl(rule.detailUrl, 'detailUrl', diagnostics);
  scanUrl(rule.galleryUrl, 'galleryUrl', diagnostics);
  scanUrl(rule.searchUrl, 'searchUrl', diagnostics);
  scanUrl(rule.loginUrl, 'loginUrl', diagnostics);

  // series 仍是 v1 未实现的可选能力，不影响列表、详情、图库、搜索主链路。
  // 标成 warning 后不会进入 UI 的错误横幅，避免把"能用的站点"显示成失败。
  if (rule.seriesRule) {
    push(
      diagnostics,
      'seriesRule',
      'UNSUPPORTED_SERIES',
      'series pages are not implemented in v1',
      'warning',
    );
  }
  if (capabilities.ignoreDetail && !rule.galleryRule && !rule.galleryUrl) {
    push(
      diagnostics,
      'flags.ignoreDetail',
      'UNSUPPORTED_IGNORE_DETAIL',
      'ignoreDetail requires galleryRule/galleryUrl',
    );
  }

  const displayMode = asString(rule.displayMode) || 'collection';
  if (!SUPPORTED_DISPLAY_MODES.has(displayMode)) {
    push(
      diagnostics,
      'displayMode',
      'UNSUPPORTED_FEATURE',
      `displayMode "${displayMode}" is not implemented in v1`,
      'warning',
    );
  }

  if (!rule.indexRule) {
    push(diagnostics, 'indexRule', 'MISSING_FIELD', 'indexRule is required');
  }
  scanRule(rule.indexRule, LIST_FIELDS, 'indexRule', diagnostics, true);
  scanRule(rule.detailRule, DETAIL_FIELDS, 'detailRule', diagnostics, true);
  scanRule(rule.galleryRule, GALLERY_FIELDS, 'galleryRule', diagnostics, true);
  scanRule(rule.seriesRule, LIST_FIELDS, 'seriesRule', diagnostics, true);

  return {
    site: {
      name: asString(rule.name),
      domain: asString(rule.domain),
      displayMode,
    },
    capabilities,
    unsupported: diagnostics,
  };
}
