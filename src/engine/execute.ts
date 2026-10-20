import { parseDocument } from 'htmlparser2';
import type { AnyNode } from 'domhandler';

import { UnsupportedJsonPathError } from './jsonpath';
import { normalizeSelector } from './plan';
import { evaluateSelector, resolveUrl, selectNodes } from './selector';
import { expandUrl } from './placeholder';
import type {
  Diagnostic,
  ChapterItem,
  DetailResult,
  ExtractItem,
  GalleryResult,
  JsonValue,
  ListResult,
  PageContext,
  PageUrlResult,
  RoutePlan,
  RuleDocument,
  SelectorSpec,
} from './types';

/**
 * P1 执行器：只覆盖静态 ListRule / GalleryRule。
 *
 * 不做的部分：
 * - WebView / 登录 / 分页循环。
 * - DetailRule 的章节与图片二级链路。
 * - 这些在 P2/P3/P4 按 RoutePlan 的能力标记逐步加入。
 */

interface ParsedInput {
  root: AnyNode | JsonValue;
  json?: JsonValue;
}

function parseInput(content: string): ParsedInput {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed) as JsonValue;
      return { root: json, json: json };
    } catch {
      // 不是合法 JSON，继续按 HTML 处理。
    }
  }
  return { root: parseDocument(content) };
}

function numericField(field: string): boolean {
  return (
    field === 'totalImages' ||
    field === 'totalPages' ||
    field === 'coverWidth' ||
    field === 'coverHeight'
  );
}

const URL_FIELDS = new Set([
  'cover',
  'largeImage',
  'image',
  'thumbnail',
  'url',
  'link',
  'photoAlbumLink',
  'secondLevelPageUrl',
  'Video',
  'video',
  'nextPageUrl',
]);

