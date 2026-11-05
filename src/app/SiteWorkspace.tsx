import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { DebugSession } from './debugReport';
import { DetailScreen } from './DetailScreen';
import { errorText } from './diagnostics';
import { contentState, displayIdCode } from './presentation';
import type { ReadingProgressRepository } from './readingProgress';
import { createRuleFetcherForPlan } from './ruleFetcherForPlan';
import { BottomNav } from './BottomNav';
import type { BottomTab } from './BottomNav';
import { lightTheme as theme } from './theme';

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
  const [tab, setTab] = useState<BottomTab>('discover');
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
  const listState = contentState(items.length, error);
  const history = useMemo(
    () => progress.list().filter(entry => entry.siteId === site.id),
    [progress, site.id],
  );

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
        onNavigate={next => {
          setSelectedItem(null);
          setTab(next);
        }}
      />
    );
  }

  if (tab !== 'discover') {
    return (
      <View style={styles.root}>
        <View style={styles.simpleHeader}>
          <Text style={styles.simpleTitle}>
            {tab === 'favorites' ? '收藏' : tab === 'history' ? '历史' : '我'}
          </Text>
        </View>
        {tab === 'favorites' ? (
          <Text style={styles.placeholder}>收藏功能即将上线</Text>
        ) : null}
        {tab === 'history' ? (
          <FlatList
            data={history}
            keyExtractor={entry => `${entry.chapterKey}`}
            contentContainerStyle={styles.historyList}
            ListEmptyComponent={
              <Text style={styles.placeholder}>还没有阅读记录</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.historyRow}>
                <Text style={styles.historyTitle}>
                  {item.chapterTitle ?? item.chapterKey}
                </Text>
                <Text style={styles.historyMeta}>
                  第 {item.index + 1} 张 · {item.total && item.total > 0 ? item.total : '?'} 张
                </Text>
              </View>
            )}
          />
        ) : null}
        {tab === 'me' ? (
          <View style={styles.me}>
            <Text style={styles.meName}>{site.name}</Text>
            <Text style={styles.meMeta}>{site.domain}</Text>
            <Pressable onPress={onBack} style={styles.meButton}>
              <Text style={styles.meButtonText}>站点管理</Text>
            </Pressable>
          </View>
        ) : null}
        <BottomNav
          active={tab}
          onChange={next => {
            setTab(next);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.siteName}>{site.name}</Text>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          testID="site-search-input"
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="搜索漫画、作者或标签"
          placeholderTextColor={theme.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={() => setSearchKeyword(searchInput)}
        />
        {searchInput.length > 0 ? (
          <Pressable
            testID="site-search-clear"
            hitSlop={8}
            onPress={() => {
              setSearchInput('');
              setSearchKeyword('');
            }}>
            <Text style={styles.searchClear}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {pages.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pageScroll}
          contentContainerStyle={styles.pageList}>
          {pages.map(item => {
            const active = !searchKeyword && page === item.index;
            return (
              <Pressable
                key={item.index}
                onPress={() => {
                  setSearchInput('');
                  setSearchKeyword('');
                  setPage(item.index);
                }}
                style={styles.pageItem}>
                <Text
                  style={[styles.pageText, active && styles.pageTextActive]}>
                  {item.name}
                </Text>
                {active ? <View style={styles.pageUnderline} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

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
            <FlatList
              data={items}
              numColumns={3}
              keyExtractor={(item, index) => item.idCode ?? `${index}`}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.gridRow}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.card}
                  onPress={() => setSelectedItem(item)}>
                  {item.cover ? (
                    <Image
                      source={{ uri: item.cover }}
                      style={styles.cover}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.cover, styles.coverEmpty]} />
                  )}
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title ?? '(无标题)'}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {displayIdCode(item.idCode ?? '')}
                  </Text>
                </Pressable>
              )}
            />
          ) : null}
        </>
      )}

      <BottomNav active={tab} onChange={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 12,
  },
  siteName: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
  },
  debugText: {
    color: theme.textMuted,
    fontSize: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 44,
  },
  searchGlyph: {
    color: theme.textMuted,
    fontSize: 18,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    padding: 0,
  },
  searchClear: {
    color: theme.textMuted,
    fontSize: 18,
    paddingLeft: 8,
  },
  pageScroll: {
    flexGrow: 0,
    marginTop: 14,
    marginBottom: 6,
  },
  pageList: {
    gap: 22,
  },
  pageItem: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  pageText: {
    color: theme.textMuted,
    fontSize: 14,
  },
  pageTextActive: {
    color: theme.accent,
    fontWeight: '600',
  },
  pageUnderline: {
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.accent,
    marginTop: 4,
  },
  info: {
    color: theme.textMuted,
    fontSize: 13,
    marginTop: 16,
  },
  error: {
    color: theme.danger,
    fontSize: 12,
    marginTop: 16,
  },
  grid: {
    paddingTop: 14,
    paddingBottom: 120,
  },
  gridRow: {
    gap: 12,
    marginBottom: 18,
  },
  card: {
    flex: 1,
    maxWidth: '31.5%',
  },
  cover: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: theme.surface,
  },
  coverEmpty: {
    backgroundColor: theme.surface,
  },
  cardTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 17,
    minHeight: 34,
  },
  cardMeta: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  simpleHeader: {
    marginTop: 8,
    marginBottom: 12,
  },
  simpleTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  placeholder: {
    color: theme.textMuted,
    fontSize: 13,
    marginTop: 16,
  },
  historyList: {
    paddingBottom: 120,
  },
  historyRow: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  historyTitle: {
    color: theme.text,
    fontSize: 14,
  },
  historyMeta: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  me: {
    marginTop: 8,
  },
  meName: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  meMeta: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  meButton: {
    backgroundColor: theme.accent,
    borderRadius: 22,
    alignItems: 'center',
    paddingVertical: 12,
  },
  meButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  meButtonGhost: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 10,
  },
  meButtonGhostText: {
    color: theme.textMuted,
    fontSize: 13,
  },
});
