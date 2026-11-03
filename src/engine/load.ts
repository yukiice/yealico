import {
  buildGalleryPageUrls,
  buildPageUrls,
  executeDetail,
  executeGallery,
  executeList,
  executePicturePage,
} from './execute';
import { expandUrl } from './placeholder';
import { normalizeSelector } from './plan';
import type {
  Diagnostic,
  DetailResult,
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
  /** WebView 适配器在返回 body 前等待的 DOM 标记。 */
  waitForSelector?: string;
}

export interface RuleResponse {
  url?: string;
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export interface RuleFetcher {
  fetch(request: RuleRequest): Promise<RuleResponse>;
  /** true 表示适配器可执行 JS，load* 不再把 NEEDS_WEBVIEW 当作阻断。 */
  webview?: boolean;
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

export interface LoadedDetailResult extends DetailResult {
  urls: string[];
  stopReason: LoadStopReason;
}

function requestFor(
  url: string,
  context: PageContext,
  rule: RuleDocument,
  waitForSelector?: string,
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
      ...(waitForSelector ? { waitForSelector } : {}),
    },
    diagnostics: expanded.diagnostics,
  };
}

function waitSelector(value: unknown): string | undefined {
  const selector = normalizeSelector(value)?.selector;
  // WebView 的等待标记必须是 CSS 选择器；JSONPath（$...）无法给 querySelector。
  if (!selector || selector.trim().startsWith('$')) {
    return undefined;
  }
  return selector;
}

/** 解析规则里的 httpHeaders：支持 JSON 字符串或对象，只保留字符串值。 */
function parseHttpHeaders(value: unknown): Record<string, string> | undefined {
  if (typeof value === 'string') {
    try {
      return parseHttpHeaders(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      headers[key] = raw;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
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
          // 带上目标 URL：适配器抛出的原文只有 "Network request failed"，
          // 无法判断是哪个主机不可达。展示层会统一脱敏。
          detail: `${error instanceof Error ? error.message : String(error)}: ${request.url}`,
          severity: 'error',
        },
      ],
    };
  }
}

