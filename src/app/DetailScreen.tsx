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
}): React.JSX.Element {
  const fetcher = useMemo(() => createRuleFetcherForPlan(plan), [plan]);
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');
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
    if (cached && Date.now() - cached.at < DETAIL_CACHE_TTL) {
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
  }, [debug, detailUrl, domain, fetcher, item, plan, rule, siteId]);

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
        <Text style={styles.title}>章节 ({chapters.length})</Text>
        <TextInput
          testID="chapter-filter"
          value={chapterQuery}
          onChangeText={setChapterQuery}
          placeholder="搜索章节标题"
          placeholderTextColor="#64748b"
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

  const title = detail?.fields.title ?? item.title ?? siteName;
  const cover = detail?.fields.cover ?? item.cover;
  const pictures = detail?.pictures ?? [];
  const detailState = contentState(detail ? 1 : 0, error);

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回列表</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{domain}</Text>

      {loading ? (
        <Text style={styles.info}>正在加载详情…</Text>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {detailState === 'empty' ? (
            <Text style={styles.info}>详情为空</Text>
          ) : null}
          {detailState === 'content' ? (
            <ScrollView contentContainerStyle={styles.content}>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
          ) : null}
          {detail?.fields.author ? (
            <Text style={styles.meta}>作者：{detail.fields.author}</Text>
          ) : null}
          {detail?.fields.desc ? (
            <Text style={styles.desc}>{detail.fields.desc}</Text>
          ) : null}

          {chapters.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>章节 ({chapters.length})</Text>
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
            </View>
          )}

          {pictures.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>图片 ({pictures.length})</Text>
              {pictures.slice(0, 20).map(picture => (
                <Image
                  key={picture}
                  source={{ uri: picture }}
                  style={styles.picture}
                  resizeMode="contain"
                />
              ))}
              {pictures.length > 20 ? (
                <Text style={styles.meta}>仅显示前 20 张</Text>
              ) : null}
            </View>
          )}

          {chapters.length === 0 && pictures.length === 0 ? (
            <Text style={styles.info}>详情页没有章节或图片结果</Text>
          ) : null}
            </ScrollView>
          ) : null}
        </>
      )}
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
    fontSize: 20,
    fontWeight: '700',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
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
    marginTop: 12,
  },
  content: {
    paddingBottom: 24,
  },
  cover: {
    width: '100%',
    height: 220,
    borderRadius: 6,
    backgroundColor: '#111827',
    marginBottom: 10,
  },
  desc: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  chapterRow: {
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  chapterTitle: {
    color: '#f1f5f9',
    fontSize: 13,
  },
  chapterMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
  },
  search: {
    backgroundColor: '#0b1220',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    color: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
    marginBottom: 4,
    fontSize: 13,
  },
  moreButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  moreText: {
    color: '#93c5fd',
    fontSize: 13,
  },
  picture: {
    width: '100%',
    height: 260,
    backgroundColor: '#111827',
    marginBottom: 8,
  },
});
