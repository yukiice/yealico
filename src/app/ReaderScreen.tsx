import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { loadGalleryPages } from '../engine';
import type { ChapterItem, RoutePlan, RuleDocument } from '../engine';
import { errorText } from './diagnostics';
import type { DebugSession } from './debugReport';
import { progressKeyFor } from './readingProgress';
import type { ReadingProgressRepository } from './readingProgress';
import { createRuleFetcherForPlan } from './ruleFetcherForPlan';

/** 首次进入章节只拉这么多页，避免点开就发几十个请求。 */
export const INITIAL_PAGE_BUDGET = 4;
/** 每次“继续加载”追加的页数。 */
export const PAGE_BUDGET_STEP = 4;
/** 当前图之后预热几张。 */
export const PRELOAD_AHEAD = 2;
/** 恢复进度时最多一次拉这么多页，避免长章节一次发几十个请求。 */
export const MAX_RESTORE_BUDGET = 40;
/** 图片实际尺寸未知前的占位宽高比（宽 / 高）。 */
export const DEFAULT_ASPECT_RATIO = 0.7;
/** 工具栏自动隐藏时长。 */
export const CHROME_AUTO_HIDE_MS = 3_000;

export type ReaderTap = 'prev' | 'next' | 'toggle';

/**
 * 沉浸式点击分区：左右 30% 翻页，中间切换工具栏。
 * 宽度未知时一律当作切换，避免误翻页。
 */
export function resolveReaderTap(
  locationX: number,
  width: number,
): ReaderTap {
  if (!Number.isFinite(locationX) || width <= 0) {
    return 'toggle';
  }
  const ratio = locationX / width;
  if (ratio < 0.3) {
    return 'prev';
  }
  if (ratio > 0.7) {
    return 'next';
  }
  return 'toggle';
}

/**
 * 预加载目标：只取当前图之后的若干张，不回头、不越界。
 */
export function preloadTargets(
  images: string[],
  index: number,
  count: number = PRELOAD_AHEAD,
): string[] {
  const ahead = Math.max(0, Math.floor(count));
  if (images.length === 0 || ahead === 0) {
    return [];
  }
  const start = Math.max(0, Math.floor(index) + 1);
  return images.slice(start, start + ahead);
}

/** 已加载页数还没到总数的前提才有“继续加载”可点。 */
export const PRELOAD_WINDOW_AHEAD = 5;
export const PRELOAD_WINDOW_BEHIND = 2;

/**
 * 预加载窗口：当前页前后各取若干张，含当前页。
 *
 * 滚动阅读靠这个窗口拉图，不只预取后面两张，否则快速下接必白屏。
 */
export function preloadWindow(
  images: string[],
  index: number,
  ahead: number = PRELOAD_WINDOW_AHEAD,
  behind: number = PRELOAD_WINDOW_BEHIND,
): string[] {
  if (images.length === 0) {
    return [];
  }
  const current = Math.max(0, Math.min(images.length - 1, Math.floor(index)));
  const start = Math.max(0, current - Math.max(0, Math.floor(behind)));
  const end = Math.min(
    images.length,
    current + Math.max(0, Math.floor(ahead)) + 1,
  );
  return images.slice(start, end);
}

/**
 * 估算未测量页的滚动偏移。
 *
 * 虚拟列表不会挂载远处页面，恢复进度时目标块可能还没 onLayout；
 * 已知块用真实高度，未知块按默认宽高比推。
 */
export function estimateOffset(
  target: number,
  blocks: Array<{ height: number } | undefined>,
  width: number,
): number {
  const fallback = width > 0 ? width / DEFAULT_ASPECT_RATIO : 0;
  let offset = 0;
  for (let position = 0; position < target; position += 1) {
    const block = blocks[position];
    offset += block && block.height > 0 ? block.height : fallback;
  }
  return offset;
}

