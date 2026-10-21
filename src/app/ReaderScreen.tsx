import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadGalleryPages } from '../engine';
import type {
  ChapterItem,
  RoutePlan,
  RuleDocument,
} from '../engine';
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

/**
 * 图片请求头：沿用规则头，缺 Referer 时补一个站点根地址。
 *
 * 图床普遍按 Referer 防盗链，缺省比留空更接近浏览器行为。
 */
export function imageHeaders(
  rule: RuleDocument,
  domain: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...(rule.headers ?? {}) };
  const hasReferer = Object.keys(headers).some(
    key => key.toLowerCase() === 'referer',
  );
  if (!hasReferer && domain) {
    headers.Referer = `https://${domain}/`;
  }
  return headers;
}

export function ReaderScreen({
  siteName,
  siteId,
  domain,
  rule,
  plan,
  chapter,
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
  const [budget, setBudget] = useState(INITIAL_PAGE_BUDGET);
  const [retryToken, setRetryToken] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [pages, setPages] = useState(0);
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(() => Math.max(0, restored?.index ?? 0));
  const [imageToken, setImageToken] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [notice, setNotice] = useState(
    restored && restored.index > 0
      ? `已恢复上次进度：第 ${restored.index + 1} 张`
      : '',
  );
  // 待恢复的目标位次。页预算可能还没拉够，到位前不写盘。
  const restoreTarget = useRef<number | null>(
    restored && restored.index > 0 ? restored.index : null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setImageFailed(false);

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

  // 恢复位次：图片够多才落位，避免受页预算限制时把位置改小。
  useEffect(() => {
    const target = restoreTarget.current;
    if (target === null || images.length === 0) {
      return;
    }
    const clamped = Math.min(target, images.length - 1);
    setIndex(clamped);
    if (clamped === target) {
      restoreTarget.current = null;
    }
  }, [images.length]);

  // 只在用户真正翻页后写盘；恢复期间不覆盖已有进度。
  useEffect(() => {
    if (!chapterKey || !chapterUrl || images.length === 0) {
      return;
    }
    if (restoreTarget.current !== null || index >= images.length) {
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
  }, [chapter, chapterKey, chapterUrl, images.length, index, progress, siteId]);

  const goTo = (next: number): void => {
    restoreTarget.current = null;
    setNotice('');
    setIndex(next);
  };

  const currentUri = images[index];
  const moreBudget = canLoadMorePages(pages, totalPages)
    ? nextPageBudget(pages, totalPages ?? pages)
    : 0;

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回详情</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {chapter.title ?? chapter.idCode ?? siteName}
      </Text>
      <Text style={styles.meta}>
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
        <>
          <View style={styles.stage}>
            {currentUri ? (
              <Image
                key={`${index}-${imageToken}`}
                source={{ uri: currentUri, headers }}
                style={styles.image}
                resizeMode="contain"
                onLoad={() => setImageFailed(false)}
                onError={() => setImageFailed(true)}
              />
            ) : null}
            {imageFailed ? (
              <View style={styles.overlay}>
                <Text style={styles.error}>这一张加载失败</Text>
                <Pressable
                  onPress={() => {
                    setImageFailed(false);
                    setImageToken(token => token + 1);
                  }}
                  style={styles.button}>
                  <Text style={styles.buttonText}>重试这一张</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.controls}>
            <Pressable
              onPress={() => goTo(Math.max(0, index - 1))}
              disabled={index <= 0}
              style={[styles.button, index <= 0 && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>上一张</Text>
            </Pressable>
            <Text style={styles.counter}>{index + 1}</Text>
            <Pressable
              onPress={() => goTo(Math.min(images.length - 1, index + 1))}
              disabled={index >= images.length - 1}
              style={[
                styles.button,
                index >= images.length - 1 && styles.buttonDisabled,
              ]}>
              <Text style={styles.buttonText}>下一张</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <View style={styles.controls}>
        {moreBudget > 0 ? (
          <Pressable onPress={() => setBudget(moreBudget)} style={styles.button}>
            <Text style={styles.buttonText}>
              继续加载（{pages}/{totalPages} 页）
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setRetryToken(token => token + 1)}
          style={styles.button}>
          <Text style={styles.buttonText}>重新加载</Text>
        </Pressable>
      </View>
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
  stage: {
    flex: 1,
    minHeight: 260,
    backgroundColor: '#0b1220',
    borderRadius: 6,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    flex: 1,
    width: '100%',
  },
  overlay: {
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
  counter: {
    color: '#e2e8f0',
    fontSize: 13,
    minWidth: 34,
    textAlign: 'center',
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
