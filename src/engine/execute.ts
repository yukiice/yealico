import { parseDocument } from 'htmlparser2';
import type { AnyNode } from 'domhandler';

import { UnsupportedJsonPathError } from './jsonpath';
import { normalizePageSelector, normalizeSelector } from './plan';
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
  PicturePageResult,
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

function blockingDiagnostics(
  plan: RoutePlan,
  allowWebView = false,
): Diagnostic[] {
  return plan.unsupported.filter(
    item =>
      (!allowWebView && item.code === 'NEEDS_WEBVIEW') ||
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

export interface GalleryExecuteOptions {
  /** 由调用方抓取 GalleryRule.secondLevelPageUrl 后的页面内容。 */
  secondaryContent?: string;
  secondaryUrl?: string;
  allowWebView?: boolean;
}

function extractSecondLevelUrl(
  galleryRule: Record<string, unknown>,
  parsed: ParsedInput,
  context: PageContext,
  diagnostics: Diagnostic[],
): string | undefined {
  if (galleryRule.secondLevelPageUrl === undefined) {
    return undefined;
  }
  const spec = normalizePageSelector(galleryRule.secondLevelPageUrl);
  if (!spec) {
    diagnostics.push({
      fieldPath: 'galleryRule.secondLevelPageUrl',
      code: 'INVALID_RULE',
      detail: 'secondLevelPageUrl must be a selector',
      severity: 'error',
    });
    return undefined;
  }
  const result = evaluateSelector(
    spec,
    {
      root: parsed.root,
      current: parsed.root,
      jsonRoot: parsed.json,
      baseUrl: context.baseUrl,
      domain: context.domain,
    },
    'galleryRule.secondLevelPageUrl',
  );
  diagnostics.push(...result.diagnostics);
  if (!result.value) {
    diagnostics.push({
      fieldPath: 'galleryRule.secondLevelPageUrl',
      code: 'EMPTY_RESULT',
      detail: 'second-level gallery selector returned no URL',
      severity: 'warning',
    });
    return undefined;
  }
  return resolveUrl(result.value, context.baseUrl);
}

export function executeGallery(
  rule: RuleDocument,
  plan: RoutePlan,
  content: string,
  context: PageContext,
  options: GalleryExecuteOptions = {},
): GalleryResult {
  const blocked = blockingDiagnostics(plan, options.allowWebView);
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

  const primary = parseInput(content);
  const diagnostics: Diagnostic[] = [];
  const secondLevelUrl = extractSecondLevelUrl(
    galleryRule as Record<string, unknown>,
    primary,
    context,
    diagnostics,
  );

  if (secondLevelUrl && options.secondaryContent === undefined) {
    return {
      secondLevelUrl,
      images: [],
      diagnostics: [
        ...diagnostics,
        {
          fieldPath: 'galleryRule.secondLevelPageUrl',
          code: 'SECOND_LEVEL_REQUIRED',
          detail: `fetch ${secondLevelUrl} before executing gallery image rules`,
          severity: 'error',
        },
      ],
    };
  }

  const parsed =
    options.secondaryContent !== undefined
      ? parseInput(options.secondaryContent)
      : primary;
  const pageContext: PageContext = {
    ...context,
    baseUrl: options.secondaryUrl || secondLevelUrl || context.baseUrl,
  };
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
          baseUrl: pageContext.baseUrl,
        },
        'galleryRule.totalPages',
      );
      diagnostics.push(...result.diagnostics);
      const parsedNumber = Number(result.value);
      totalPages = Number.isFinite(parsedNumber) ? parsedNumber : undefined;
    }
  }

  const imageSpec = normalizeSelector(galleryRule.image);
  if (!imageSpec) {
    diagnostics.push({
      fieldPath: 'galleryRule.image',
      code: 'MISSING_FIELD',
      detail: 'image is required for GalleryRule',
      severity: 'error',
    });
    return { totalPages, secondLevelUrl, images: [], diagnostics };
  }

  const itemSpec = normalizeSelector(galleryRule.item);
  if (!itemSpec) {
    // 真实规则（漫画柜 1.7）允许 GalleryRule 直接给出 image 集合，
    // 不设置 item。此时 image 的 selector 选出的节点就是图片节点；
    // 没有显式 function/param 时，默认按 src/data-src/data-original 取图。
    let directNodes: Array<AnyNode | JsonValue> = [];
    try {
      directNodes = selectNodes(imageSpec.selector, {
        root: parsed.root,
        current: parsed.root,
        jsonRoot: parsed.json,
        baseUrl: pageContext.baseUrl,
      });
    } catch (error) {
      diagnostics.push({
        fieldPath: 'galleryRule.image',
        code:
          error instanceof UnsupportedJsonPathError
            ? 'UNSUPPORTED_JSONPATH'
            : 'INVALID_RULE',
        detail: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
      return { totalPages, secondLevelUrl, images: [], diagnostics };
    }

    const directSpec: SelectorSpec = {
      ...imageSpec,
      selector: 'this',
      ...(imageSpec.function ? {} : { function: 'attr' }),
      ...(imageSpec.param
        ? {}
        : { param: 'src,data-src,data-original' }),
    };
    const images: string[] = [];
    for (const node of directNodes) {
      const result = evaluateSelector(
        directSpec,
        {
          root: node,
          current: node,
          jsonRoot: parsed.json,
          baseUrl: pageContext.baseUrl,
          domain: context.domain,
        },
        'galleryRule.image',
      );
      diagnostics.push(...result.diagnostics);
      if (result.value) {
        images.push(resolveUrl(result.value, pageContext.baseUrl));
      }
    }
    if (directNodes.length === 0) {
      diagnostics.push({
        fieldPath: 'galleryRule.image',
        code: 'EMPTY_RESULT',
        detail: 'direct image selector returned no nodes',
        severity: 'warning',
      });
    }
    return { totalPages, secondLevelUrl, images, diagnostics };
  }

  let nodes: Array<AnyNode | JsonValue>;
  try {
    nodes = selectNodes(itemSpec.selector, {
      root: parsed.root,
      current: parsed.root,
      jsonRoot: parsed.json,
      baseUrl: pageContext.baseUrl,
    });
  } catch (error) {
    return {
      totalPages,
      secondLevelUrl,
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
        baseUrl: pageContext.baseUrl,
        domain: context.domain,
      },
      'galleryRule.image',
    );
    diagnostics.push(...result.diagnostics);
    if (result.value) {
      images.push(resolveUrl(result.value, pageContext.baseUrl));
    }
  }

  return { totalPages, secondLevelUrl, images, diagnostics };
}

