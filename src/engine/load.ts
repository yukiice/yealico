import {
  buildGalleryPageUrls,
  buildPageUrls,
  executeGallery,
  executeList,
} from './execute';
import { expandUrl } from './placeholder';
import type {
  Diagnostic,
  ExtractItem,
  GalleryResult,
  ListResult,
  PageContext,
  RoutePlan,
  RuleDocument,
} from './types';

/**
 * 可注入的页面加载编排。
 *
 * 不绑定 React Native / fetch / WebView；适配器负责网络、Cookie、字符集和取消。
 * 这一层只负责：构造请求 -> 抓页 -> 执行规则 -> 去重 -> 终止。
 */

export interface RuleRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface RuleResponse {
  url?: string;
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export interface RuleFetcher {
  fetch(request: RuleRequest): Promise<RuleResponse>;
}

export type LoadStopReason =
  | 'complete'
  | 'maxPages'
  | 'duplicate'
  | 'empty'
  | 'noNewItems'
  | 'error';

export interface LoadOptions {
  maxPages?: number;
}

export interface LoadedListResult extends ListResult {
  pages: number;
  urls: string[];
  stopReason: LoadStopReason;
}

export interface LoadedGalleryResult extends GalleryResult {
  pages: number;
  urls: string[];
  stopReason: LoadStopReason;
}

function requestFor(
  url: string,
  context: PageContext,
  rule: RuleDocument,
): { request: RuleRequest; diagnostics: Diagnostic[] } {
  const expanded = expandUrl(url, context, 'request.url');
  const headers: Record<string, string> = { ...(rule.headers ?? {}) };
  if (expanded.body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json';
  }
  return {
    request: {
      url: expanded.url,
      method: expanded.method,
      headers,
      body: expanded.body,
    },
    diagnostics: expanded.diagnostics,
  };
}

async function fetchPage(
  fetcher: RuleFetcher,
  request: RuleRequest,
): Promise<{ response?: RuleResponse; diagnostics: Diagnostic[] }> {
  try {
    const response = await fetcher.fetch(request);
    if (response.status < 200 || response.status >= 400) {
      return {
        diagnostics: [
          {
            fieldPath: 'request',
            code: 'NETWORK_ERROR',
            detail: `HTTP ${response.status} for ${request.url}`,
            severity: 'error',
          },
        ],
      };
    }
    return { response, diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        {
          fieldPath: 'request',
          code: 'NETWORK_ERROR',
          detail: error instanceof Error ? error.message : String(error),
          severity: 'error',
        },
      ],
    };
  }
}

function listKey(item: ExtractItem, index: number): string {
  if (item.idCode) {
    return `id:${item.idCode}`;
  }
  if (item.title || item.cover) {
    return `text:${item.title ?? ''}|${item.cover ?? ''}`;
  }
  return `empty:${index}`;
}

