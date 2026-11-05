import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { expandUrl, loadDetail } from '../engine';
import type {
  ChapterItem,
  ExtractItem,
  RoutePlan,
  RuleDocument,
  DetailResult,
} from '../engine';
import { errorText } from './diagnostics';
import type { DebugSession } from './debugReport';
import { contentState } from './presentation';
import { progressKeyFor } from './readingProgress';
import type { ReadingProgressRepository } from './readingProgress';
import { ReaderScreen } from './ReaderScreen';
import { createRuleFetcherForPlan } from './ruleFetcherForPlan';
import { BottomNav } from './BottomNav';
import type { BottomTab } from './BottomNav';
import { lightTheme as theme } from './theme';

/** 详情页短时缓存：mangacopy 等站点对频率敏感，重复进入同一作品不重复请求。 */
const DETAIL_CACHE_TTL = 10 * 60 * 1000;
const detailCache = new Map<string, { at: number; result: DetailResult }>();

export function detailUrlFor(
  rule: RuleDocument,
  item: ExtractItem,
  domain: string,
): string | undefined {
  if (!rule.detailUrl || !item.idCode) {
    return undefined;
  }
  return expandUrl(
    rule.detailUrl,
    {
      baseUrl: `https://${domain}/`,
      idCode: item.idCode,
      domain,
    },
    'detailUrl',
  ).url;
}

export function chapterMetaText(
  progress: ReadingProgressRepository,
  siteId: string,
  chapter: ChapterItem,
): string {
  const key = progressKeyFor(chapter);
  const entry = key ? progress.get(siteId, key) : undefined;
  if (entry) {
    const total = entry.total ? ` / ${entry.total}` : '';
    return `已读 ${entry.index + 1}${total} 张`;
  }
  return `阅读 · ${chapter.idCode ?? ''}`;
}

/**
 * 章节选择器的过滤：空查询返回全部索引，否则按标题/idCode 做大小写不敏感的子串匹配。
 * 返回原数组下标，保证选择后进入的章节与详情页一致。
 */
export function filterChapters(
  chapters: ChapterItem[],
  query: string,
): number[] {
  const text = query.trim().toLowerCase();
  if (!text) {
    return chapters.map((_chapter, index) => index);
  }
  const matched: number[] = [];
  chapters.forEach((chapter, index) => {
    const label = `${chapter.title ?? ''} ${chapter.idCode ?? ''}`.toLowerCase();
    if (label.includes(text)) {
      matched.push(index);
    }
  });
  return matched;
}

function asText(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value);
}

