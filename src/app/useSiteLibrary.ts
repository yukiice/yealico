import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Diagnostic } from '../engine';
import { friendlyDiagnostic } from './diagnostics';
import {
  importRuleFromUrl,
  importRuleText,
  SiteRepository,
} from './ruleImport';
import type { RuleImportResult, StoredSite } from './ruleImport';
import {
  parseSiteLibrary,
  ReadingProgressRepository,
  serializeSiteLibrary,
} from './readingProgress';
import { createFetchRuleFetcher } from '../platform/ruleFetcher';
import { createSiteStorage } from '../platform/siteStorage';

export interface ImportOutcome {
  ok: boolean;
  message: string;
}

function diagnosticText(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length === 0) {
    return '导入成功';
  }
  return errors
    .slice(0, 3)
    .map(friendlyDiagnostic)
    .join('\n');
}

/**
 * 站点库的读写入口。
 *
 * 把「规则仓库 + 阅读进度 + 本地持久化 + 上次打开站点」收在一处，
 * 界面层只关心 sites / 当前站点 / 操作结果，不再自己拼存储。
 */
export function useSiteLibrary() {
  const storage = useMemo(() => createSiteStorage(), []);
  const repository = useRef(new SiteRepository());
  const progress = useRef(new ReadingProgressRepository()).current;
  const fetcher = useMemo(
    () => createFetchRuleFetcher({ timeoutMs: 15_000 }),
    [],
  );

  const [sites, setSites] = useState<StoredSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lastSiteIdRef = useRef<string | undefined>(undefined);

  const persist = useCallback(
    async (nextLastSiteId?: string): Promise<void> => {
      await storage.save(
        serializeSiteLibrary(
          repository.current.list(),
          progress.list(),
          nextLastSiteId ?? lastSiteIdRef.current,
        ),
      );
    },
    [progress, storage],
  );

  const refresh = useCallback(() => {
    setSites(repository.current.list());
  }, []);

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
          lastSiteIdRef.current = library.lastSiteId;
          setSites(repository.current.list());
        } catch {
          setError('本地站点数据损坏，已保留空列表');
        }
      })
      .catch(cause => {
        if (mounted) {
          setError(
            `读取本地站点失败: ${
              cause instanceof Error ? cause.message : String(cause)
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

  // 阅读器翻页时由仓库触发写盘，避免把存储调用传进阅读器。
  useEffect(() => {
    progress.onChange = () => {
      persist().catch(cause => {
        setError(
          `保存阅读进度失败: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      });
    };
    return () => {
      progress.onChange = undefined;
    };
  }, [persist, progress]);

  const applyResult = useCallback(
    async (result: RuleImportResult): Promise<ImportOutcome> => {
      if (!result.site) {
        return { ok: false, message: diagnosticText(result.diagnostics) };
      }
      const added = repository.current.add(result.site);
      if (!added.site) {
        return { ok: false, message: diagnosticText(added.diagnostics) };
      }
      await persist();
      refresh();
      return {
        ok: true,
        message: `已导入 ${added.site.name} (${added.site.domain})`,
      };
    },
    [persist, refresh],
  );

  const importFromText = useCallback(
    async (text: string): Promise<ImportOutcome> => {
      try {
        return await applyResult(importRuleText(text));
      } catch (cause) {
        return {
          ok: false,
          message: `导入失败: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        };
      }
    },
    [applyResult],
  );

  const importFromUrl = useCallback(
    async (url: string): Promise<ImportOutcome> => {
      try {
        return await applyResult(await importRuleFromUrl(url, fetcher));
      } catch (cause) {
        return {
          ok: false,
          message: `导入失败: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        };
      }
    },
    [applyResult, fetcher],
  );

  const rememberSite = useCallback(
    async (id: string): Promise<void> => {
      lastSiteIdRef.current = id;
      await persist(id);
    },
    [persist],
  );

  const removeSite = useCallback(
    async (id: string): Promise<void> => {
      if (!repository.current.remove(id)) {
        return;
      }
      progress.removeSite(id);
      if (lastSiteIdRef.current === id) {
        lastSiteIdRef.current = undefined;
      }
      await persist(lastSiteIdRef.current);
      refresh();
    },
    [persist, progress, refresh],
  );

  const setForceWebView = useCallback(
    async (id: string, value: boolean): Promise<void> => {
      if (!repository.current.setForceWebView(id, value)) {
        return;
      }
      await persist();
      refresh();
    },
    [persist, refresh],
  );

  const setCookies = useCallback(
    async (id: string, cookies: string): Promise<void> => {
      const site = repository.current.get(id);
      if (!site) {
        return;
      }
      // WebView 每渲染一页都会回传 Cookie；值没变就不要写盘，
      // 否则会触发 re-render → 新 fetcher → 重拉列表的循环。
      if ((site.cookies ?? '') === cookies.trim()) {
        return;
      }
      if (!repository.current.setCookies(id, cookies)) {
        return;
      }
      await persist();
      refresh();
    },
    [persist, refresh],
  );

  return {
    sites,
    loading,
    error,
    progress,
    lastSiteId: lastSiteIdRef.current,
    importFromText,
    importFromUrl,
    rememberSite,
    removeSite,
    setForceWebView,
    setCookies,
  };
}
