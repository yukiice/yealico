import type { RuleFetcher, RuleRequest, RuleResponse } from '../engine/load';

/**
 * Android/RN fetch 适配器。
 *
 * 引擎只依赖 RuleFetcher；这一层负责把 RuleRequest 转成 fetch init，
 * 并处理超时、响应文本和响应头。Cookie/字符集/图片加载仍由后续适配器扩展。
 */

export interface FetchResponseLike {
  status: number;
  url?: string;
  headers?: unknown;
  text(): Promise<string>;
}

export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
  credentials?: string;
}

export type FetchLike = (
  url: string,
  init?: FetchInitLike,
) => Promise<FetchResponseLike>;

export interface FetchRuleFetcherOptions {
  fetchImpl?: FetchLike;
  /** 默认 15s；单次 RuleRequest.timeoutMs 可覆盖。 */
  timeoutMs?: number;
  /** RN fetch 默认携带 Cookie；需要匿名请求时传 omit。 */
  credentials?: string;
}

/** 默认浏览器请求头：站点常按 UA / Accept 返回不同页面，缺省时用桌面浏览器形态。 */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

/**
 * 合并默认浏览器头与规则头；规则显式给出的同名头优先（大小写不敏感）。
 */
export function withBrowserHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...BROWSER_HEADERS };
  if (!headers) {
    return merged;
  }
  for (const [key, value] of Object.entries(headers)) {
    const existing = Object.keys(merged).find(
      name => name.toLowerCase() === key.toLowerCase(),
    );
    if (existing) {
      delete merged[existing];
    }
    merged[key] = value;
  }
  return merged;
}

interface AbortControllerLike {
  signal: unknown;
  abort(): void;
}

interface AbortControllerConstructor {
  new (): AbortControllerLike;
}

function defaultFetch(): FetchLike {
  const implementation = (globalThis as {
    fetch?: (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;
  }).fetch;
  if (!implementation) {
    throw new Error('global fetch is not available in this runtime');
  }
  return (url, init) => implementation(url, init);
}

function headersToObject(headers: unknown): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const result: Record<string, string> = {};
  const withForEach = headers as {
    forEach?: (callback: (value: string, key: string) => void) => void;
  };
  if (typeof withForEach.forEach === 'function') {
    withForEach.forEach((value, key) => {
      result[key] = value;
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createFetchRuleFetcher(
  options: FetchRuleFetcherOptions = {},
): RuleFetcher {
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const defaultTimeout = options.timeoutMs ?? 15_000;
  const credentials = options.credentials ?? 'include';

  return {
    async fetch(request: RuleRequest): Promise<RuleResponse> {
      const timeoutMs = request.timeoutMs ?? defaultTimeout;
      const AbortControllerImpl = (globalThis as {
        AbortController?: AbortControllerConstructor;
      }).AbortController;
      const controller = AbortControllerImpl ? new AbortControllerImpl() : undefined;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (controller && timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }

      try {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: withBrowserHeaders(request.headers),
          ...(request.body !== undefined ? { body: request.body } : {}),
          ...(controller ? { signal: controller.signal } : {}),
          credentials,
        });
        return {
          url: response.url || request.url,
          status: response.status,
          headers: headersToObject(response.headers),
          body: await response.text(),
        };
      } catch (error) {
        if (timedOut) {
          throw new Error(`request timed out after ${timeoutMs}ms: ${request.url}`);
        }
        throw error;
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    },
  };
}
