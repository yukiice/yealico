import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  buildPagePlan,
  buildRoutePlan,
  listRulePages,
  loadListPages,
  loadSearch,
} from '../engine';
import type { ExtractItem, RuleDocument } from '../engine';
import type { StoredSite } from './ruleImport';
import { importRuleText } from './ruleImport';
import { DebugScreen } from './DebugScreen';
import { DebugSession } from './debugReport';
import { DetailScreen } from './DetailScreen';
import { errorText } from './diagnostics';
import { contentState, displayIdCode } from './presentation';
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
  const rule = useMemo(() => {
    const rebuilt = importRuleText(site.raw, site.source).site;
    return rebuilt?.rule ?? site.rule;
  }, [site.raw, site.rule, site.source]);
  const pages = useMemo(() => listRulePages(rule), [rule]);
  const [page, setPage] = useState<number | undefined>(() =>
    defaultPageFor(rule),
  );
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [items, setItems] = useState<ExtractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<ExtractItem | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const debug = useRef(new DebugSession()).current;

  const built = useMemo(() => {
    if (pages.length === 0) {
      return {
        rule,
        plan: buildRoutePlan(rule),
      };
    }
    return buildPagePlan(rule, page ?? 0);
  }, [pages.length, page, rule]);
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
    const keyword = searchKeyword.trim();
    const pending = keyword
      ? loadSearch(built.rule, built.plan, fetcher, keyword, context, {
          maxPages: 1,
        })
      : loadListPages(built.rule, built.plan, fetcher, context, { maxPages: 1 });
    pending
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
          label: keyword
            ? `搜索：${keyword}`
            : pages.length > 0
              ? `页面 ${(page ?? 0) + 1}`
              : undefined,
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
  }, [built, debug, fetcher, page, pages.length, searchKeyword, site.domain]);

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

      <View style={styles.searchRow}>
        <TextInput
          testID="site-search-input"
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="搜索作品，留空恢复列表"
          placeholderTextColor="#64748b"
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={() => setSearchKeyword(searchInput)}
        />
        <Pressable
          testID="site-search-submit"
          onPress={() => setSearchKeyword(searchInput)}
          style={styles.searchButton}>
          <Text style={styles.searchButtonText}>搜索</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text style={styles.info}>
          {searchKeyword.trim() ? '正在搜索…' : '正在加载列表…'}
        </Text>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {listState === 'empty' ? (
            <Text style={styles.info}>
              {searchKeyword.trim() ? '没有匹配的作品' : '列表为空'}
            </Text>
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
                    <Text style={styles.itemMeta}>
                      {displayIdCode(item.idCode)}
                    </Text>
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
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: '#e2e8f0',
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  searchButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 6,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#eff6ff',
    fontSize: 13,
    fontWeight: '600',
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