/** 已加载页数还没到总数的前提才有“继续加载”可点。 */
export function canLoadMorePages(
  pages: number,
  totalPages?: number,
): boolean {
  return (
    typeof totalPages === 'number' && totalPages > 0 && pages < totalPages
  );
}

/** 下一次请求的页预算：从已加载页数往前推，且不超过总页数。 */
export function nextPageBudget(
  pages: number,
  totalPages: number,
  step: number = PAGE_BUDGET_STEP,
): number {
  const current = Math.max(0, Math.floor(pages));
  return Math.min(totalPages, current + Math.max(1, Math.floor(step)));
}

/** 图片请求默认 UA：与站点反爬要求的浏览器形态一致。 */
export const IMAGE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

/**
 * 图片请求头：沿用规则头，缺 Referer / UA / Accept 时补浏览器默认值。
 *
 * 图床普遍按 Referer 和 UA 防盗链；漫画柜站点对缺 UA 的请求直接 403，
 * 图片同域，因此这里统一按浏览器行为补齐。规则显式给出的头优先。
 */
export function imageHeaders(
  rule: RuleDocument,
  domain: string,
  baseUrl?: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...(rule.headers ?? {}) };
  const hasHeader = (name: string): boolean =>
    Object.keys(headers).some(key => key.toLowerCase() === name);
  if (!hasHeader('referer')) {
    // 图床常校验章节页 Referer，而不只是域名根路径。
    const referer =
      baseUrl && /^https?:/i.test(baseUrl)
        ? baseUrl
        : domain
          ? `https://${domain}/`
          : '';
    if (referer) {
      headers.Referer = referer;
    }
  }
  if (!hasHeader('user-agent')) {
    headers['User-Agent'] = IMAGE_USER_AGENT;
  }
  if (!hasHeader('accept')) {
    headers.Accept = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
  }
  return headers;
}

export interface ImageBlock {
  y: number;
  height: number;
}

/**
 * 双页模式的分屏：第一张单独一屏（封面），之后每两张一屏。
 */
export function buildSpreads(images: string[]): string[][] {
  if (images.length === 0) {
    return [];
  }
  const spreads: string[][] = [[images[0]]];
  for (let position = 1; position < images.length; position += 2) {
    spreads.push(images.slice(position, position + 2));
  }
  return spreads;
}

/** 某张图所在的双页屏下标。 */
export function spreadIndexFor(imageIndex: number): number {
  if (imageIndex <= 0) {
    return 0;
  }
  return Math.floor((imageIndex - 1) / 2) + 1;
}

/** 某屏第一张图在原始图片数组里的下标。 */
export function firstImageIndexOfSpread(
  spreads: string[][],
  spreadIndex: number,
): number {
  let count = 0;
  for (let index = 0; index < spreadIndex && index < spreads.length; index += 1) {
    count += spreads[index].length;
  }
  return count;
}

/**
 * 双页模式下的视觉顺序：RTL 时右边先读，所以把屏内图片反转。
 */
export function orderedSpread(images: string[], rtl: boolean): string[] {
  return rtl ? [...images].reverse() : images;
}

/**
 * 连续滚动时判定“当前读到第几张”：取覆盖滚动位置上边缘的那张图。
 *
 * 布局未就绪的图跳过；全部未知时退回第一张有布局的图。
 */
export function dominantIndex(
  offsetY: number,
  blocks: (ImageBlock | undefined)[],
): number {
  const y = Math.max(0, offsetY);
  let last: number | undefined;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }
    last = index;
    if (y < block.y + block.height) {
      return index;
    }
  }
  return last ?? 0;
}

