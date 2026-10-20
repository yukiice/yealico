import type { JsonValue } from './types';

/**
 * 受限 JSONPath（P1 子集）。
 *
 * 只支持：根 `$`、点号键、`['key']`、`[n]`、`[*]`。
 * 明确不支持：递归下降 `..`、过滤表达式 `[?(...)]`、切片、联合。
 *
 * 原因：
 * - 官方规则里 JSONPath 主要用于定位列表和字段，不需要可执行表达式。
 * - `jsonpath-plus` 的 Node 构建依赖 `node:vm`，Metro/Hermes 无法打包；
 *   其过滤表达式还引入不必要的代码执行面。
 * - P1 的契约要求“未知能力明确失败”，而不是用更宽的语义猜。
 */

type Step =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number }
  | { type: 'wildcard' };

export class UnsupportedJsonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedJsonPathError';
  }
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonPath(path: string): Step[] {
  const input = path.trim();
  if (!input.startsWith('$')) {
    throw new UnsupportedJsonPathError('JSONPath must start with $');
  }
  if (input === '$') {
    return [];
  }

  const steps: Step[] = [];
  let i = 1;

  while (i < input.length) {
    const ch = input[i];
    if (ch === '.') {
      if (input[i + 1] === '.') {
        throw new UnsupportedJsonPathError('recursive descent (..) is not supported');
      }
      i += 1;
      const start = i;
      while (i < input.length && /[A-Za-z0-9_$-]/.test(input[i])) {
        i += 1;
      }
      const key = input.slice(start, i);
      if (!key) {
        throw new UnsupportedJsonPathError('empty key after dot');
      }
      steps.push({ type: 'key', key });
      continue;
    }

    if (ch === '[') {
      const close = input.indexOf(']', i + 1);
      if (close === -1) {
        throw new UnsupportedJsonPathError('unclosed bracket');
      }
      const inner = input.slice(i + 1, close).trim();
      if (inner === '*') {
        steps.push({ type: 'wildcard' });
      } else if (/^-?\d+$/.test(inner)) {
        steps.push({ type: 'index', index: Number.parseInt(inner, 10) });
      } else if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      ) {
        steps.push({ type: 'key', key: inner.slice(1, -1) });
      } else {
        throw new UnsupportedJsonPathError(
          `unsupported bracket expression: [${inner}]`,
        );
      }
      i = close + 1;
      continue;
    }

    throw new UnsupportedJsonPathError(`unexpected character: ${ch}`);
  }

  return steps;
}

export function validateJsonPath(path: string): string | null {
  try {
    parseJsonPath(path);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function queryJsonPath(root: JsonValue, path: string): JsonValue[] {
  const steps = parseJsonPath(path);
  let current: JsonValue[] = [root];

  for (const step of steps) {
    const next: JsonValue[] = [];
    for (const node of current) {
      if (step.type === 'key') {
        if (isObject(node) && Object.prototype.hasOwnProperty.call(node, step.key)) {
          next.push(node[step.key]);
        }
      } else if (step.type === 'index') {
        if (Array.isArray(node)) {
          const index = step.index < 0 ? node.length + step.index : step.index;
          if (index >= 0 && index < node.length) {
            next.push(node[index]);
          }
        }
      } else if (Array.isArray(node)) {
        next.push(...node);
      } else if (isObject(node)) {
        next.push(...Object.values(node));
      }
    }
    current = next;
  }

  return current;
}
