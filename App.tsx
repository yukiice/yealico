import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ImportSheet } from './src/app/ImportSheet';
import { SiteActionsSheet } from './src/app/SiteActionsSheet';
import { SiteSwitcher } from './src/app/SiteSwitcher';
import { SiteWorkspace } from './src/app/SiteWorkspace';
import type { StoredSite } from './src/app/ruleImport';
import { pickInitialSite } from './src/app/siteLibrary';
import { lightTheme as theme } from './src/app/theme';
import { useSiteLibrary } from './src/app/useSiteLibrary';

function App(): React.JSX.Element {
  const library = useSiteLibrary();
  const { setCookies } = library;
  const [activeSiteId, setActiveSiteId] = useState<string>();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [actionsSite, setActionsSite] = useState<StoredSite | null>(null);

  // 启动直接进上次的站点；站点被删或首次启动时退回第一个。
  useEffect(() => {
    if (library.loading) {
      return;
    }
    if (activeSiteId && library.sites.some(site => site.id === activeSiteId)) {
      return;
    }
    setActiveSiteId(pickInitialSite(library.sites, library.lastSiteId)?.id);
  }, [activeSiteId, library.lastSiteId, library.loading, library.sites]);

  const activeSite =
    library.sites.find(site => site.id === activeSiteId) ?? null;

  // Android 上 StatusBar.currentHeight 在部分系统版本返回 0，
  // 给一个 24dp 兜底，避免标题顶到状态栏。
  const statusBarInset =
    StatusBar.currentHeight && StatusBar.currentHeight > 0
      ? StatusBar.currentHeight
      : 24;

  const selectSite = (site: StoredSite): void => {
    setActiveSiteId(site.id);
    setSwitcherOpen(false);
    library.rememberSite(site.id).catch(() => {});
  };

  // 必须稳定：它是 SiteWorkspace 里 fetcher 的依赖，每次新建会重拉列表。
  const activeSiteIdForCookies = activeSite?.id;
  const handleCookies = useCallback(
    (cookie: string) => {
      if (!activeSiteIdForCookies) {
        return;
      }
      setCookies(activeSiteIdForCookies, cookie).catch(() => {});
    },
    [activeSiteIdForCookies, setCookies],
  );

  return (
    <View style={[styles.root, { paddingTop: statusBarInset }]}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      {library.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : activeSite ? (
        <SiteWorkspace
          key={activeSite.id}
          site={activeSite}
          progress={library.progress}
          onBack={() => setSwitcherOpen(true)}
          onOpenSwitcher={() => setSwitcherOpen(true)}
          onCookies={handleCookies}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.brand}>Yealico</Text>
          <Text style={styles.emptyTitle}>还没有站点</Text>
          <Text style={styles.emptyHint}>
            导入 Yealico 规则 JSON 或规则 URL，开始阅读。
          </Text>
          {library.error ? (
            <Text style={styles.error}>{library.error}</Text>
          ) : null}
          <Pressable
            testID="empty-add-site"
            onPress={() => setImportOpen(true)}
            style={styles.primary}>
            <Text style={styles.primaryText}>添加站点</Text>
          </Pressable>
        </View>
      )}

      <SiteSwitcher
        visible={switcherOpen}
        sites={library.sites}
        activeSiteId={activeSite?.id}
        onClose={() => setSwitcherOpen(false)}
        onSelect={selectSite}
        onActions={site => {
          setSwitcherOpen(false);
          setActionsSite(site);
        }}
        onAdd={() => {
          setSwitcherOpen(false);
          setImportOpen(true);
        }}
      />
      <ImportSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onImportText={library.importFromText}
        onImportUrl={library.importFromUrl}
      />
      <SiteActionsSheet
        site={actionsSite}
        onClose={() => setActionsSite(null)}
        onToggleWebView={site => {
          library
            .setForceWebView(site.id, !site.forceWebView)
            .catch(() => {});
          setActionsSite({ ...site, forceWebView: !site.forceWebView });
        }}
        onSaveCookies={(site, cookies) => {
          library.setCookies(site.id, cookies).catch(() => {});
        }}
        onDelete={site => {
          library.removeSite(site.id).catch(() => {});
          if (site.id === activeSiteId) {
            setActiveSiteId(undefined);
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    color: theme.accent,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 24,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyHint: {
    color: theme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 24,
  },
  error: {
    color: theme.danger,
    fontSize: 12,
    marginBottom: 16,
  },
  primary: {
    alignSelf: 'flex-start',
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default App;