export function ReaderScreen({
  siteName,
  siteId,
  domain,
  rule,
  plan,
  forceWebView,
  cookie,
  onCookies,
  chapter,
  chapters = [],
  chapterIndex = -1,
  onSelectChapter,
  progress,
  debug,
  onBack,
}: {
  siteName: string;
  siteId: string;
  domain: string;
  rule: RuleDocument;
  plan: RoutePlan;
  /** 站点级强制 WebView，见 createRuleFetcherForPlan。 */
  forceWebView?: boolean;
  /** 站点级 Cookie。 */
  cookie?: string;
  /** WebView 渲染后回传的 Cookie。 */
  onCookies?: (cookie: string) => void;
  chapter: ChapterItem;
  /** 当前详情页的完整章节列表，用于跨章连读。 */
  chapters?: ChapterItem[];
  /** 当前章节在列表中的下标；-1 表示不提供章节导航。 */
  chapterIndex?: number;
  onSelectChapter?: (index: number) => void;
  progress: ReadingProgressRepository;
  debug: DebugSession;
  onBack: () => void;
}): React.JSX.Element {
  const fetcher = useMemo(
    () =>
      createRuleFetcherForPlan(plan, {
        forceWebView,
        ...(cookie ? { cookie } : {}),
        ...(onCookies ? { onCookies } : {}),
      }),
    [cookie, forceWebView, onCookies, plan],
  );
  const chapterKey = useMemo(() => progressKeyFor(chapter), [chapter]);
  const chapterUrl = typeof chapter.url === 'string' ? chapter.url : '';
  const headers = useMemo(
    () => imageHeaders(rule, domain, chapterUrl),
    [chapterUrl, domain, rule],
  );
  const restored = useMemo(
    () => (chapterKey ? progress.get(siteId, chapterKey) : undefined),
    [chapterKey, progress, siteId],
  );
  const restoredRatio = restored?.offsetRatio ?? 0;
  // index 0 也可能需要恢复图内位置，不能只看 index。
  const needsRestore =
    restored !== undefined &&
    (restored.index > 0 || (restored.offsetRatio ?? 0) > 0);
  // 恢复点可能在页预算之外；首次加载直接拉到覆盖它，最多 MAX_RESTORE_BUDGET 页。
  const initialBudget = useMemo(() => {
    const target = restored?.index ?? 0;
    return Math.min(
      MAX_RESTORE_BUDGET,
      Math.max(INITIAL_PAGE_BUDGET, target + 1),
    );
  }, [restored]);

  const [budget, setBudget] = useState(initialBudget);
  const [retryToken, setRetryToken] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [pages, setPages] = useState(0);
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(() => Math.max(0, restored?.index ?? 0));
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [tokens, setTokens] = useState<Record<number, number>>({});
  const [laidOut, setLaidOut] = useState(0);
  const [restoreDone, setRestoreDone] = useState(!needsRestore);
  const [notice, setNotice] = useState(
    restored && (restored.index > 0 || (restored.offsetRatio ?? 0) > 0)
      ? `已恢复上次进度：第 ${restored.index + 1} 张`
      : '',
  );
  const [mode, setMode] = useState<'scroll' | 'paged'>('scroll');
  const [rtl, setRtl] = useState(false);
  const [pagedWidth, setPagedWidth] = useState(0);
  const [readerWidth, setReaderWidth] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [pagePill, setPagePill] = useState(false);
  const spreads = useMemo(() => buildSpreads(images), [images]);

  const scrollListRef = useRef<FlatList<string>>(null);
  const pagedRef = useRef<FlatList<string[]>>(null);
  const blocks = useRef<(ImageBlock | undefined)[]>([]);
  const reportedFailures = useRef<Set<number>>(new Set());
  const restoreTarget = useRef<number | null>(
    needsRestore && restored ? restored.index : null,
  );
  const restorePending = useRef(needsRestore);
  const restoreTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const indexRef = useRef(index);
  const offsetRatioRef = useRef(restored?.offsetRatio ?? 0);
  const restoreRatioRef = useRef(restoredRatio);
  const loadingMore = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setFailed({});

    if (!chapterUrl) {
      setImages([]);
      setPages(0);
      setTotalPages(undefined);
      setLoading(false);
      setError('章节缺少图片页地址（chapterRule 未解析出 url）');
      return () => {
        cancelled = true;
      };
    }

    loadGalleryPages(
      rule,
      plan,
      fetcher,
      chapterUrl,
      { baseUrl: chapterUrl, domain, page: 1 },
      { maxPages: budget },
    )
      .then(result => {
        if (cancelled) {
          return;
        }
        setImages(result.images);
        setPages(result.pages);
        setTotalPages(result.totalPages);
        debug.record({
          stage: 'gallery',
          label: chapter.title ?? chapterKey,
          counts: {
            images: result.images.length,
            pages: result.pages,
            ...(result.totalPages === undefined
              ? {}
              : { totalPages: result.totalPages }),
          },
          diagnostics: result.diagnostics,
          urls: result.urls,
        });
        setIndex(current =>
          Math.min(current, Math.max(0, result.images.length - 1)),
        );
        const message = errorText(result.diagnostics);
        if (message) {
          setError(message);
        }
      })
      .catch(cause => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    budget,
    chapter.title,
    chapterKey,
    chapterUrl,
    debug,
    domain,
    fetcher,
    plan,
    retryToken,
    rule,
  ]);

  // 预加载：当前页前后各取几张，并提前量尺寸，减少白屏与布局跳动。
  useEffect(() => {
    for (const uri of preloadWindow(images, index)) {
      const pending = Image.prefetch(uri);
      if (pending && typeof pending.then === 'function') {
        pending.then(undefined, () => undefined);
      }
      Image.getSize(
        uri,
        (width, height) => {
          if (width > 0 && height > 0) {
            const ratio = width / height;
            setAspects(current =>
              current[uri] === ratio ? current : { ...current, [uri]: ratio },
            );
          }
        },
        () => undefined,
      );
    }
  }, [images, index]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // 沉浸模式：工具栏隐藏时收起状态栏，退出阅读时恢复。
  useEffect(() => {
    StatusBar.setHidden(!chromeVisible, 'fade');
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [chromeVisible]);

  // 工具栏自动隐藏；每次翻页重新计时，避免阅读中一闪而过。
  useEffect(() => {
    if (!chromeVisible) {
      return;
    }
    const timer = setTimeout(() => setChromeVisible(false), CHROME_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [chromeVisible, index]);

  // 翻页时短暂显示页码，不常驻。
  useEffect(() => {
    if (images.length === 0) {
      return;
    }
    setPagePill(true);
    const timer = setTimeout(() => setPagePill(false), 1_200);
    return () => clearTimeout(timer);
  }, [images.length, index]);

  useEffect(() => {
    loadingMore.current = false;
  }, [images.length, pages]);

  // 恢复：先按当前布局滚到目标位置，再延迟校正一次，等图片真实高度替换占位高度。
  // 用 ref 管理 pending，避免 setRestoreDone 触发 effect cleanup 把校正定时器清掉。
  useEffect(() => {
    if (!restorePending.current) {
      return;
    }
    const target = restoreTarget.current ?? 0;
    const clamped = Math.min(target, Math.max(0, images.length - 1));
    const block = blocks.current[clamped];
    // 虚拟列表下远处页面可能还没挂载；用估算偏移先落位，再靠下方校正。
    const offset =
      block && block.height > 0
        ? block.y + restoreRatioRef.current * block.height
        : estimateOffset(clamped, blocks.current, readerWidth);
    restorePending.current = false;
    restoreTarget.current = null;
    scrollListRef.current?.scrollToOffset({
      offset: Math.max(0, offset),
      animated: false,
    });
    setNotice(`已恢复上次进度：第 ${target + 1} 张`);
    setRestoreDone(true);
    const timer = setTimeout(() => {
      const late = blocks.current[clamped];
      if (late && late.height > 0) {
        scrollListRef.current?.scrollToOffset({
          offset: Math.max(0, late.y + restoreRatioRef.current * late.height),
          animated: false,
        });
      }
    }, 300);
    restoreTimers.current.push(timer);
  }, [images, laidOut, readerWidth]);

  useEffect(() => {
    const timers = restoreTimers.current;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  /**
   * 只在滚动结束、返回或切章时写盘；滚动过程中只更新 ref，避免每帧重写整库。
   * 恢复完成前不写，避免把页预算内的临时位次覆盖掉真实进度。
   */
  const persistProgress = (): void => {
    if (!restoreDone) {
      return;
    }
    if (!chapterKey || !chapterUrl || images.length === 0) {
      return;
    }
    const currentIndex = indexRef.current;
    if (currentIndex >= images.length) {
      return;
    }
    progress.save({
      siteId,
      chapterKey,
      chapterUrl,
      chapterTitle:
        typeof chapter.title === 'string' ? chapter.title : undefined,
      index: currentIndex,
      offsetRatio: offsetRatioRef.current,
      total: images.length,
    });
  };

  const moreBudget = canLoadMorePages(pages, totalPages)
    ? nextPageBudget(pages, totalPages ?? pages)
    : 0;
  const chapterCount = chapters.length;
  const hasChapterNav = chapterIndex >= 0 && chapterCount > 0;
  const hasPrevChapter = hasChapterNav && chapterIndex > 0;
  const chapterHasMorePages = canLoadMorePages(pages, totalPages);
  const hasNextChapter = hasChapterNav && chapterIndex < chapterCount - 1;

  const maybeLoadMore = (): void => {
    if (loadingMore.current || loading) {
      return;
    }
    if (!canLoadMorePages(pages, totalPages)) {
      return;
    }
    loadingMore.current = true;
    setBudget(nextPageBudget(pages, totalPages ?? pages));
  };

  const handlePagedScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): void => {
    if (pagedWidth <= 0 || spreads.length === 0) {
      return;
    }
    const next = Math.max(
      0,
      Math.min(
        spreads.length - 1,
        Math.round(event.nativeEvent.contentOffset.x / pagedWidth),
      ),
    );
    const first = firstImageIndexOfSpread(spreads, next);
    indexRef.current = first;
    offsetRatioRef.current = 0;
    setIndex(current => (current === first ? current : first));
    persistProgress();
    if (next >= spreads.length - 2) {
      maybeLoadMore();
    }
  };

  const toggleMode = (): void => {
    persistProgress();
    if (mode === 'scroll') {
      setMode('paged');
      return;
    }
    // 切回连续滚动：从当前图片顶部重新落位，双页没有图内比例。
    restoreRatioRef.current = 0;
    restoreTarget.current = indexRef.current;
    restorePending.current = true;
    setRestoreDone(false);
    setMode('scroll');
    setLaidOut(current => current + 1);
  };

  const handleScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atBottom =
      images.length > 0 &&
      contentOffset.y + layoutMeasurement.height >=
        contentSize.height - 32;
    if (atBottom) {
      // 最后一张很高时，视口上缘可能还停在上一张；到底就认最后一张。
      setIndex(images.length - 1);
      offsetRatioRef.current = 1;
    } else {
      const nextIndex = dominantIndex(contentOffset.y, blocks.current);
      const block = blocks.current[nextIndex];
      if (block && block.height > 0) {
        offsetRatioRef.current = Math.min(
          1,
          Math.max(0, (contentOffset.y - block.y) / block.height),
        );
      }
      setIndex(current => (current === nextIndex ? current : nextIndex));
    }
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 400;
    if (nearBottom) {
      maybeLoadMore();
    }
  };

  /** 跳到指定图片：滚动模式滚到该块，双页模式滚到所在跨页。 */
  const goToImage = (target: number): void => {
    if (images.length === 0) {
      return;
    }
    const next = Math.max(0, Math.min(images.length - 1, target));
    setIndex(next);
    indexRef.current = next;
    if (mode === 'paged') {
      offsetRatioRef.current = 0;
      pagedRef.current?.scrollToIndex({
        index: spreadIndexFor(next),
        animated: true,
      });
      return;
    }
    const block = blocks.current[next];
    if (block) {
      scrollListRef.current?.scrollToOffset({
        offset: Math.max(0, block.y),
        animated: true,
      });
    } else {
      scrollListRef.current?.scrollToOffset({
        offset: Math.max(0, estimateOffset(next, blocks.current, readerWidth)),
        animated: true,
      });
    }
  };

  /**
   * 沉浸式点击：左右三分之一翻页，中间切换工具栏。
   * 页首/页尾的翻页会跨章或触发继续加载，避免用户只能找按钮。
   */
  const handleTap = (locationX: number): void => {
    const width = mode === 'paged' ? pagedWidth : readerWidth;
    const zone = resolveReaderTap(locationX, width);
    if (zone === 'toggle') {
      setChromeVisible(value => !value);
      return;
    }
    if (zone === 'prev') {
      if (index > 0) {
        goToImage(index - 1);
        return;
      }
      if (hasPrevChapter) {
        persistProgress();
        onSelectChapter?.(chapterIndex - 1);
        return;
      }
      setChromeVisible(true);
      return;
    }
    if (index < images.length - 1) {
      goToImage(index + 1);
      return;
    }
    if (chapterHasMorePages) {
      maybeLoadMore();
      return;
    }
    if (hasNextChapter) {
      persistProgress();
      onSelectChapter?.(chapterIndex + 1);
      return;
    }
    setChromeVisible(true);
  };

  const handleImageLoad = (uri: string, event: {
    nativeEvent: unknown;
  }): void => {
    const native = event.nativeEvent as {
      source?: { width?: number; height?: number };
    };
    const width = native.source?.width ?? 0;
    const height = native.source?.height ?? 0;
    if (width <= 0 || height <= 0) {
      return;
    }
    const ratio = width / height;
    setAspects(current =>
      current[uri] === ratio ? current : { ...current, [uri]: ratio },
    );
  };

  const retryImage = (position: number): void => {
    setFailed(current => {
      const next = { ...current };
      delete next[position];
      return next;
    });
    setTokens(current => ({
      ...current,
      [position]: (current[position] ?? 0) + 1,
    }));
  };

  // 图床失败只上报前几条，避免把调试页刷满；URL 用于判断是域名、签名还是请求头问题。
  const markFailed = (position: number, uri: string): void => {
    setFailed(current =>
      current[position] ? current : { ...current, [position]: true },
    );
    if (reportedFailures.current.has(position) || reportedFailures.current.size >= 5) {
      return;
    }
    reportedFailures.current.add(position);
    debug.record({
      stage: 'gallery',
      label: `图片加载失败 #${position + 1}`,
      counts: { image: position + 1 },
      diagnostics: [],
      urls: [uri],
    });
  };

  return (
    <View
      style={styles.root}
      onLayout={event => setReaderWidth(event.nativeEvent.layout.width)}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <Pressable
        style={styles.content}
        onPress={event => handleTap(event.nativeEvent.locationX)}>
      {images.length > 0 && mode === 'scroll' ? (
        <FlatList
          ref={scrollListRef}
          data={images}
          keyExtractor={(uri, position) => `${position}:${uri}`}
          extraData={`${failed ? Object.keys(failed).length : 0}:${
            tokens ? Object.keys(tokens).length : 0
          }`}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          onScrollBeginDrag={() => {
            if (notice) {
              setNotice('');
            }
          }}
          onScrollEndDrag={persistProgress}
          onMomentumScrollEnd={persistProgress}
          scrollEventThrottle={32}
          onContentSizeChange={() => setLaidOut(current => current + 1)}
          // 虚拟列表：只挂视口附近的几页，避免一次把整章图片全解到内存。
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews
          renderItem={({ item: uri, index: position }) => (
            <View
              style={styles.block}
              onLayout={event => {
                const { y, height } = event.nativeEvent.layout;
                const previous = blocks.current[position];
                if (previous && previous.y === y && previous.height === height) {
                  return;
                }
                blocks.current[position] = { y, height };
                setLaidOut(current => current + 1);
              }}>
              <Image
                key={tokens[position] ?? 0}
                source={{ uri, headers }}
                style={[
                  styles.image,
                  { aspectRatio: aspects[uri] ?? DEFAULT_ASPECT_RATIO },
                ]}
                resizeMode="contain"
                resizeMethod="resize"
                fadeDuration={0}
                onLoad={event => handleImageLoad(uri, event)}
                onError={() => markFailed(position, uri)}
              />
              {failed[position] ? (
                <View style={styles.blockError}>
                  <Text style={styles.error}>这一张加载失败</Text>
                  <Pressable
                    onPress={() => retryImage(position)}
                    style={styles.imageRetry}>
                    <Text style={styles.imageRetryText}>重试这一张</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
        />
      ) : null}

      {images.length > 0 && mode === 'paged' ? (
        <View
          style={styles.paged}
          onLayout={event => setPagedWidth(event.nativeEvent.layout.width)}>
          {pagedWidth > 0 ? (
            <FlatList
              key={rtl ? 'rtl' : 'ltr'}
              data={spreads}
              horizontal
              inverted={rtl}
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_item, position) => `${position}`}
              getItemLayout={(_data, position) => ({
                length: pagedWidth,
                offset: pagedWidth * position,
                index: position,
              })}
              initialScrollIndex={Math.min(
                spreadIndexFor(index),
                Math.max(0, spreads.length - 1),
              )}
              onMomentumScrollEnd={handlePagedScroll}
              renderItem={({ item, index: screenIndex }) => {
                const first = firstImageIndexOfSpread(spreads, screenIndex);
                const ordered = item
                  .map((uri, offset) => ({ uri, original: first + offset }))
                  .sort((a, b) =>
                    rtl ? b.original - a.original : a.original - b.original,
                  );
                return (
                  <View style={[styles.spread, { width: pagedWidth }]}>
                    {ordered.map(({ uri, original }) => (
                      <Image
                        key={`${screenIndex}:${original}:${uri}`}
                        source={{ uri, headers }}
                        style={styles.spreadImage}
                        resizeMode="contain"
                        onError={() => markFailed(original, uri)}
                      />
                    ))}
                  </View>
                );
              }}
            />
          ) : null}
        </View>
      ) : null}

        {loading ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator color="#f5f5f7" />
            <Text style={styles.info}>正在加载章节图片…</Text>
          </View>
        ) : null}
        {!loading && images.length === 0 ? (
          <View style={styles.center} pointerEvents="none">
            <Text style={styles.emptyTitle}>
              {error ? '章节加载失败' : '章节没有图片'}
            </Text>
            {error ? (
              <Text style={styles.errorCompact} numberOfLines={4}>
                {error}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {images.length > 1 ? (
        <View style={styles.progressTrack} pointerEvents="none">
          <View
            style={[
              styles.progressFill,
              { width: `${((index + 1) / images.length) * 100}%` },
            ]}
          />
        </View>
      ) : null}

      {chromeVisible ? (
        <>
          <View style={styles.topBar}>
            <Pressable
              onPress={() => {
                persistProgress();
                onBack();
              }}
              hitSlop={10}
              style={styles.backButton}>
              <Text style={styles.backText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.topTexts}>
              <Text style={styles.title} numberOfLines={1}>
                {chapter.title ?? chapter.idCode ?? siteName}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {hasChapterNav
                  ? `第 ${chapterIndex + 1} / ${chapterCount} 章`
                  : siteName}
                {images.length > 0 ? ` · ${index + 1} / ${images.length}` : ''}
                {` · 已载 ${pages} 页`}
                {totalPages ? ` / ${totalPages}` : ''}
              </Text>
            </View>
          </View>

          {error && images.length > 0 ? (
            <View style={styles.errorBar} pointerEvents="none">
              <Text style={styles.errorBarText} numberOfLines={3}>
                {error}
              </Text>
            </View>
          ) : null}

          {notice ? (
            <View style={styles.noticeBar} pointerEvents="none">
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <View style={styles.bottomBar}>
            {hasChapterNav ? (
              <Pressable
                onPress={() => {
                  persistProgress();
                  onSelectChapter?.(chapterIndex - 1);
                }}
                disabled={!hasPrevChapter}
                style={[styles.pill, !hasPrevChapter && styles.pillDisabled]}>
                <Text style={styles.pillText}>上一章</Text>
              </Pressable>
            ) : null}
            {moreBudget > 0 ? (
              <Pressable
                onPress={() => setBudget(moreBudget)}
                style={styles.pillAccent}>
                <Text style={styles.pillAccentText}>
                  继续加载 {pages}/{totalPages}
                </Text>
              </Pressable>
            ) : null}
            {mode === 'paged' ? (
              <Pressable
                onPress={() => setRtl(value => !value)}
                style={styles.pill}>
                <Text style={styles.pillText}>
                  {rtl ? '左到右' : '右到左'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={toggleMode} style={styles.pill}>
              <Text style={styles.pillText}>
                {mode === 'scroll' ? '双页' : '连续'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setRetryToken(token => token + 1)}
              style={styles.pill}>
              <Text style={styles.pillText}>重载</Text>
            </Pressable>
            {hasChapterNav ? (
              <Pressable
                onPress={() => {
                  persistProgress();
                  onSelectChapter?.(chapterIndex + 1);
                }}
                disabled={!hasNextChapter || chapterHasMorePages}
                style={[
                  styles.pill,
                  (!hasNextChapter || chapterHasMorePages) &&
                    styles.pillDisabled,
                ]}>
                <Text style={styles.pillText}>下一章</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      {!chromeVisible && pagePill && images.length > 0 ? (
        <View style={styles.pagePill} pointerEvents="none">
          <Text style={styles.pagePillText}>
            {index + 1} / {images.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    paddingBottom: 0,
  },
  block: {
    width: '100%',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
  },
  paged: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  spread: {
    flex: 1,
    flexDirection: 'row',
  },
  spreadImage: {
    flex: 1,
    height: '100%',
  },
  blockError: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 8,
  },
  imageRetry: {
    marginTop: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  imageRetryText: {
    color: '#f5f5f7',
    fontSize: 12,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#f5f5f7',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorCompact: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  info: {
    color: '#cbd5e1',
    fontSize: 13,
    marginTop: 10,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  progressFill: {
    height: 2,
    backgroundColor: '#F06D8C',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  topTexts: {
    flex: 1,
    marginLeft: 12,
  },
  backButton: {
    paddingVertical: 4,
  },
  backText: {
    color: '#f5f5f7',
    fontSize: 14,
  },
  title: {
    color: '#f5f5f7',
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 3,
  },
  errorBar: {
    position: 'absolute',
    top: 72,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorBarText: {
    color: '#fca5a5',
    fontSize: 10,
    lineHeight: 14,
  },
  noticeBar: {
    position: 'absolute',
    bottom: 82,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  noticeText: {
    color: '#e5e7eb',
    fontSize: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  pill: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillDisabled: {
    opacity: 0.35,
  },
  pillText: {
    color: '#f5f5f7',
    fontSize: 12,
  },
  pillAccent: {
    backgroundColor: '#F06D8C',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillAccentText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  pagePill: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pagePillText: {
    color: '#f5f5f7',
    fontSize: 12,
  },
});
