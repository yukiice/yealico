import { selectAll } from 'css-select';
import {
  getAttributeValue,
  getInnerHTML,
  getOuterHTML,
  textContent,
} from 'domutils';
import type { AnyNode } from 'domhandler';
import LZString from 'lz-string';

import { queryJsonPath, UnsupportedJsonPathError } from './jsonpath';
import { parseUrl, resolveUrl } from './url';

import type { Diagnostic, JsonValue, SelectorSpec } from './types';

/**
 * Selector 执行器（P1 子集）。
 *
 * 已实现：CSS、JSONPath、this、text/html/attr/空函数、`.` 函数链、
 * regex + replacement、绝对 URL、LZString/Base64 等纯 JS 函数。
 *
 * 未实现：逗号分隔函数链（官方文档存在歧义，见 open-questions Q1）、
 * `+` 多 JSONPath、`$root` 完整语法、数学表达式（P2）。
 */

export class UnsupportedFunctionError extends Error {
  constructor(public readonly functionName: string) {
    super(`unsupported function: ${functionName}`);
    this.name = 'UnsupportedFunctionError';
  }
}

export class UnsupportedFunctionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFunctionSyntaxError';
  }
}

export class UnsupportedRegexError extends Error {
  constructor(public readonly pattern: string, public readonly reason?: unknown) {
    super(`unsupported regex: ${pattern}`);
    this.name = 'UnsupportedRegexError';
  }
}

export const SUPPORTED_FUNCTIONS = new Set([
  'html',
  'text',
  'attr',
  'decodebase64',
  'removingpercentencoding',
  'addingpercentencoding',
  'replace',
  'decompressfrombase64',
  'reversed',
  'regexreplacement',
]);

export interface SelectorContext {
  root: AnyNode | JsonValue;
  current: AnyNode | JsonValue;
  jsonRoot?: JsonValue;
  baseUrl: string;
  domain?: string;
}

function isJsonSelector(selector: string): boolean {
  return selector.trim().startsWith('$');
}

function normalizeJsonPath(selector: string): string {
  const trimmed = selector.trim();
  if (trimmed === '$root') {
    return '$';
  }
  if (trimmed.startsWith('$root')) {
    const rest = trimmed.slice('$root'.length);
    if (!rest) {
      return '$';
    }
    return rest.startsWith('$') ? rest : `$${rest}`;
  }
  return trimmed;
}

