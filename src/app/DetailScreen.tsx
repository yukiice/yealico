import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import { progressKeyFor } from './readingProgress';
import type { ReadingProgressRepository } from './readingProgress';
import { ReaderScreen } from './ReaderScreen';
import { createRuleFetcherForPlan } from './ruleFetcherForPlan';

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

export function DetailScreen({
  siteName,
  siteId,
  domain,
  rule,
  plan,
  item,
  progress,
  onBack,
}: {
  siteName: string;
  siteId: string;
  domain: string;
  rule: RuleDocument;
  plan: RoutePlan;
  item: ExtractItem;
  progress: ReadingProgressRepository;
  onBack: () => void;
}): React.JSX.Element {
  const fetcher = useMemo(() => createRuleFetcherForPlan(plan), [plan]);
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chapter, setChapter] = useState<ChapterItem | null>(null);
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

    loadDetail(rule, plan, fetcher, detailUrl, {
      baseUrl: detailUrl,
      domain,
    })
      .then(result => {
        if (cancelled) {
          return;
        }
        setDetail(result);
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
  }, [detailUrl, domain, fetcher, plan, rule]);

  if (chapter) {
    return (
      <ReaderScreen
        siteName={siteName}
        siteId={siteId}
        domain={domain}
        rule={rule}
        plan={plan}
        chapter={chapter}
        progress={progress}
        onBack={() => setChapter(null)}
      />
    );
  }

  const title = detail?.fields.title ?? item.title ?? siteName;
  const cover = detail?.fields.cover ?? item.cover;
  const pictures = detail?.pictures ?? [];
  const chapters = detail?.chapters ?? [];

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回列表</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{domain}</Text>

      {loading ? (
        <Text style={styles.info}>正在加载详情…</Text>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
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
              {chapters.slice(0, 30).map((entry, index) => (
                <Pressable
                  key={entry.idCode ?? entry.url ?? `${index}`}
                  onPress={() => setChapter(entry)}
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
              ))}
              {chapters.length > 30 ? (
                <Text style={styles.meta}>仅显示前 30 章</Text>
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
  picture: {
    width: '100%',
    height: 260,
    backgroundColor: '#111827',
    marginBottom: 8,
  },
});