function coerce(field: string, value: string): string | number {
  if (!numericField(field)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function blockingDiagnostics(plan: RoutePlan): Diagnostic[] {
  return plan.unsupported.filter(
    item =>
      item.code === 'NEEDS_WEBVIEW' ||
      item.code === 'NEEDS_LOGIN' ||
      item.code === 'NEEDS_CONSENT',
  );
}

function evaluateFields(
  fields: Record<string, unknown>,
  context: {
    root: AnyNode | JsonValue;
    current: AnyNode | JsonValue;
    json?: JsonValue;
    baseUrl: string;
    domain?: string;
  },
  fieldPathPrefix: string,
  skip: Set<string>,
): { item: ExtractItem; diagnostics: Diagnostic[] } {
  const item: ExtractItem = {};
  const diagnostics: Diagnostic[] = [];

  for (const [field, rawSpec] of Object.entries(fields)) {
    if (skip.has(field)) {
      continue;
    }
    const spec = normalizeSelector(rawSpec);
    if (!spec) {
      diagnostics.push({
        fieldPath: `${fieldPathPrefix}.${field}`,
        code: 'INVALID_RULE',
        detail: 'selector must be a string or object',
        severity: 'error',
      });
      continue;
    }
    const result = evaluateSelector(
      spec,
      {
        root: context.root,
        current: context.current,
        jsonRoot: context.json,
        baseUrl: context.baseUrl,
        domain: context.domain,
      },
      `${fieldPathPrefix}.${field}`,
    );
    diagnostics.push(...result.diagnostics);
    const resolvedValue =
      result.value && URL_FIELDS.has(field)
        ? resolveUrl(result.value, context.baseUrl)
        : result.value;
    item[field] = coerce(field, resolvedValue);
  }

  return { item, diagnostics };
}

export function executeList(
  rule: RuleDocument,
  plan: RoutePlan,
  content: string,
  context: PageContext,
): ListResult {
  const blocked = blockingDiagnostics(plan);
  if (blocked.length > 0) {
    return { items: [], diagnostics: blocked };
  }

  const indexRule = rule.indexRule;
  if (!indexRule || typeof indexRule !== 'object') {
    return {
      items: [],
      diagnostics: [
        {
          fieldPath: 'indexRule',
          code: 'MISSING_FIELD',
          detail: 'indexRule is required for ListRule',
          severity: 'error',
        },
      ],
    };
  }

  const parsed = parseInput(content);
  const diagnostics: Diagnostic[] = [];

  if (indexRule.text !== undefined) {
    const spec = normalizeSelector(indexRule.text);
    if (!spec) {
      diagnostics.push({
        fieldPath: 'indexRule.text',
        code: 'INVALID_RULE',
        detail: 'text must be a selector',
        severity: 'error',
      });
      return { items: [], diagnostics };
    }
    const result = evaluateSelector(
      spec,
      {
        root: parsed.root,
        current: parsed.root,
        jsonRoot: parsed.json,
        baseUrl: context.baseUrl,
      },
      'indexRule.text',
    );
    diagnostics.push(...result.diagnostics);
    return {
      items: result.value ? [{ title: result.value }] : [],
      diagnostics,
    };
  }

  const itemSpec = normalizeSelector(indexRule.item);
  if (!itemSpec) {
    return {
      items: [],
      diagnostics: [
        {
          fieldPath: 'indexRule.item',
          code: 'MISSING_FIELD',
          detail: 'item is required for ListRule',
          severity: 'error',
        },
      ],
    };
  }

  let nodes: Array<AnyNode | JsonValue>;
  try {
    nodes = selectNodes(itemSpec.selector, {
      root: parsed.root,
      current: parsed.root,
      jsonRoot: parsed.json,
      baseUrl: context.baseUrl,
    });
  } catch (error) {
    return {
      items: [],
      diagnostics: [
        {
          fieldPath: 'indexRule.item',
          code:
            error instanceof UnsupportedJsonPathError
              ? 'UNSUPPORTED_JSONPATH'
              : 'INVALID_RULE',
          detail: error instanceof Error ? error.message : String(error),
          severity: 'error',
        },
      ],
    };
  }

  const fields = { ...indexRule } as Record<string, unknown>;
  delete fields.item;
  delete fields.text;
  delete fields.name;
  delete fields.index;

  const items: ExtractItem[] = [];
  for (const node of nodes) {
    const { item, diagnostics: fieldDiagnostics } = evaluateFields(
      fields,
      {
        root: node,
        current: node,
        json: parsed.json,
        baseUrl: context.baseUrl,
        domain: context.domain,
      },
      'indexRule',
      new Set(),
    );
    diagnostics.push(...fieldDiagnostics);
    items.push(item);
  }

  if (items.length === 0) {
    diagnostics.push({
      fieldPath: 'indexRule.item',
      code: 'EMPTY_RESULT',
      detail: 'item selector returned no nodes',
      severity: 'warning',
    });
  }

  return { items, diagnostics };
}

export function executeGallery(
  rule: RuleDocument,
  plan: RoutePlan,
  content: string,
  context: PageContext,
): GalleryResult {
  const blocked = blockingDiagnostics(plan);
  if (blocked.length > 0) {
    return { images: [], diagnostics: blocked };
  }

  const galleryRule = rule.galleryRule;
  if (!galleryRule || typeof galleryRule !== 'object') {
    return {
      images: [],
      diagnostics: [
        {
          fieldPath: 'galleryRule',
          code: 'MISSING_FIELD',
          detail: 'galleryRule is required for GalleryRule',
          severity: 'error',
        },
      ],
    };
  }

  const parsed = parseInput(content);
  const diagnostics: Diagnostic[] = [];
  let totalPages: number | undefined;

  if (galleryRule.totalPages !== undefined) {
    const spec = normalizeSelector(galleryRule.totalPages);
    if (!spec) {
      diagnostics.push({
        fieldPath: 'galleryRule.totalPages',
        code: 'INVALID_RULE',
        detail: 'totalPages must be a selector',
        severity: 'error',
      });
    } else {
      const result = evaluateSelector(
        spec,
        {
          root: parsed.root,
          current: parsed.root,
          jsonRoot: parsed.json,
          baseUrl: context.baseUrl,
        },
        'galleryRule.totalPages',
      );
      diagnostics.push(...result.diagnostics);
      const parsedNumber = Number(result.value);
      totalPages = Number.isFinite(parsedNumber) ? parsedNumber : undefined;
    }
  }

  const itemSpec = normalizeSelector(galleryRule.item);
  if (!itemSpec) {
    diagnostics.push({
      fieldPath: 'galleryRule.item',
      code: 'MISSING_FIELD',
      detail: 'item is required for GalleryRule',
      severity: 'error',
    });
    return { totalPages, images: [], diagnostics };
  }

  const imageSpec = normalizeSelector(galleryRule.image);
  if (!imageSpec) {
    diagnostics.push({
      fieldPath: 'galleryRule.image',
      code: 'MISSING_FIELD',
      detail: 'image is required for GalleryRule',
      severity: 'error',
    });
    return { totalPages, images: [], diagnostics };
  }

  let nodes: Array<AnyNode | JsonValue>;
  try {
    nodes = selectNodes(itemSpec.selector, {
      root: parsed.root,
      current: parsed.root,
      jsonRoot: parsed.json,
      baseUrl: context.baseUrl,
    });
  } catch (error) {
    return {
      totalPages,
      images: [],
      diagnostics: [
        ...diagnostics,
        {
          fieldPath: 'galleryRule.item',
          code:
            error instanceof UnsupportedJsonPathError
              ? 'UNSUPPORTED_JSONPATH'
              : 'INVALID_RULE',
          detail: error instanceof Error ? error.message : String(error),
          severity: 'error',
        },
      ],
    };
  }

  const images: string[] = [];
  for (const node of nodes) {
    const result = evaluateSelector(
      imageSpec,
      {
        root: node,
        current: node,
        jsonRoot: parsed.json,
        baseUrl: context.baseUrl,
        domain: context.domain,
      },
      'galleryRule.image',
    );
    diagnostics.push(...result.diagnostics);
    if (result.value) {
      images.push(resolveUrl(result.value, context.baseUrl));
    }
  }

  return { totalPages, images, diagnostics };
}

export type { SelectorSpec };

const DETAIL_NESTED_KEYS = new Set([
  'chapterRule',
  'pictureRule',
  'tagRule',
  'commentRule',
  'videoRule',
  'photoAlbumLink',
  'name',
  'index',
]);

export function executeDetail(
  rule: RuleDocument,
  plan: RoutePlan,
  content: string,
  context: PageContext,
): DetailResult {
  const blocked = blockingDiagnostics(plan);
  if (blocked.length > 0) {
    return { fields: {}, chapters: [], pictures: [], diagnostics: blocked };
  }

  const detailRule = rule.detailRule;
  if (!detailRule || typeof detailRule !== 'object') {
    return {
      fields: {},
      chapters: [],
      pictures: [],
      diagnostics: [
        {
          fieldPath: 'detailRule',
          code: 'MISSING_FIELD',
          detail: 'detailRule is required for DetailRule',
          severity: 'error',
        },
      ],
    };
  }

  const parsed = parseInput(content);
  const diagnostics: Diagnostic[] = [];
  const fieldsToExtract: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detailRule)) {
    if (!DETAIL_NESTED_KEYS.has(key)) {
      fieldsToExtract[key] = value;
    }
  }

  const { item: fields, diagnostics: fieldDiagnostics } = evaluateFields(
    fieldsToExtract,
    {
      root: parsed.root,
      current: parsed.root,
      json: parsed.json,
      baseUrl: context.baseUrl,
      domain: context.domain,
    },
    'detailRule',
    new Set(),
  );
  diagnostics.push(...fieldDiagnostics);

  const chapters: ChapterItem[] = [];
  const chapterRule = detailRule.chapterRule;
  if (chapterRule && typeof chapterRule === 'object') {
    const chapterFields = { ...(chapterRule as Record<string, unknown>) };
    delete chapterFields.item;
    delete chapterFields.name;
    delete chapterFields.index;
    const itemSpec = normalizeSelector(
      (chapterRule as Record<string, unknown>).item,
    );
    if (!itemSpec) {
      diagnostics.push({
        fieldPath: 'detailRule.chapterRule.item',
        code: 'MISSING_FIELD',
        detail: 'chapterRule.item is required',
        severity: 'error',
      });
    } else {
      let nodes: Array<AnyNode | JsonValue> = [];
      try {
        nodes = selectNodes(itemSpec.selector, {
          root: parsed.root,
          current: parsed.root,
          jsonRoot: parsed.json,
          baseUrl: context.baseUrl,
          domain: context.domain,
        });
      } catch (error) {
        diagnostics.push({
          fieldPath: 'detailRule.chapterRule.item',
          code:
            error instanceof UnsupportedJsonPathError
              ? 'UNSUPPORTED_JSONPATH'
              : 'INVALID_RULE',
          detail: error instanceof Error ? error.message : String(error),
          severity: 'error',
        });
      }

      for (const node of nodes) {
        const result = evaluateFields(
          chapterFields,
          {
            root: node,
            current: node,
            json: parsed.json,
            baseUrl: context.baseUrl,
            domain: context.domain,
          },
          'detailRule.chapterRule',
          new Set(),
        );
        diagnostics.push(...result.diagnostics);
        const chapter: ChapterItem = { ...result.item };
        if (typeof chapter.url === 'string' && chapter.url) {
          chapter.url = resolveUrl(chapter.url, context.baseUrl);
        }
        chapters.push(chapter);
      }
    }
  }

  const pictures: string[] = [];
  const pictureRule = detailRule.pictureRule;
  if (pictureRule && typeof pictureRule === 'object') {
    const picture = pictureRule as Record<string, unknown>;
    if (picture.link !== undefined) {
      diagnostics.push({
        fieldPath: 'detailRule.pictureRule.link',
        code: 'UNSUPPORTED_FEATURE',
        detail: 'second-level picture pages are not implemented in P2',
        severity: 'warning',
      });
    }
    const itemSpec = normalizeSelector(picture.item);
    const urlSpec = normalizeSelector(picture.url);
    if (!itemSpec || !urlSpec) {
      diagnostics.push({
        fieldPath: 'detailRule.pictureRule',
        code: 'MISSING_FIELD',
        detail: 'pictureRule.item and pictureRule.url are required',
        severity: 'error',
      });
    } else {
      let nodes: Array<AnyNode | JsonValue> = [];
      try {
        nodes = selectNodes(itemSpec.selector, {
          root: parsed.root,
          current: parsed.root,
          jsonRoot: parsed.json,
          baseUrl: context.baseUrl,
          domain: context.domain,
        });
      } catch (error) {
        diagnostics.push({
          fieldPath: 'detailRule.pictureRule.item',
          code:
            error instanceof UnsupportedJsonPathError
              ? 'UNSUPPORTED_JSONPATH'
              : 'INVALID_RULE',
          detail: error instanceof Error ? error.message : String(error),
          severity: 'error',
        });
      }
      for (const node of nodes) {
        const result = evaluateSelector(
          urlSpec,
          {
            root: node,
            current: node,
            jsonRoot: parsed.json,
            baseUrl: context.baseUrl,
            domain: context.domain,
          },
          'detailRule.pictureRule.url',
        );
        diagnostics.push(...result.diagnostics);
        if (result.value) {
          pictures.push(resolveUrl(result.value, context.baseUrl));
        }
      }
    }
  }

  return { fields, chapters, pictures, diagnostics };
}

