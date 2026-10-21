import React, { useEffect, useMemo, useState } from 'react';
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
import type { Diagnostic, RuleDocument } from '../engine';
import type { StoredSite } from './ruleImport';
import { createFetchRuleFetcher } from '../platform/ruleFetcher';

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

function errorText(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter(item => item.severity === 'error');
  return errors.length > 0
    ? errors
        .slice(0, 3)
        .map(item => `${item.code}: ${item.detail ?? item.fieldPath}`)
        .join('\n')
    : '';
}

export function SiteWorkspace({
  site,
  onBack,
}: {
  site: StoredSite;
  onBack: () => void;
}): React.JSX.Element {
  const pages = useMemo(() => listRulePages(site.rule), [site.rule]);
  const [page, setPage] = useState<number | undefined>(() =>
    defaultPageFor(site.rule),
  );
  const fetcher = useMemo(
    () => createFetchRuleFetcher({ timeoutMs: 15_000 }),
    [],
  );
  const [items, setItems] = useState<
    Array<{ title?: string; idCode?: string; cover?: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const built = useMemo(() => {
    if (pages.length === 0) {
      return {
        rule: site.rule,
        plan: buildRoutePlan(site.rule),
      };
    }
    return buildPagePlan(site.rule, page ?? 0);
  }, [pages.length, page, site.rule]);

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
  }, [built, fetcher, site.domain]);

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回站点</Text>
      </Pressable>
      <Text style={styles.title}>{site.name}</Text>
      <Text style={styles.meta}>{site.domain}</Text>

      {pages.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pageList}>
          {pages.map(item => (
            <Pressable
              key={item.index}
              onPress={() => setPage(item.index)}
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
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : items.length === 0 ? (
        <Text style={styles.info}>列表为空</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((item, index) => (
            <View key={item.idCode ?? `${index}`} style={styles.item}>
              <Text style={styles.itemTitle}>{item.title ?? '(无标题)'}</Text>
              {item.idCode ? (
                <Text style={styles.itemMeta}>{item.idCode}</Text>
              ) : null}
            </View>
          ))}
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
    marginBottom: 10,
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