export function selectNodes(
  selector: string,
  context: SelectorContext,
): Array<AnyNode | JsonValue> {
  const trimmed = selector.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed === 'this') {
    return [context.current];
  }
  if (isJsonSelector(trimmed)) {
    const json = trimmed.startsWith('$root')
      ? context.jsonRoot
      : isJsonValue(context.current)
        ? context.current
        : context.jsonRoot;
    if (json === undefined) {
      return [];
    }
    const path = normalizeJsonPath(trimmed);
    const matches = queryJsonPath(json, path);
    // Yealico 的 item 路径通常指向一个数组（如 $.UpdateComicItems），
    // 选中数组本身时应展开成多个节点，而不是把数组当成唯一节点。
    if (matches.length === 1 && Array.isArray(matches[0])) {
      return matches[0];
    }
    return matches;
  }
  const nodes = selectAll(trimmed, context.root as AnyNode | AnyNode[]);
  return nodes as AnyNode[];
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    return true;
  }
  if (kind !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  // DOM 节点也是对象，但原型不是 Object.prototype/ null；不能当 JSON 处理。
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unquote(input: string): string {
  const trimmed = input.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      current += ch;
      continue;
    }
    if (depth === 0 && ch === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

export function parseFunctionChain(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  const parts = splitTopLevel(input, '.');
  if (parts.length === 1 && splitTopLevel(input, ',').length > 1) {
    throw new UnsupportedFunctionSyntaxError(
      'comma-separated function chains are not confirmed; see open-questions Q1',
    );
  }
  return parts.map(part => part.trim()).filter(Boolean);
}

function baseFunctionName(call: string): string {
  const paren = call.indexOf('(');
  return (paren === -1 ? call : call.slice(0, paren)).trim().toLowerCase();
}

function parseCallArguments(call: string): string[] {
  const open = call.indexOf('(');
  const close = call.lastIndexOf(')');
  if (open === -1 || close <= open) {
    return [];
  }
  return splitTopLevel(call.slice(open + 1, close), ',').map(part => part.trim());
}

function parseReplacementArgs(call: string): { from: string; to: string } {
  const args = parseCallArguments(call);
  const from = unquote(args[0] ?? '');
  let to = '';
  for (const arg of args.slice(1)) {
    const match = /^with\s*:\s*([\s\S]*)$/i.exec(arg);
    if (match) {
      to = unquote(match[1]);
      break;
    }
  }
  return { from, to };
}

function decodeBase64(value: string): string {
  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof atobFn !== 'function') {
    throw new UnsupportedFunctionError('decodeBase64 (atob unavailable)');
  }
  return atobFn(value);
}

function addingPercentEncoding(value: string, call: string): string {
  const args = parseCallArguments(call);
  const allowed = args.length > 0 ? unquote(args[0]) : '';
  const encoded = encodeURIComponent(value);
  if (!allowed) {
    return encoded;
  }
  return encoded.replace(/%([0-9A-F]{2})/gi, (match, hex: string) => {
    const ch = String.fromCharCode(Number.parseInt(hex, 16));
    return allowed.includes(ch) ? ch : match;
  });
}

function applyArithmetic(replacement: string, match: RegExpExecArray): string | undefined {
  if (!/[-+*/()]/.test(replacement)) {
    return undefined;
  }
  const substituted = replacement.replace(/\$(\d+)/g, (_, index: string) => {
    const value = match[Number(index)];
    return value === undefined ? '' : value;
  });
  if (!/^[\d\s.+\-*/()]+$/.test(substituted)) {
    return undefined;
  }
  const result = evaluateArithmetic(substituted);
  return result === null ? undefined : String(result);
}

export function evaluateArithmetic(input: string): number | null {
  let index = 0;
  const skip = () => {
    while (input[index] === ' ' || input[index] === '\t') {
      index += 1;
    }
  };
  const parseNumber = (): number | null => {
    skip();
    const start = index;
    while (/[0-9.]/.test(input[index] ?? '')) {
      index += 1;
    }
    if (start === index) {
      return null;
    }
    const value = Number.parseFloat(input.slice(start, index));
    return Number.isFinite(value) ? value : null;
  };
  const parseFactor = (): number | null => {
    skip();
    if (input[index] === '-') {
      index += 1;
      const value = parseFactor();
      return value === null ? null : -value;
    }
    if (input[index] === '+') {
      index += 1;
      return parseFactor();
    }
    if (input[index] === '(') {
      index += 1;
      const value = parseExpression();
      skip();
      if (input[index] !== ')') {
        return null;
      }
      index += 1;
      return value;
    }
    return parseNumber();
  };
  const parseTerm = (): number | null => {
    let value = parseFactor();
    if (value === null) {
      return null;
    }
    for (;;) {
      skip();
      const op = input[index];
      if (op !== '*' && op !== '/') {
        return value;
      }
      index += 1;
      const right = parseFactor();
      if (right === null) {
        return null;
      }
      value = op === '*' ? value * right : value / right;
    }
  };
  const parseExpression = (): number | null => {
    let value = parseTerm();
    if (value === null) {
      return null;
    }
    for (;;) {
      skip();
      const op = input[index];
      if (op !== '+' && op !== '-') {
        return value;
      }
      index += 1;
      const right = parseTerm();
      if (right === null) {
        return null;
      }
      value = op === '+' ? value + right : value - right;
    }
  };

  const result = parseExpression();
  skip();
  return index === input.length ? result : null;
}

export function applyRegex(value: string, spec: SelectorSpec): string {
  if (!spec.regex) {
    return value;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(spec.regex);
  } catch (error) {
    throw new UnsupportedRegexError(spec.regex, error);
  }
  const match = regex.exec(value);
  const replacement = spec.replacement ?? '$1';
  // Yealico 的 `$1|{source:}` 语义是“匹配成功取 $1，失败回退原值”，
  // 匹配成功时 {source:} 不能拼接进结果，否则标题会重复原文本。
  const hasSourceFallback = replacement.includes('{source:}');
  if (!match) {
    return hasSourceFallback ? value : '';
  }
  const effective = hasSourceFallback
    ? replacement.replace(/\|?\{source:\}/g, '')
    : replacement;
  const arithmetic = applyArithmetic(effective, match);
  if (arithmetic !== undefined) {
    return arithmetic;
  }
  return effective.replace(
    /\$([0-9]+)/g,
    (_, index: string) => match[Number(index)] ?? '',
  );
}

function applyStringFunction(value: string, call: string, spec: SelectorSpec): string {
  const name = baseFunctionName(call);
  switch (name) {
    case 'decodebase64':
      return decodeBase64(value);
    case 'removingpercentencoding':
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    case 'addingpercentencoding':
      return addingPercentEncoding(value, call);
    case 'replace': {
      const { from, to } = parseReplacementArgs(call);
      return from ? value.split(from).join(to) : value;
    }
    case 'decompressfrombase64':
      return LZString.decompressFromBase64(value) ?? '';
    case 'reversed':
      return [...value].reverse().join('');
    case 'regexreplacement':
      return applyRegex(value, spec);
    default:
      throw new UnsupportedFunctionError(call);
  }
}

function takeValue(
  node: AnyNode | JsonValue,
  call: string | undefined,
  spec: SelectorSpec,
): string {
  const name = call ? baseFunctionName(call) : '';
  if (isJsonValue(node) && typeof node !== 'object') {
    return node === null ? '' : String(node);
  }
  if (isJsonValue(node) && typeof node === 'object') {
    if (name === 'attr' && spec.param) {
      for (const key of spec.param.split(',').map(item => item.trim())) {
        const value = (node as Record<string, JsonValue>)[key];
        if (value !== undefined && value !== null && value !== '') {
          return String(value);
        }
      }
      return '';
    }
    if (name === 'html' || name === '') {
      return JSON.stringify(node);
    }
    return JSON.stringify(node);
  }

  const domNode = node as AnyNode;
  switch (name) {
    case 'text':
      return textContent(domNode);
    case 'html':
      return getInnerHTML(domNode);
    case 'attr': {
      if (!spec.param) {
        return '';
      }
      for (const attribute of spec.param.split(',').map(item => item.trim())) {
        const value = getAttributeValue(domNode as never, attribute);
        if (value !== undefined && value !== null && value !== '') {
          return value;
        }
      }
      return '';
    }
    case '':
      return getOuterHTML(domNode);
    default:
      // 字符串函数需要先取文本值。
      return textContent(domNode);
  }
}

export { resolveUrl };

export interface EvaluateResult {
  value: string;
  diagnostics: Diagnostic[];
}

function expandPattern(pattern: string | undefined, context: SelectorContext): string | undefined {
  if (!pattern) {
    return pattern;
  }
  const domain = context.domain || parseUrl(context.baseUrl)?.hostname || '';
  return pattern.replace(/\{domain:\}/gi, domain);
}

export function evaluateSelector(
  spec: SelectorSpec,
  context: SelectorContext,
  fieldPath: string,
): EvaluateResult {
  const diagnostics: Diagnostic[] = [];
  const resolvedSpec: SelectorSpec = {
    ...spec,
    regex: expandPattern(spec.regex, context),
    replacement: expandPattern(spec.replacement, context),
  };
  let selected: Array<AnyNode | JsonValue>;
  try {
    selected = selectNodes(resolvedSpec.selector, context);
  } catch (error) {
    diagnostics.push({
      fieldPath: `${fieldPath}.selector`,
      code:
        error instanceof UnsupportedJsonPathError
          ? 'UNSUPPORTED_JSONPATH'
          : 'INVALID_RULE',
      detail: error instanceof Error ? error.message : String(error),
      severity: 'error',
    });
    return { value: '', diagnostics };
  }
  if (selected.length === 0) {
    return { value: '', diagnostics };
  }

  let chain: string[];
  try {
    chain = parseFunctionChain(resolvedSpec.function);
  } catch (error) {
    diagnostics.push({
      fieldPath: `${fieldPath}.function`,
      code: 'UNSUPPORTED_FUNCTION_SYNTAX',
      detail: error instanceof Error ? error.message : String(error),
      severity: 'error',
    });
    return { value: '', diagnostics };
  }

  let value = takeValue(selected[0], chain[0], resolvedSpec);
  for (const call of chain.slice(1)) {
    try {
      value = applyStringFunction(value, call, resolvedSpec);
    } catch (error) {
      diagnostics.push({
        fieldPath: `${fieldPath}.function`,
        code:
          error instanceof UnsupportedRegexError
            ? 'UNSUPPORTED_REGEX'
            : 'UNSUPPORTED_FUNCTION',
        detail: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
      return { value: '', diagnostics };
    }
  }

  if (resolvedSpec.regex && !chain.some(call => baseFunctionName(call) === 'regexreplacement')) {
    try {
      value = applyRegex(value, resolvedSpec);
    } catch (error) {
      diagnostics.push({
        fieldPath: `${fieldPath}.regex`,
        code: 'UNSUPPORTED_REGEX',
        detail: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
      return { value: '', diagnostics };
    }
  }

  if (spec.absoluteUrl) {
    value = resolveUrl(value, context.baseUrl);
  }

  return { value, diagnostics };
}
