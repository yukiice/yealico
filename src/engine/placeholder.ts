import type { Diagnostic, ExpandResult, PageContext } from './types';
import { getQueryValue, parseUrl } from './url';

/**
 * URL 占位符展开。
 *
 * 关键要求（见 docs/reference/yealico-rule-model.md）：
 * - 括号/引号感知，不能 split(':') 或全局正则替换。
 * - `{pageFormat:{page:1}}` 是嵌套占位符。
 * - `{json:...}` 内可能含 `}`、引号和转义，必须在顶层 `}` 结束。
 * - 未知占位符产生诊断，不静默当空串处理。
 */

interface Token {
  start: number;
  end: number;
  raw: string;
  name: string;
  body: string;
}

const KNOWN_PLACEHOLDERS = new Set([
  'page',
  'pageformat',
  'idcode',
  'cidcode',
  'keyword',
  'domain',
  'urlpath',
  'urlquery',
  'urlscheme',
  'urlhost',
  'urlport',
  'json',
]);

const OPEN = 0x7b;
const CLOSE = 0x7d;

function findMatchingBrace(input: string, openIndex: number): number {
  let depth = 1;
  let quote: string | null = null;
  let escaped = false;

  for (let i = openIndex + 1; i < input.length; i += 1) {
    const ch = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (input.charCodeAt(i) === OPEN) {
      depth += 1;
      continue;
    }
    if (input.charCodeAt(i) === CLOSE) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function parseToken(input: string, start: number, end: number): Token {
  const raw = input.slice(start + 1, end);
  const colon = raw.indexOf(':');
  const name = (colon === -1 ? raw : raw.slice(0, colon)).trim().toLowerCase();
  const body = colon === -1 ? '' : raw.slice(colon + 1);
  return { start, end, raw, name, body };
}

export function findPlaceholders(template: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < template.length) {
    if (template.charCodeAt(i) !== OPEN) {
      i += 1;
      continue;
    }
    const end = findMatchingBrace(template, i);
    if (end === -1) {
      // 未闭合的 `{` 保留字面量，交给调用方决定是否报错。
      break;
    }
    tokens.push(parseToken(template, i, end));
    i = end + 1;
  }
  return tokens;
}

export function scanPlaceholderDiagnostics(
  template: string,
  fieldPath: string,
): Diagnostic[] {
  return findPlaceholders(template)
    .filter(token => !KNOWN_PLACEHOLDERS.has(token.name))
    .map(token => ({
      fieldPath: `${fieldPath}.${token.name}`,
      code: 'UNKNOWN_PLACEHOLDER' as const,
      detail: `{${token.raw}}`,
      severity: 'error' as const,
    }));
}

function expandUrlPath(baseUrl: string, body: string): string {
  const url = parseUrl(baseUrl);
  if (!url) {
    return '';
  }
  const spec = body.trim();
  if (spec === '*') {
    return url.pathname.split('/').filter(Boolean).join('/');
  }
  const index = Number.parseInt(spec, 10);
  if (!Number.isFinite(index)) {
    return '';
  }
  if (index === 0) {
    return url.hostname;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (index > 0) {
    return segments[index - 1] ?? '';
  }
  return segments[segments.length + index] ?? '';
}

function expandUrlQuery(baseUrl: string, body: string): string {
  const url = parseUrl(baseUrl);
  if (!url) {
    return '';
  }
  const spec = body.trim();
  if (spec === '*') {
    return url.search;
  }
  if (!spec) {
    return '';
  }
  const firstPipe = spec.indexOf('|');
  const key = firstPipe === -1 ? spec : spec.slice(0, firstPipe);
  const fallback = firstPipe === -1 ? '' : spec.slice(firstPipe + 1);
  return getQueryValue(url.search, key) ?? fallback;
}

function expandPage(body: string, page: number | undefined): string {
  const parts = body.split(':');
  const start = Number.parseInt(parts[0] ?? '1', 10);
  const step = Number.parseInt(parts[1] ?? '1', 10);
  const current = page ?? start;
  const safeStart = Number.isFinite(start) ? start : 1;
  const safeStep = Number.isFinite(step) && step !== 0 ? step : 1;
  return String(safeStart + (current - 1) * safeStep);
}

function expandOne(
  token: Token,
  context: PageContext,
  diagnostics: Diagnostic[],
  fieldPath: string,
): { value: string; body?: string } {
  const baseUrl = context.baseUrl;
  switch (token.name) {
    case 'page':
      return { value: expandPage(token.body, context.page) };
    case 'pageformat': {
      if (!context.page || context.page <= 1) {
        return { value: '' };
      }
      const nested = expandTemplate(token.body, context, diagnostics, fieldPath);
      return { value: nested.url };
    }
    case 'idcode':
      return { value: context.idCode ?? '' };
    case 'cidcode':
      return { value: context.cidCode ?? '' };
    case 'keyword':
      return { value: context.keyword ?? '' };
    case 'domain':
      return { value: context.domain ?? '' };
    case 'urlpath':
      return { value: expandUrlPath(baseUrl, token.body) };
    case 'urlquery':
      return { value: expandUrlQuery(baseUrl, token.body) };
    case 'urlscheme':
      return { value: parseUrl(baseUrl)?.protocol ?? '' };
    case 'urlhost':
      return { value: parseUrl(baseUrl)?.hostname ?? '' };
    case 'urlport':
      return { value: parseUrl(baseUrl)?.port ?? '' };
    case 'json':
      return { value: '', body: token.body };
    default:
      diagnostics.push({
        fieldPath: `${fieldPath}.${token.name}`,
        code: 'UNKNOWN_PLACEHOLDER',
        detail: `{${token.raw}}`,
        severity: 'error',
      });
      return { value: '' };
  }
}

function expandTemplate(
  template: string,
  context: PageContext,
  diagnostics: Diagnostic[],
  fieldPath: string,
): ExpandResult {
  let output = '';
  let cursor = 0;
  let body: string | undefined;
  let method: 'GET' | 'POST' = 'GET';

  for (const token of findPlaceholders(template)) {
    output += template.slice(cursor, token.start);
    const expanded = expandOne(token, context, diagnostics, fieldPath);
    output += expanded.value;
    if (expanded.body !== undefined) {
      body = expanded.body;
      method = 'POST';
    }
    cursor = token.end + 1;
  }
  output += template.slice(cursor);

  return { url: output, method, body, diagnostics };
}

export function expandUrl(
  template: string,
  context: PageContext,
  fieldPath = 'url',
): ExpandResult {
  const diagnostics: Diagnostic[] = [];
  const result = expandTemplate(template, context, diagnostics, fieldPath);
  return { ...result, diagnostics };
}
