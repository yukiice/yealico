import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { StoredSite } from './ruleImport';
import { Sheet } from './Sheet';
import { lightTheme as theme } from './theme';

type Mode = 'menu' | 'cookie';

/**
 * 单站点动作面板：抓取方式、Cookie、删除。
 *
 * 行内只留一个入口，动作多了也放得下；删除走系统确认框。
 */
export function SiteActionsSheet({
  site,
  onClose,
  onToggleWebView,
  onSaveCookies,
  onDelete,
}: {
  site: StoredSite | null;
  onClose: () => void;
  onToggleWebView: (site: StoredSite) => void;
  onSaveCookies: (site: StoredSite, cookies: string) => void;
  onDelete: (site: StoredSite) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('menu');
  const [cookieInput, setCookieInput] = useState('');

  useEffect(() => {
    setMode('menu');
    setCookieInput(site?.cookies ?? '');
  }, [site]);

  const confirmDelete = (): void => {
    if (!site) {
      return;
    }
    Alert.alert('删除站点', `确定删除 ${site.name}？阅读进度也会一并清除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          onDelete(site);
          onClose();
        },
      },
    ]);
  };

  return (
    <Sheet
      visible={site !== null}
      title={mode === 'cookie' ? `${site?.name ?? ''} 的 Cookie` : site?.name ?? ''}
      onClose={onClose}
      testID="site-actions">
      {mode === 'menu' ? (
        <View>
          <Pressable
            testID="toggle-webview"
            onPress={() => {
              if (site) {
                onToggleWebView(site);
              }
            }}
            style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>抓取方式</Text>
              <Text style={styles.rowMeta}>
                需要执行 JS 或过 Cloudflare 挑战时用 WebView
              </Text>
            </View>
            <Text style={[styles.value, site?.forceWebView && styles.valueOn]}>
              {site?.forceWebView ? 'WebView' : '自动'}
            </Text>
          </Pressable>
          <Pressable
            testID="open-cookie"
            onPress={() => setMode('cookie')}
            style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>Cookie</Text>
              <Text style={styles.rowMeta}>
                {site?.cookies
                  ? `已设置 · ${site.cookies.length} 字符`
                  : '未设置，登录站或风控站可粘贴'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <Pressable testID="delete-site" onPress={confirmDelete} style={styles.row}>
            <Text style={styles.danger}>删除站点</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <Text style={styles.rowMeta}>
            从浏览器开发者工具复制 Cookie 整串，或让 WebView 渲染后自动回填。
          </Text>
          <TextInput
            testID="cookie-input"
            value={cookieInput}
            onChangeText={setCookieInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="_ga=...; webp=1"
            placeholderTextColor={theme.textMuted}
            style={styles.cookieInput}
          />
          <View style={styles.cookieActions}>
            <Pressable
              testID="cookie-save"
              onPress={() => {
                if (site) {
                  onSaveCookies(site, cookieInput);
                }
                onClose();
              }}
              style={styles.primary}>
              <Text style={styles.primaryText}>保存</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (site) {
                  onSaveCookies(site, '');
                }
                onClose();
              }}
              style={styles.ghost}>
              <Text style={styles.ghostText}>清空</Text>
            </Pressable>
            <Pressable onPress={() => setMode('menu')} style={styles.ghost}>
              <Text style={styles.ghostText}>返回</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  value: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  valueOn: {
    color: theme.accent,
  },
  chevron: {
    color: theme.textMuted,
    fontSize: 20,
  },
  danger: {
    color: theme.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  cookieInput: {
    minHeight: 110,
    maxHeight: 200,
    color: theme.text,
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 10,
  },
  cookieActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 9,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  ghost: {
    backgroundColor: theme.surface,
    borderRadius: 9,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  ghostText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
