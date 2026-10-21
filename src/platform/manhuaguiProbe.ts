import { buildRoutePlan, loadDetail, loadGalleryPages, toRuleDocument } from '../engine';
import type { Diagnostic, ExtractedYealicoSite } from '../engine';
import type { SelftestResult } from '../engine/selftest';
import { MANHUAGUI_RULE_JSON } from '../engine/real-rules.generated';
import { createWebViewRuleFetcher } from './webviewFetcher';
import type { WebViewRendererLike } from './webviewFetcher';
import { selectAll } from 'css-select';
import type { AnyNode } from 'domhandler';
import { getOuterHTML } from 'domutils';
import { parseDocument } from 'htmlparser2';

const MANHUAGUI_DOMAIN = 'www.manhuagui.com';
const MANHUAGUI_DETAIL_URL = 'https://www.manhuagui.com/comic/1128/';
const MANHUAGUI_GALLERY_SELECTOR =
  '#mangaBox img.mangaFile, #manga>img';

/** 分页相关候选选择器。页面改版时先跑探针看命中数，再改规则。 */
const DOM_PROBES: Array<[string, string]> = [
  ['img', 'img'],
  ['mangaBox', '#mangaBox'],
  ['mangaFile', '#mangaBox img.mangaFile'],
  ['legacyImg', '#manga>img'],
  ['mangaPage', '.manga-page'],
  ['select', 'select'],
  ['option', 'option'],
  ['pageLink', 'a[href*="#p="]'],
  ['pageClass', '[class*="page"]'],
];

/**
 * 统计章节页 DOM 的分页候选结构，用于定位规则选择器漂移。
 *
 * 只输出命中数与几个片段，不回传整页 HTML。
 */
export function describeGalleryDom(body: string): string {
  const doc = parseDocument(body);
  const counts = DOM_PROBES.map(([label, selector]) => {
    let count = 0;
    try {
      count = selectAll(selector, doc).length;
    } catch {
      count = -1;
    }
    return `${label}=${count}`;
  });
  let samples: string[] = [];
  try {
    const sampleSelectors = ['select', '#pagination', '[class*="page"]'];
    samples = sampleSelectors.flatMap(selector =>
      selectAll(selector, doc)
        .slice(0, 1)
        .map((node: AnyNode) =>
          getOuterHTML(node).replace(/\s+/g, ' ').slice(0, 160),
        ),
    );
  } catch {
    samples = [];
  }
  return [...counts, ...samples].join(' | ');
}

function errorText(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter(item => item.severity === 'error');
  return errors.length === 0
    ? 'none'
    : errors
        .slice(0, 4)
        .map(
          item =>
            `${item.code}:${item.fieldPath}${
              item.detail ? `(${item.detail})` : ''
            }`,
        )
        .join(', ');
}

/**
 * 漫画柜公开页在线探针。
 *
 * 只取详情章节列表和第一页图库 DOM，不下载图片、不批量翻页。
 * 需要原生 WebView 执行详情页 JS；普通 fetch 不满足 jsNeededDetail。
 */
export async function runManhuaguiProbe(
  renderer: WebViewRendererLike,
): Promise<SelftestResult[]> {
  const rule = toRuleDocument(
    MANHUAGUI_RULE_JSON as unknown as ExtractedYealicoSite,
  );
  const galleryRule = rule.galleryRule as
    | Record<string, unknown>
    | undefined;
  // 2026-10 站点改版：当前章节页把图片放在 #mangaBox img.mangaFile；
  // 原规则的 #manga>img 只在旧/移动布局生效。探针保留两者，避免误判为规则全错。
  const probeRule =
    galleryRule === undefined
      ? rule
      : {
          ...rule,
          galleryRule: {
            ...galleryRule,
            image: {
              selector: MANHUAGUI_GALLERY_SELECTOR,
              function: 'attr',
              param: 'src',
            },
          },
        };
  const plan = buildRoutePlan(probeRule);
  const fetcher = createWebViewRuleFetcher(renderer);
  const context = {
    baseUrl: MANHUAGUI_DETAIL_URL,
    domain: MANHUAGUI_DOMAIN,
  };
  const detail = await loadDetail(
    probeRule,
    plan,
    fetcher,
    MANHUAGUI_DETAIL_URL,
    context,
  );
  const chapter = detail.chapters.find(item => item.idCode && item.url);
  const gallery = chapter
    ? await loadGalleryPages(
        probeRule,
        plan,
        fetcher,
        chapter.url ?? '',
        context,
        { maxPages: 1 },
      )
    : undefined;
  const galleryDiagnostics = gallery?.diagnostics ?? [];
  const galleryTotalPages =
    gallery?.totalPages && gallery.totalPages > 0
      ? gallery.totalPages
      : 'unknown';
  let domStats = 'chapter URL missing';
  if (chapter?.url) {
    try {
      const rendered = await renderer.render(chapter.url, {
        timeoutMs: 20_000,
      });
      domStats = describeGalleryDom(rendered.body);
    } catch (error) {
      domStats = `render failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  return [
    {
      name: 'manhuagui: detail page',
      ok: Boolean(detail.fields.title || chapter),
      detail: `urls=${detail.urls.length}, title=${
        detail.fields.title ?? 'none'
      }`,
    },
    {
      name: 'manhuagui: chapter list',
      ok: detail.chapters.length > 0,
      detail: `chapters=${detail.chapters.length}, first=${
        chapter?.title ?? 'none'
      }`,
    },
    {
      name: 'manhuagui: chapter URL',
      ok: Boolean(chapter?.url),
      detail: chapter?.url ?? 'none',
    },
    {
      name: 'manhuagui: gallery page',
      ok: Boolean(gallery && gallery.images.length > 0),
      detail: `images=${gallery?.images.length ?? 0}, totalPages=${galleryTotalPages}, errors=${errorText(
        galleryDiagnostics,
      )}`,
    },
    {
      name: 'manhuagui: gallery DOM stats',
      ok: domStats.startsWith('img='),
      detail: domStats,
    },
    {
      name: 'manhuagui: no error diagnostics',
      ok:
        errorText(detail.diagnostics) === 'none' &&
        errorText(galleryDiagnostics) === 'none',
      detail: `detail=${errorText(detail.diagnostics)}; gallery=${errorText(
        galleryDiagnostics,
      )}`,
    },
  ];
}