export type { SelectorSpec };

const DETAIL_NESTED_KEYS = new Set([
  'chapterRule',
  'pictureRule',
  'tagRule',
  'commentRule',
  'videoRule',
  'photoAlbumLink',
  'pageReadyMarker',
  'name',
  'index',
]);

export interface DetailExecuteOptions {
  /** 由调用方抓取 DetailRule.photoAlbumLink 后的页面内容。 */
  secondaryContent?: string;
  secondaryUrl?: string;
  allowWebView?: boolean;
}

interface MediaSource extends ParsedInput {
  baseUrl: string;
  domain?: string;
}

function extractPhotoAlbumLink(
  detailRule: Record<string, unknown>,
  parsed: ParsedInput,
  context: PageContext,
  diagnostics: Diagnostic[],
): string | undefined {
  if (detailRule.photoAlbumLink === undefined) {
    return undefined;
  }
  const spec = normalizePageSelector(detailRule.photoAlbumLink);
  if (!spec) {
    diagnostics.push({
      fieldPath: 'detailRule.photoAlbumLink',
      code: 'INVALID_RULE',
      detail: 'photoAlbumLink must be a selector',
      severity: 'error',
    });
    return undefined;
  }
  const result = evaluateSelector(
    spec,
    {
      root: parsed.root,
      current: parsed.root,
      jsonRoot: parsed.json,
      baseUrl: context.baseUrl,
      domain: context.domain,
    },
    'detailRule.photoAlbumLink',
  );
  diagnostics.push(...result.diagnostics);
  if (!result.value) {
    diagnostics.push({
      fieldPath: 'detailRule.photoAlbumLink',
      code: 'EMPTY_RESULT',
      detail: 'photoAlbumLink selector returned no URL',
      severity: 'warning',
    });
    return undefined;
  }
  return resolveUrl(result.value, context.baseUrl);
}

