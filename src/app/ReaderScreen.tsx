import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
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
): Record<string, string> {
  const headers: Record<string, string> = { ...(rule.headers ?? {}) };
  const hasHeader = (name: string): boolean =>
    Object.keys(headers).some(key => key.toLowerCase() === name);
  if (!hasHeader('referer') && domain) {
    headers.Referer = `https://${domain}/`;
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
  const fetcher = useMemo(() => createRuleFetcherForPlan(plan), [plan]);
  const headers = useMemo(() => imageHeaders(rule, domain), [domain, rule]);
  const chapterKey = useMemo(() => progressKeyFor(chapter), [chapter]);
  const chapterUrl = typeof chapter.url === 'string' ? chapter.url : '';
  const restored = useMemo(
    () => (chapterKey ? progress.get(siteId, chapterKey) : undefined),
    [chapterKey, progress, siteId],
  );
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
  const [restoreDone, setRestoreDone] = useState(
    !restored || restored.index <= 0,
  );
  const [notice, setNotice] = useState(
    restored && restored.index > 0
      ? `已恢复上次进度：第 ${restored.index + 1} 张`
      : '',
  );

  const scrollRef = useRef<ScrollView>(null);
  const blocks = useRef<(ImageBlock | undefined)[]>([]);
  const reportedFailures = useRef<Set<number>>(new Set());
  const restoreTarget = useRef<number | null>(
    restored && restored.index > 0 ? restored.index : null,
  );
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

  // 受控预加载：只预热紧邻的几张，失败不打扰阅读。
  useEffect(() => {
    for (const uri of preloadTargets(images, index)) {
      const pending = Image.prefetch(uri);
      if (pending && typeof pending.then === 'function') {
        pending.then(undefined, () => undefined);
      }
    }
  }, [images, index]);

  useEffect(() => {
    loadingMore.current = false;
  }, [images.length, pages]);

  // 恢复：等目标图的布局就绪后滚到它的顶部；位次按图片索引，不保留图内像素偏移。
  useEffect(() => {
    if (restoreDone) {
      return;
    }
    const target = restoreTarget.current;
    if (target === null) {
      setRestoreDone(true);
      return;
    }
    const clamped = Math.min(target, Math.max(0, images.length - 1));
    const block = blocks.current[clamped];
    if (!block) {
      return;
    }
    restoreTarget.current = null;
    scrollRef.current?.scrollTo({ y: Math.max(0, block.y), animated: false });
    setNotice(`已恢复上次进度：第 ${target + 1} 张`);
    setRestoreDone(true);
  }, [images.length, laidOut, restoreDone]);

  // 恢复完成前不写盘，避免把页预算内的临时位次覆盖掉真实进度。
  useEffect(() => {
    if (!restoreDone) {
      return;
    }
    if (!chapterKey || !chapterUrl || images.length === 0) {
      return;
    }
    if (index >= images.length) {
      return;
    }
    progress.save({
      siteId,
      chapterKey,
      chapterUrl,
      chapterTitle:
        typeof chapter.title === 'string' ? chapter.title : undefined,
      index,
      total: images.length,
    });
  }, [
    chapter,
    chapterKey,
    chapterUrl,
    images.length,
    index,
    progress,
    restoreDone,
    siteId,
  ]);

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
    } else {
      const nextIndex = dominantIndex(contentOffset.y, blocks.current);
      setIndex(current => (current === nextIndex ? current : nextIndex));
    }
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 400;
    if (nearBottom) {
      maybeLoadMore();
    }
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
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回详情</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {chapter.title ?? chapter.idCode ?? siteName}
      </Text>
      <Text style={styles.meta}>
        {hasChapterNav ? `第 ${chapterIndex + 1} / ${chapterCount} 章  ·  ` : ''}
        {images.length > 0 ? `${index + 1} / ${images.length} 图` : '暂无图片'}
        {`  ·  已载 ${pages} 页`}
        {totalPages ? ` / ${totalPages}` : ''}
      </Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {loading ? (
        <Text style={styles.info}>正在加载章节图片…</Text>
      ) : null}
      {!loading && error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && images.length === 0 ? (
        <Text style={styles.info}>章节没有图片</Text>
      ) : null}

      {images.length > 0 ? (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          onScrollBeginDrag={() => {
            if (notice) {
              setNotice('');
            }
          }}
          scrollEventThrottle={32}
          onContentSizeChange={() => setLaidOut(current => current + 1)}>
          {images.map((uri, position) => (
            <View
              key={`${position}:${uri}`}
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
                onLoad={event => handleImageLoad(uri, event)}
                onError={() => markFailed(position, uri)}
              />
              {failed[position] ? (
                <View style={styles.blockError}>
                  <Text style={styles.error}>这一张加载失败</Text>
                  <Pressable
                    onPress={() => retryImage(position)}
                    style={styles.button}>
                    <Text style={styles.buttonText}>重试这一张</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.controls}>
        {hasChapterNav ? (
          <Pressable
            onPress={() => onSelectChapter?.(chapterIndex - 1)}
            disabled={!hasPrevChapter}
            style={[styles.button, !hasPrevChapter && styles.buttonDisabled]}>
            <Text style={styles.buttonText}>‹ 上一章</Text>
          </Pressable>
        ) : null}
        {moreBudget > 0 ? (
          <Pressable onPress={() => setBudget(moreBudget)} style={styles.button}>
            <Text style={styles.buttonText}>
              继续加载（{pages}/{totalPages} 页）
            </Text>
          </Pressable>
        ) : null}
        {hasChapterNav ? (
          <Pressable
            onPress={() => onSelectChapter?.(chapterIndex + 1)}
            disabled={!hasNextChapter || chapterHasMorePages}
            style={[
              styles.button,
              (!hasNextChapter || chapterHasMorePages) && styles.buttonDisabled,
            ]}>
            <Text style={styles.buttonText}>下一章 ›</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setRetryToken(token => token + 1)}
          style={styles.button}>
          <Text style={styles.buttonText}>重新加载</Text>
        </Pressable>
      </View>
      {chapterHasMorePages ? (
        <Text style={styles.notice}>本章还有未加载页，点「继续加载」</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    marginBottom: 6,
  },
  backText: {
    color: '#93c5fd',
    fontSize: 13,
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  notice: {
    color: '#93c5fd',
    fontSize: 12,
    marginBottom: 8,
  },
  info: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 8,
  },
  scroll: {
    flex: 1,
    backgroundColor: '#0b1220',
    borderRadius: 6,
  },
  scrollContent: {
    paddingBottom: 12,
  },
  block: {
    width: '100%',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
  },
  blockError: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  button: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginHorizontal: 4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#e2e8f0',
    fontSize: 12,
  },
});