export async function loadListPages(
  rule: RuleDocument,
  plan: RoutePlan,
  fetcher: RuleFetcher,
  context: PageContext,
  options: LoadOptions = {},
): Promise<LoadedListResult> {
  const maxPages = options.maxPages ?? 20;
  if (!rule.indexUrl) {
    return {
      items: [],
      diagnostics: [
        {
          fieldPath: 'indexUrl',
          code: 'MISSING_FIELD',
          detail: 'indexUrl is required for list pagination',
          severity: 'error',
        },
      ],
      pages: 0,
      urls: [],
      stopReason: 'error',
    };
  }

  const pagePlan = buildPageUrls(rule.indexUrl, context, maxPages);
  const diagnostics: Diagnostic[] = [...pagePlan.diagnostics];
  const urls: string[] = [];
  const items: ExtractItem[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let stopReason: LoadStopReason = pagePlan.stopReason ?? 'complete';
  let emptyIndex = 0;

  for (let index = 0; index < pagePlan.urls.length; index += 1) {
    const pageUrl = pagePlan.urls[index];
    const { request, diagnostics: requestDiagnostics } = requestFor(
      pageUrl,
      { ...context, page: index + 1 },
      rule,
    );
    diagnostics.push(...requestDiagnostics);
    if (!request.url) {
      stopReason = 'empty';
      break;
    }

    const fetched = await fetchPage(fetcher, request);
    diagnostics.push(...fetched.diagnostics);
    if (!fetched.response) {
      stopReason = 'error';
      break;
    }
    urls.push(request.url);

    const result = executeList(rule, plan, fetched.response.body, {
      ...context,
      page: index + 1,
      baseUrl: fetched.response.url || request.url,
    });
    diagnostics.push(...result.diagnostics);
    pages += 1;

    let newItems = 0;
    for (const item of result.items) {
      const key = listKey(item, emptyIndex);
      if (key.startsWith('empty:')) {
        emptyIndex += 1;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(item);
      newItems += 1;
    }

    if (newItems === 0 && index > 0) {
      stopReason = 'noNewItems';
      break;
    }
  }

  return { items, diagnostics, pages, urls, stopReason };
}

export async function loadGalleryPages(
  rule: RuleDocument,
  plan: RoutePlan,
  fetcher: RuleFetcher,
  chapterUrlTemplate: string,
  context: PageContext,
  options: LoadOptions = {},
): Promise<LoadedGalleryResult> {
  const maxPages = options.maxPages ?? 200;
  const diagnostics: Diagnostic[] = [];
  const urls: string[] = [];
  const images: string[] = [];
  const seen = new Set<string>();

  const first = buildGalleryPageUrls(chapterUrlTemplate, undefined, context, 1);
  diagnostics.push(...first.diagnostics);
  if (!first.urls[0]) {
    return {
      totalPages: undefined,
      images: [],
      diagnostics: [
        ...diagnostics,
        {
          fieldPath: 'chapterUrl',
          code: 'MISSING_FIELD',
          detail: 'chapterUrl is required for gallery pagination',
          severity: 'error',
        },
      ],
      pages: 0,
      urls: [],
      stopReason: 'error',
    };
  }

  const firstRequest = requestFor(
    first.urls[0],
    { ...context, page: 1 },
    rule,
  );
  diagnostics.push(...firstRequest.diagnostics);
  const firstPage = await fetchPage(fetcher, firstRequest.request);
  diagnostics.push(...firstPage.diagnostics);
  if (!firstPage.response) {
    return {
      totalPages: undefined,
      images: [],
      diagnostics,
      pages: 0,
      urls: [],
      stopReason: 'error',
    };
  }

  const firstResult = executeGallery(rule, plan, firstPage.response.body, {
    ...context,
    page: 1,
    baseUrl: firstPage.response.url || firstRequest.request.url,
  });
  diagnostics.push(...firstResult.diagnostics);
  urls.push(firstRequest.request.url);
  for (const image of firstResult.images) {
    if (!seen.has(image)) {
      seen.add(image);
      images.push(image);
    }
  }

  const pagePlan = buildGalleryPageUrls(
    chapterUrlTemplate,
    firstResult.totalPages,
    context,
    maxPages,
  );
  diagnostics.push(...pagePlan.diagnostics);
  let pages = 1;
  let stopReason: LoadStopReason = pagePlan.stopReason ?? 'complete';

  for (let index = 1; index < pagePlan.urls.length; index += 1) {
    const pageUrl = pagePlan.urls[index];
    const { request, diagnostics: requestDiagnostics } = requestFor(
      pageUrl,
      { ...context, page: index + 1 },
      rule,
    );
    diagnostics.push(...requestDiagnostics);
    const fetched = await fetchPage(fetcher, request);
    diagnostics.push(...fetched.diagnostics);
    if (!fetched.response) {
      stopReason = 'error';
      break;
    }
    urls.push(request.url);

    const result = executeGallery(rule, plan, fetched.response.body, {
      ...context,
      page: index + 1,
      baseUrl: fetched.response.url || request.url,
    });
    diagnostics.push(...result.diagnostics);
    pages += 1;

    let newImages = 0;
    for (const image of result.images) {
      if (seen.has(image)) {
        continue;
      }
      seen.add(image);
      images.push(image);
      newImages += 1;
    }
    if (newImages === 0) {
      stopReason = 'noNewItems';
      break;
    }
  }

  return {
    totalPages: firstResult.totalPages,
    images,
    diagnostics,
    pages,
    urls,
    stopReason:
      stopReason === 'maxPages' &&
      firstResult.totalPages !== undefined &&
      pages >= firstResult.totalPages
        ? 'complete'
        : stopReason,
  };
}