function extractChapters(
  chapterRule: Record<string, unknown>,
  media: MediaSource,
  diagnostics: Diagnostic[],
): ChapterItem[] {
  const chapters: ChapterItem[] = [];
  const chapterFields = { ...chapterRule };
  delete chapterFields.item;
  delete chapterFields.name;
  delete chapterFields.index;
  const itemSpec = normalizeSelector(chapterRule.item);
  if (!itemSpec) {
    diagnostics.push({
      fieldPath: 'detailRule.chapterRule.item',
      code: 'MISSING_FIELD',
      detail: 'chapterRule.item is required',
      severity: 'error',
    });
    return chapters;
  }

  let nodes: Array<AnyNode | JsonValue> = [];
  try {
    nodes = selectNodes(itemSpec.selector, {
      root: media.root,
      current: media.root,
      jsonRoot: media.json,
      baseUrl: media.baseUrl,
      domain: media.domain,
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
    return chapters;
  }

  for (const node of nodes) {
    const result = evaluateFields(
      chapterFields,
      {
        root: node,
        current: node,
        json: media.json,
        baseUrl: media.baseUrl,
        domain: media.domain,
      },
      'detailRule.chapterRule',
      new Set(),
    );
    diagnostics.push(...result.diagnostics);
    const chapter: ChapterItem = { ...result.item };
    if (typeof chapter.url === 'string' && chapter.url) {
      chapter.url = resolveUrl(chapter.url, media.baseUrl);
    }
    chapters.push(chapter);
  }
  return chapters;
}

interface PictureExtraction {
  pictures: string[];
  links: string[];
}

const MAX_DETAIL_IMAGES = 500;

function extractPictures(
  pictureRule: Record<string, unknown>,
  media: MediaSource,
  diagnostics: Diagnostic[],
  fieldPath: string,
  options: {
    fallbackToRoot?: boolean;
    totalImages?: number;
    maxImages?: number;
  } = {},
): PictureExtraction {
  const pictures: string[] = [];
  const links: string[] = [];
  const itemSpec = normalizeSelector(pictureRule.item);
  const urlSpec = normalizeSelector(pictureRule.url);
  const linkSpec = normalizeSelector(pictureRule.link);
  const totalImages =
    options.totalImages && options.totalImages > 0
      ? Math.floor(options.totalImages)
      : undefined;

  if (!urlSpec) {
    diagnostics.push({
      fieldPath: `${fieldPath}.url`,
      code: 'MISSING_FIELD',
      detail: 'pictureRule.url is required',
      severity: 'error',
    });
    return { pictures, links };
  }
  if (pictureRule.link !== undefined && !linkSpec) {
    diagnostics.push({
      fieldPath: `${fieldPath}.link`,
      code: 'INVALID_RULE',
      detail: 'pictureRule.link must be a selector',
      severity: 'error',
    });
    return { pictures, links };
  }
  if (!itemSpec && !options.fallbackToRoot && totalImages === undefined) {
    diagnostics.push({
      fieldPath: `${fieldPath}.item`,
      code: 'MISSING_FIELD',
      detail: 'pictureRule.item is required',
      severity: 'error',
    });
    return { pictures, links };
  }

  let nodes: Array<AnyNode | JsonValue> = [];
  if (itemSpec) {
    try {
      nodes = selectNodes(itemSpec.selector, {
        root: media.root,
        current: media.root,
        jsonRoot: media.json,
        baseUrl: media.baseUrl,
        domain: media.domain,
      });
    } catch (error) {
      diagnostics.push({
        fieldPath: `${fieldPath}.item`,
        code:
          error instanceof UnsupportedJsonPathError
            ? 'UNSUPPORTED_JSONPATH'
            : 'INVALID_RULE',
        detail: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
      return { pictures, links };
    }
  }

  if (nodes.length === 0 && options.fallbackToRoot) {
    nodes = [media.root];
  }
  if (!itemSpec && totalImages !== undefined) {
    nodes = [media.root];
  }

  for (const node of nodes) {
    if (linkSpec) {
      const result = evaluateSelector(
        linkSpec,
        {
          root: node,
          current: node,
          jsonRoot: media.json,
          baseUrl: media.baseUrl,
          domain: media.domain,
        },
        `${fieldPath}.link`,
      );
      diagnostics.push(...result.diagnostics);
      if (result.value) {
        links.push(resolveUrl(result.value, media.baseUrl));
      }
      continue;
    }

    const result = evaluateSelector(
      urlSpec,
      {
        root: node,
        current: node,
        jsonRoot: media.json,
        baseUrl: media.baseUrl,
        domain: media.domain,
      },
      `${fieldPath}.url`,
    );
    diagnostics.push(...result.diagnostics);
    if (result.value) {
      if (result.value.includes('{page')) {
        if (totalImages === undefined) {
          diagnostics.push({
            fieldPath: 'detailRule.totalImages',
            code: 'MISSING_FIELD',
            detail: 'picture URL template contains {page:} but totalImages is missing',
            severity: 'warning',
          });
          continue;
        }

        const limit = Math.min(
          totalImages,
          options.maxImages ?? MAX_DETAIL_IMAGES,
        );
        if (limit < totalImages) {
          diagnostics.push({
            fieldPath: `${fieldPath}.url`,
            code: 'UNSUPPORTED_FEATURE',
            detail: `totalImages ${totalImages} exceeds detail image limit ${limit}`,
            severity: 'warning',
          });
        }
        for (let page = 1; page <= limit; page += 1) {
          const expanded = expandUrl(
            result.value,
            {
              baseUrl: media.baseUrl,
              page,
              domain: media.domain,
            },
            `${fieldPath}.url`,
          );
          diagnostics.push(...expanded.diagnostics);
          if (expanded.url) {
            pictures.push(resolveUrl(expanded.url, media.baseUrl));
          }
        }
      } else {
        pictures.push(resolveUrl(result.value, media.baseUrl));
      }
    }
  }

  return { pictures, links };
}

export function executePicturePage(
  rule: RuleDocument,
  plan: RoutePlan,
  content: string,
  context: PageContext,
  options: DetailExecuteOptions = {},
): PicturePageResult {
  const blocked = blockingDiagnostics(plan, options.allowWebView);
  if (blocked.length > 0) {
    return { pictures: [], diagnostics: blocked };
  }

  const detailRule = rule.detailRule;
  const pictureRule = detailRule?.pictureRule;
  if (!pictureRule || typeof pictureRule !== 'object') {
    return {
      pictures: [],
      diagnostics: [
        {
          fieldPath: 'detailRule.pictureRule',
          code: 'MISSING_FIELD',
          detail: 'pictureRule is required to resolve a picture page',
          severity: 'error',
        },
      ],
    };
  }

  const parsed = parseInput(content);
  const diagnostics: Diagnostic[] = [];
  const result = extractPictures(
    { ...(pictureRule as Record<string, unknown>), link: undefined },
    {
      ...parsed,
      baseUrl: context.baseUrl,
      domain: context.domain,
    },
    diagnostics,
    'detailRule.pictureRule',
    { fallbackToRoot: true },
  );
  return { pictures: result.pictures, diagnostics };
}

export function executeDetail(
  rule: RuleDocument,
  plan: RoutePlan,
  content: string,
  context: PageContext,
  options: DetailExecuteOptions = {},
): DetailResult {
  const blocked = blockingDiagnostics(plan, options.allowWebView);
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

  const photoAlbumUrl = extractPhotoAlbumLink(
    detailRule as Record<string, unknown>,
    parsed,
    context,
    diagnostics,
  );
  if (photoAlbumUrl && options.secondaryContent === undefined) {
    return {
      fields,
      chapters: [],
      pictures: [],
      photoAlbumUrl,
      pictureLinks: [],
      diagnostics: [
        ...diagnostics,
        {
          fieldPath: 'detailRule.photoAlbumLink',
          code: 'SECOND_LEVEL_REQUIRED',
          detail: `fetch ${photoAlbumUrl} before executing chapter/picture rules`,
          severity: 'error',
        },
      ],
    };
  }

  const mediaParsed =
    options.secondaryContent !== undefined
      ? parseInput(options.secondaryContent)
      : parsed;
  const media: MediaSource = {
    ...mediaParsed,
    baseUrl: options.secondaryUrl || photoAlbumUrl || context.baseUrl,
    domain: context.domain,
  };

  const chapters: ChapterItem[] = [];
  const chapterRule = detailRule.chapterRule;
  if (chapterRule && typeof chapterRule === 'object') {
    chapters.push(
      ...extractChapters(
        chapterRule as Record<string, unknown>,
        media,
        diagnostics,
      ),
    );
  }

  let pictureResult: PictureExtraction = { pictures: [], links: [] };
  const pictureRule = detailRule.pictureRule;
  if (pictureRule && typeof pictureRule === 'object') {
    const totalImages = Number(fields.totalImages);
    pictureResult = extractPictures(
      pictureRule as Record<string, unknown>,
      media,
      diagnostics,
      'detailRule.pictureRule',
      {
        totalImages:
          Number.isFinite(totalImages) && totalImages > 0
            ? totalImages
            : undefined,
      },
    );
  }

  return {
    fields,
    chapters,
    pictures: pictureResult.pictures,
    photoAlbumUrl,
    pictureLinks: pictureResult.links,
    diagnostics,
  };
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
