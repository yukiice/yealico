import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  buildPagePlan,
  buildRoutePlan,
  listRulePages,
  loadListPages,
} from '../engine';
import type { ExtractItem, RuleDocument } from '../engine';
import type { StoredSite } from './ruleImport';
import { DebugScreen } from './DebugScreen';
import { DebugSession } from './debugReport';
import { DetailScreen } from './DetailScreen';
import { errorText } from './diagnostics';
import { contentState } from './presentation';
import type { ReadingProgressRepository } from './readingProgress';
import { createRuleFetcherForPlan } from './ruleFetcherForPlan';

export function defaultPageFor(rule: RuleDocument): number | undefined {
  const pages = rule.pages ?? [];
  if (pages.length === 0) {
    return undefined;
  }
  const recent = pages.findIndex(
    page => typeof page.name === 'string' && /最近|更新/.test(page.name),
  );
  if (recent >= 0) {
    return recent;
  }
  const withRule = pages.findIndex(page => page.indexRule !== undefined);
  return withRule >= 0 ? withRule : 0;
}

export function SiteWorkspace({
  site,
  progress,
  onBack,
}: {
  site: StoredSite;
  progress: ReadingProgressRepository;
  onBack: () => void;
}): React.JSX.Element {
  const pages = useMemo(() => listRulePages(site.rule), [site.rule]);
  const [page, setPage] = useState<number | undefined>(() =>
    defaultPageFor(site.rule),
  );
  const [items, setItems] = useState<ExtractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<ExtractItem | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const debug = useRef(new DebugSession()).current;

  const built = useMemo(() => {
    if (pages.length === 0) {
      return {
        rule: site.rule,
        plan: buildRoutePlan(site.rule),
      };
    }
    return buildPagePlan(site.rule, page ?? 0);
  }, [pages.length, page, site.rule]);
  const fetcher = useMemo(
    () => createRuleFetcherForPlan(built.plan),
    [built.plan],
  );
  const lastRead = progress.latestForSite(site.id);
  const listState = contentState(items.length, error);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setItems([]);

    const context = {
      baseUrl: `https://${site.domain}/`,
      domain: site.domain,
    };
    loadListPages(built.rule, built.plan, fetcher, context, { maxPages: 1 })
      .then(result => {
        if (cancelled) {
          return;
        }
        const diagnostics = [...built.plan.unsupported, ...result.diagnostics];
        const message = errorText(diagnostics);
        if (message) {
          setError(message);
        }
        setItems(
          result.items.map(item => ({
            title: item.title,
            idCode: item.idCode,
            cover: item.cover,
          })),
        );
        debug.record({
          stage: 'list',
          label: pages.length > 0 ? `页面 ${(page ?? 0) + 1}` : undefined,
          counts: { items: result.items.length, pages: result.pages },
          diagnostics,
          urls: result.urls,
        });
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
  }, [built, debug, fetcher, page, pages.length, site.domain]);

  if (debugOpen) {
    return (
      <DebugScreen
        site={site}
        plan={built.plan}
        debug={debug}
        onBack={() => setDebugOpen(false)}
      />
    );
  }

  if (selectedItem) {
    return (
      <DetailScreen
        siteName={site.name}
        siteId={site.id}
        domain={site.domain}
        rule={built.rule}
        plan={built.plan}
        item={selectedItem}
        progress={progress}
        debug={debug}
        onBack={() => setSelectedItem(null)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回站点</Text>
      </Pressable>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{site.name}</Text>
          <Text style={styles.meta}>{site.domain}</Text>
        </View>
        <Pressable onPress={() => setDebugOpen(true)} style={styles.debugButton}>
          <Text style={styles.debugButtonText}>调试</Text>
        </Pressable>
      </View>
      {lastRead ? (
        <Text style={styles.lastRead}>
          {`上次读到《${lastRead.chapterTitle ?? lastRead.chapterKey}》第 ${
            lastRead.index + 1
          } 张`}
        </Text>
      ) : null}

      {pages.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pageList}>
          {pages.map(item => (
            <Pressable
              key={item.index}
              onPress={() => {
                setSelectedItem(null);
                setPage(item.index);
              }}
              style={[
                styles.pageButton,
                page === item.index && styles.pageButtonActive,
              ]}>
              <Text
                style={[
                  styles.pageText,
                  page === item.index && styles.pageTextActive,
                ]}>
                {item.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <Text style={styles.info}>正在加载列表…</Text>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {listState === 'empty' ? (
            <Text style={styles.info}>列表为空</Text>
          ) : null}
          {listState === 'content' ? (
            <ScrollView contentContainerStyle={styles.list}>
              {items.map((item, index) => (
                <Pressable
                  key={item.idCode ?? `${index}`}
                  onPress={() => setSelectedItem(item)}
                  style={styles.item}>
                  <Text style={styles.itemTitle}>{item.title ?? '(无标题)'}</Text>
                  {item.idCode ? (
                    <Text style={styles.itemMeta}>{item.idCode}</Text>
                  ) : null}
                </Pressable>
              ))}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  headerText: {
    flex: 1,
  },
  debugButton: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 4,
  },
  debugButtonText: {
    color: '#e2e8f0',
    fontSize: 11,
  },
  meta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  lastRead: {
    color: '#93c5fd',
    fontSize: 12,
    marginBottom: 8,
  },
  pageList: {
    paddingBottom: 8,
  },
  pageButton: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 6,
    marginRight: 8,
  },
  pageButtonActive: {
    backgroundColor: '#1d4ed8',
  },
  pageText: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  pageTextActive: {
    color: '#eff6ff',
    fontWeight: '600',
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
  list: {
    paddingBottom: 24,
  },
  item: {
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  itemTitle: {
    color: '#f1f5f9',
    fontSize: 14,
  },
  itemMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 3,
  },
});
