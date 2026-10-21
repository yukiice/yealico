import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  importRuleFromUrl,
  importRuleText,
  SiteRepository,
} from './ruleImport';
import type { Diagnostic } from '../engine';
import type { StoredSite } from './ruleImport';
import {
  parseSiteLibrary,
  ReadingProgressRepository,
  serializeSiteLibrary,
} from './readingProgress';
import { createFetchRuleFetcher } from '../platform/ruleFetcher';
import { createSiteStorage } from '../platform/siteStorage';
import { SiteWorkspace } from './SiteWorkspace';

function diagnosticText(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length === 0) {
    return '导入成功';
  }
  return errors
    .slice(0, 3)
    .map(item => `${item.code}: ${item.detail ?? item.fieldPath}`)
    .join('\n');
}

export function SiteManager(): React.JSX.Element {
  const storage = useMemo(() => createSiteStorage(), []);
  const fetcher = useMemo(
    () => createFetchRuleFetcher({ timeoutMs: 15_000 }),
    [],
  );
  const repository = useRef(new SiteRepository());
  const progress = useRef(new ReadingProgressRepository()).current;
  const [sites, setSites] = useState<StoredSite[]>([]);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('粘贴 Yealico 规则 JSON 或规则 URL');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSite, setSelectedSite] = useState<StoredSite | null>(null);

  useEffect(() => {
    let mounted = true;
    storage
      .load()
      .then(raw => {
        if (!mounted || !raw) {
          return;
        }
        try {
          const library = parseSiteLibrary(raw);
          repository.current = new SiteRepository(library.sites);
          progress.replaceAll(library.progress);
          setSites(repository.current.list());
        } catch {
          setMessage('本地站点数据损坏，已保留空列表');
        }
      })
      .catch(error => {
        if (mounted) {
          setMessage(
            `读取本地站点失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [progress, storage]);

  const persist = useCallback(async (): Promise<void> => {
    await storage.save(
      serializeSiteLibrary(repository.current.list(), progress.list()),
    );
  }, [progress, storage]);

  // 阅读器翻页时由仓库触发写盘，避免把存储调用再往下传一层。
  useEffect(() => {
    progress.onChange = () => {
      persist().catch(error => {
        setMessage(
          `保存阅读进度失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    };
    return () => {
      progress.onChange = undefined;
    };
  }, [persist, progress]);

  const importRule = async (): Promise<void> => {
    const payload = input.trim();
    if (!payload) {
      setMessage('请输入规则 JSON 或规则 URL');
      return;
    }
    setBusy(true);
    try {
      const result = /^https?:\/\//i.test(payload)
        ? await importRuleFromUrl(payload, fetcher)
        : importRuleText(payload);
      if (!result.site) {
        setMessage(diagnosticText(result.diagnostics));
        return;
      }
      const added = repository.current.add(result.site);
      if (!added.site) {
        setMessage(diagnosticText(added.diagnostics));
        return;
      }
      await persist();
      setSites(repository.current.list());
      setInput('');
      setMessage(
        `已导入 ${added.site.name} (${added.site.domain})`,
      );
    } catch (error) {
      setMessage(
        `导入失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const removeSite = async (id: string): Promise<void> => {
    if (!repository.current.remove(id)) {
      return;
    }
    progress.removeSite(id);
    await persist();
    setSites(repository.current.list());
    setMessage('已删除站点');
  };

  if (selectedSite) {
    return (
      <SiteWorkspace
        site={selectedSite}
        progress={progress}
        onBack={() => setSelectedSite(null)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>站点管理</Text>
      <Text style={styles.note}>
        支持 Yealico 提取规则 JSON 和规则 URL。Yealico v2 二维码尚未解码，
        扫描功能会在后续接入同一导入链路。
      </Text>
      <TextInput
        testID="rule-import-input"
        value={input}
        onChangeText={setInput}
        editable={!busy}
        multiline
        placeholder="粘贴规则 JSON，或 https://... 规则 URL"
        placeholderTextColor="#64748b"
        style={styles.input}
      />
      <Pressable
        testID="rule-import-submit"
        onPress={importRule}
        disabled={busy}
        style={[styles.button, busy && styles.buttonDisabled]}>
        <Text style={styles.buttonText}>{busy ? '导入中…' : '导入规则'}</Text>
      </Pressable>
      <Text style={styles.message}>{message}</Text>
      {loading ? (
        <Text style={styles.note}>正在读取本地站点…</Text>
      ) : sites.length === 0 ? (
        <Text style={styles.empty}>还没有站点</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {sites.map(site => (
            <View key={site.id} style={styles.siteRow}>
              <Pressable
                onPress={() => setSelectedSite(site)}
                style={styles.siteText}>
                <Text style={styles.siteName}>{site.name}</Text>
                <Text style={styles.siteMeta}>
                  {site.domain} · {site.source}
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await removeSite(site.id);
                }}
                style={styles.removeButton}>
                <Text style={styles.removeText}>删除</Text>
              </Pressable>
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
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  note: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 12,
  },
  input: {
    minHeight: 100,
    maxHeight: 180,
    color: '#e2e8f0',
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#1d4ed8',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  buttonDisabled: {
    backgroundColor: '#334155',
  },
  buttonText: {
    color: '#eff6ff',
    fontSize: 13,
    fontWeight: '600',
  },
  message: {
    color: '#93c5fd',
    fontSize: 12,
    marginBottom: 12,
  },
  empty: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 8,
  },
  list: {
    paddingBottom: 24,
  },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  siteText: {
    flex: 1,
  },
  siteName: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
  },
  siteMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 3,
  },
  removeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#7f1d1d',
    borderRadius: 5,
  },
  removeText: {
    color: '#fecaca',
    fontSize: 12,
  },
});