export function DetailScreen({
  siteName,
  siteId,
  domain,
  rule,
  plan,
  item,
  progress,
  debug,
  onBack,
  onNavigate,
}: {
  siteName: string;
  siteId: string;
  domain: string;
  rule: RuleDocument;
  plan: RoutePlan;
  item: ExtractItem;
  progress: ReadingProgressRepository;
  debug: DebugSession;
  onBack: () => void;
  onNavigate?: (tab: BottomTab) => void;
}): React.JSX.Element {
  const fetcher = useMemo(() => createRuleFetcherForPlan(plan), [plan]);
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');
  const [tab, setTab] = useState<'chapters' | 'browse'>('browse');
  const [reloadToken, setReloadToken] = useState(0);
  const detailUrl = detailUrlFor(rule, item, domain);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetail(null);

    if (!detailUrl) {
      setError('规则缺少 detailUrl 或列表项 idCode');
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = `${siteId}:${item.idCode ?? detailUrl}`;
    const cached = detailCache.get(cacheKey);
    if (reloadToken === 0 && cached && Date.now() - cached.at < DETAIL_CACHE_TTL) {
      setDetail(cached.result);
      const message = errorText(cached.result.diagnostics);
      if (message) {
        setError(message);
      }
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    loadDetail(rule, plan, fetcher, detailUrl, {
      baseUrl: detailUrl,
      domain,
    })
      .then(result => {
        if (cancelled) {
          return;
        }
        detailCache.set(cacheKey, { at: Date.now(), result });
        setDetail(result);
        debug.record({
          stage: 'detail',
          label: result.fields.title ?? item.title,
          counts: {
            chapters: result.chapters.length,
            pictures: result.pictures.length,
            urls: result.urls.length,
          },
          diagnostics: result.diagnostics,
          urls: result.urls,
        });
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
    debug,
    detailUrl,
    domain,
    fetcher,
    item,
    plan,
    reloadToken,
    rule,
    siteId,
  ]);

  const chapters = detail?.chapters ?? [];
  const activeChapter =
    chapterIndex === null ? undefined : chapters[chapterIndex];

  if (activeChapter && chapterIndex !== null) {
    return (
      <ReaderScreen
        key={chapterIndex}
        siteName={siteName}
        siteId={siteId}
        domain={domain}
        rule={rule}
        plan={plan}
        chapter={activeChapter}
        chapters={chapters}
        chapterIndex={chapterIndex}
        onSelectChapter={setChapterIndex}
        progress={progress}
        debug={debug}
        onBack={() => setChapterIndex(null)}
      />
    );
  }

  const openChapter = (index: number): void => {
    setShowChapterPicker(false);
    setChapterQuery('');
    setChapterIndex(index);
  };

  const chapterRow = (
    entry: ChapterItem,
    index: number,
  ): React.JSX.Element => (
    <Pressable
      key={entry.idCode ?? entry.url ?? `${index}`}
      onPress={() => openChapter(index)}
      disabled={typeof entry.url !== 'string' || !entry.url}
      style={styles.chapterRow}>
      <Text style={styles.chapterTitle}>
        {entry.title ?? entry.idCode ?? `章节 ${index + 1}`}
      </Text>
      <Text style={styles.chapterMeta}>
        {typeof entry.url === 'string' && entry.url
          ? chapterMetaText(progress, siteId, entry)
          : '缺少章节地址'}
      </Text>
    </Pressable>
  );

  if (showChapterPicker) {
    const matched = filterChapters(chapters, chapterQuery);
    return (
      <View style={styles.root}>
        <Pressable
          onPress={() => setShowChapterPicker(false)}
          style={styles.backButton}>
          <Text style={styles.backText}>← 返回详情</Text>
        </Pressable>
        <Text style={styles.pickerTitle}>章节 ({chapters.length})</Text>
        <TextInput
          testID="chapter-filter"
          value={chapterQuery}
          onChangeText={setChapterQuery}
          placeholder="搜索章节标题"
          placeholderTextColor={theme.textMuted}
          style={styles.search}
        />
        <Text style={styles.meta}>匹配 {matched.length} 章</Text>
        {matched.length === 0 ? (
          <Text style={styles.info}>没有匹配的章节</Text>
        ) : (
          <FlatList
            data={matched}
            keyExtractor={index => `${index}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: matchedIndex }) =>
              chapterRow(chapters[matchedIndex], matchedIndex)
            }
          />
        )}
      </View>
    );
  }

  const title = asText(detail?.fields.title) ?? item.title ?? siteName;
  const cover = asText(detail?.fields.cover) ?? item.cover;
  const author = asText(detail?.fields.author);
  const desc = asText(detail?.fields.desc) ?? asText(detail?.fields.description);
  const tag = asText(detail?.fields.tag) ?? asText(detail?.fields.tags);
  const detailState = contentState(detail ? 1 : 0, error);

  const refresh = (): void => {
    const cacheKey = `${siteId}:${item.idCode ?? detailUrl ?? ''}`;
    detailCache.delete(cacheKey);
    setReloadToken(token => token + 1);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.coverWrap}>
          {cover ? (
            <Image
              source={{ uri: cover }}
              style={styles.cover}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.cover, styles.coverEmpty]} />
          )}
          <View style={styles.topBar}>
            <Pressable onPress={onBack} style={styles.circleButton} hitSlop={6}>
              <Text style={styles.circleText}>‹</Text>
            </Pressable>
            <Pressable onPress={refresh} style={styles.circleButton} hitSlop={6}>
              <Text style={styles.circleText}>↻</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          {author ? <Text style={styles.author}>作者：{author}</Text> : null}

          <View style={styles.pills}>
            <Pressable
              testID="detail-tab-chapters"
              onPress={() => setTab('chapters')}
              style={[
                styles.pill,
                tab === 'chapters' && styles.pillActive,
              ]}>
              <Text
                style={[
                  styles.pillText,
                  tab === 'chapters' && styles.pillTextActive,
                ]}>
                章节
              </Text>
            </Pressable>
            <Pressable
              testID="detail-tab-browse"
              onPress={() => setTab('browse')}
              style={[styles.pill, tab === 'browse' && styles.pillActive]}>
              <Text
                style={[
                  styles.pillText,
                  tab === 'browse' && styles.pillTextActive,
                ]}>
                浏览
              </Text>
            </Pressable>
          </View>

          {loading ? <Text style={styles.info}>正在加载详情…</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!loading && detailState === 'empty' ? (
            <Text style={styles.info}>详情为空</Text>
          ) : null}

          {tab === 'browse' ? (
            <View>
              {desc ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>简介</Text>
                  <Text style={styles.desc}>{desc}</Text>
                </View>
              ) : null}
              {tag ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>标签</Text>
                  <View style={styles.tagWrap}>
                    <Text style={styles.tag}>{tag}</Text>
                  </View>
                </View>
              ) : null}
              {!desc && !tag && !loading ? (
                <Text style={styles.info}>暂无简介</Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.section}>
              {chapters.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>
                    章节 ({chapters.length})
                  </Text>
                  {chapters.slice(0, 30).map(chapterRow)}
                  {chapters.length > 30 ? (
                    <Pressable
                      testID="chapter-picker-open"
                      onPress={() => setShowChapterPicker(true)}
                      style={styles.moreButton}>
                      <Text style={styles.moreText}>
                        查看全部 {chapters.length} 章
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={styles.info}>没有章节</Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <BottomNav
        active="discover"
        onChange={next => {
          onNavigate?.(next);
          if (!onNavigate) {
            onBack();
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingBottom: 120,
  },
  coverWrap: {
    height: 300,
    backgroundColor: theme.surface,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  coverEmpty: {
    backgroundColor: theme.surface,
  },
  topBar: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  circleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  circleText: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 20,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  author: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  pills: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  pill: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: theme.accent,
  },
  pillText: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  section: {
    marginTop: 22,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  desc: {
    color: theme.text,
    fontSize: 13,
    lineHeight: 21,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    color: theme.text,
    backgroundColor: theme.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    overflow: 'hidden',
  },
  chapterRow: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 13,
  },
  chapterTitle: {
    color: theme.text,
    fontSize: 14,
  },
  chapterMeta: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  moreButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  moreText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  info: {
    color: theme.textMuted,
    fontSize: 13,
    marginTop: 14,
  },
  error: {
    color: theme.danger,
    fontSize: 12,
    marginTop: 14,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  backText: {
    color: theme.accent,
    fontSize: 13,
  },
  pickerTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 16,
  },
  meta: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  search: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    color: theme.text,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    fontSize: 13,
  },
});