async function executeGalleryPage(
  rule: RuleDocument,
  plan: RoutePlan,
  fetcher: RuleFetcher,
  request: RuleRequest,
  context: PageContext,
  waitForSelector?: string,
): Promise<{
  result?: GalleryResult;
  urls: string[];
  diagnostics: Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  const urls: string[] = [];
  const fetched = await fetchPage(fetcher, request);
  diagnostics.push(...fetched.diagnostics);
  if (!fetched.response) {
    return { urls, diagnostics };
  }
  urls.push(request.url);

  const firstContext: PageContext = {
    ...context,
    baseUrl: fetched.response.url || request.url,
  };
  const executeOptions = { allowWebView: fetcher.webview === true };
  let result = executeGallery(
    rule,
    plan,
    fetched.response.body,
    firstContext,
    executeOptions,
  );

  if (result.secondLevelUrl) {
    const secondary = requestFor(
      result.secondLevelUrl,
      context,
      rule,
      waitForSelector,
    );
    diagnostics.push(...secondary.diagnostics);
    if (!secondary.request.url) {
      diagnostics.push({
        fieldPath: 'galleryRule.secondLevelPageUrl',
        code: 'MISSING_FIELD',
        detail: 'second-level gallery URL expanded to an empty URL',
        severity: 'error',
      });
      return { urls, diagnostics };
    }

    const secondaryPage = await fetchPage(fetcher, secondary.request);
    diagnostics.push(...secondaryPage.diagnostics);
    if (!secondaryPage.response) {
      return { urls, diagnostics };
    }
    urls.push(secondary.request.url);
    result = executeGallery(
      rule,
      plan,
      fetched.response.body,
      firstContext,
      {
        ...executeOptions,
        secondaryContent: secondaryPage.response.body,
        secondaryUrl: secondaryPage.response.url || secondary.request.url,
      },
    );
  }

  diagnostics.push(...result.diagnostics);
  return { result, urls, diagnostics };
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

    const result = executeList(
      rule,
      plan,
      fetched.response.body,
      {
        ...context,
        page: index + 1,
        baseUrl: fetched.response.url || request.url,
      },
      { allowWebView: fetcher.webview === true },
    );
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

/**
 * 详情页加载：详情 -> photoAlbumLink 二级页 -> pictureRule.link 图片页。
 *
 * 网络请求仍由注入的 fetcher 完成；本函数只负责顺序、去重和错误聚合。
 */
export async function loadDetail(
  rule: RuleDocument,
  plan: RoutePlan,
  fetcher: RuleFetcher,
  detailUrl: string,
  context: PageContext,
  options: LoadOptions = {},
): Promise<LoadedDetailResult> {
  const diagnostics: Diagnostic[] = [];
  const urls: string[] = [];
  const maxLinks = Math.max(
    1,
    Math.min(Math.floor(options.maxPages ?? 200) || 1, 200),
  );

  if (!detailUrl) {
    return {
      fields: {},
      chapters: [],
      pictures: [],
      diagnostics: [
        {
          fieldPath: 'detailUrl',
          code: 'MISSING_FIELD',
          detail: 'detailUrl is required for detail loading',
          severity: 'error',
        },
      ],
      urls,
      stopReason: 'error',
    };
  }

  const allowWebView = fetcher.webview === true;
  const detailChapterRule = rule.detailRule?.chapterRule as
    | Record<string, unknown>
    | undefined;
  const detailPictureRule = rule.detailRule?.pictureRule as
    | Record<string, unknown>
    | undefined;
  const waitForDetail =
    waitSelector(rule.detailRule?.pageReadyMarker) ??
    waitSelector(detailChapterRule?.item) ??
    waitSelector(detailPictureRule?.item);
  const detailRequest = requestFor(
    detailUrl,
    { ...context, page: 1 },
    rule,
    waitForDetail,
  );
  diagnostics.push(...detailRequest.diagnostics);
  const detailPage = await fetchPage(fetcher, detailRequest.request);
  diagnostics.push(...detailPage.diagnostics);
  if (!detailPage.response) {
    return {
      fields: {},
      chapters: [],
      pictures: [],
      diagnostics,
      urls,
      stopReason: 'error',
    };
  }
  urls.push(detailRequest.request.url);

  const detailContext: PageContext = {
    ...context,
    page: 1,
    baseUrl: detailPage.response.url || detailRequest.request.url,
  };
  let result = executeDetail(
    rule,
    plan,
    detailPage.response.body,
    detailContext,
    { allowWebView },
  );

  if (result.photoAlbumUrl) {
    const albumRequest = requestFor(
      result.photoAlbumUrl,
      detailContext,
      rule,
      waitForDetail,
    );
    diagnostics.push(...albumRequest.diagnostics);
    const albumPage = await fetchPage(fetcher, albumRequest.request);
    diagnostics.push(...albumPage.diagnostics);
    if (!albumPage.response) {
      diagnostics.push(...result.diagnostics);
      return { ...result, diagnostics, urls, stopReason: 'error' };
    }
    urls.push(albumRequest.request.url);
    result = executeDetail(
      rule,
      plan,
      detailPage.response.body,
      detailContext,
      {
        allowWebView,
        secondaryContent: albumPage.response.body,
        secondaryUrl: albumPage.response.url || albumRequest.request.url,
      },
    );
  }

  diagnostics.push(...result.diagnostics);
  const pictures = [...result.pictures];
  const seen = new Set(pictures);
  const links = [...new Set(result.pictureLinks ?? [])];
  let stopReason: LoadStopReason = 'complete';

  if (links.length > maxLinks) {
    links.length = maxLinks;
    diagnostics.push({
      fieldPath: 'detailRule.pictureRule.link',
      code: 'UNSUPPORTED_FEATURE',
      detail: `picture link limit reached (${maxLinks})`,
      severity: 'warning',
    });
    stopReason = 'maxPages';
  }

  for (const link of links) {
    const linkRequest = requestFor(
      link,
      { ...context, page: 1 },
      rule,
      waitSelector(detailPictureRule?.url),
    );
    diagnostics.push(...linkRequest.diagnostics);
    const linkPage = await fetchPage(fetcher, linkRequest.request);
    diagnostics.push(...linkPage.diagnostics);
    if (!linkPage.response) {
      stopReason = 'error';
      continue;
    }
    urls.push(linkRequest.request.url);
    const extracted = executePicturePage(
      rule,
      plan,
      linkPage.response.body,
      {
        ...context,
        page: 1,
        baseUrl: linkPage.response.url || linkRequest.request.url,
      },
      { allowWebView },
    );
    diagnostics.push(...extracted.diagnostics);
    for (const picture of extracted.pictures) {
      if (seen.has(picture)) {
        continue;
      }
      seen.add(picture);
      pictures.push(picture);
    }
  }

  return {
    ...result,
    pictures,
    diagnostics,
    urls,
    stopReason,
  };
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
  const galleryRule = rule.galleryRule as Record<string, unknown> | undefined;
  const waitForGallery =
    waitSelector(galleryRule?.pageReadyMarker) ??
    waitSelector(galleryRule?.item) ??
    waitSelector(galleryRule?.image) ??
    waitSelector(galleryRule?.totalPages);
  // galleryRule.httpHeaders 是 Yealico 的图库页请求头（通常是移动 UA）。
  // 它同时用于 WebView 渲染与图片请求，否则站点会返回空壳页面。
  const galleryHeaders = parseHttpHeaders(galleryRule?.httpHeaders);
  const withGalleryHeaders = (request: RuleRequest): RuleRequest =>
    galleryHeaders
      ? { ...request, headers: { ...request.headers, ...galleryHeaders } }
      : request;

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
    waitForGallery,
  );
  diagnostics.push(...firstRequest.diagnostics);
  const firstLoaded = await executeGalleryPage(
    rule,
    plan,
    fetcher,
    withGalleryHeaders(firstRequest.request),
    { ...context, page: 1 },
    waitForGallery,
  );
  diagnostics.push(...firstLoaded.diagnostics);
  if (!firstLoaded.result) {
    return {
      totalPages: undefined,
      images: [],
      diagnostics,
      pages: 0,
      urls: [],
      stopReason: 'error',
    };
  }

  const firstResult = firstLoaded.result;
  urls.push(...firstLoaded.urls);
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
      waitForGallery,
    );
    diagnostics.push(...requestDiagnostics);
    const loaded = await executeGalleryPage(
      rule,
      plan,
      fetcher,
      withGalleryHeaders(request),
      { ...context, page: index + 1 },
      waitForGallery,
    );
    diagnostics.push(...loaded.diagnostics);
    if (!loaded.result) {
      stopReason = 'error';
      break;
    }
    urls.push(...loaded.urls);
    const result = loaded.result;
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
    secondLevelUrl: firstResult.secondLevelUrl,
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