/**
 * 按页码展开模板，并做重复/空 URL/上限终止。
 * 调用方仍应负责“无新增内容”的业务级终止。
 */
export function buildPageUrls(
  template: string,
  context: PageContext,
  maxPages = 20,
): PageUrlResult {
  const urls: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const limit = Math.max(1, Math.min(Math.floor(maxPages) || 1, 200));
  let stopReason: PageUrlResult['stopReason'];

  for (let page = 1; page <= limit; page += 1) {
    const expanded = expandUrl(template, { ...context, page }, 'pageUrl');
    diagnostics.push(...expanded.diagnostics);
    if (!expanded.url) {
      stopReason = 'empty';
      break;
    }
    if (urls.includes(expanded.url)) {
      stopReason = 'duplicate';
      break;
    }
    urls.push(expanded.url);
  }

  if (!stopReason && urls.length >= limit) {
    stopReason = 'maxPages';
  }

  return { urls, diagnostics, stopReason };
}

export function buildGalleryPageUrls(
  chapterUrl: string,
  totalPages: number | undefined,
  context: PageContext,
  maxPages = 200,
): PageUrlResult {
  const limit = totalPages && totalPages > 0 ? Math.min(totalPages, maxPages) : 1;
  return buildPageUrls(chapterUrl, context, limit);
}
