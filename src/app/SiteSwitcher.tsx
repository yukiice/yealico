import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { StoredSite } from './ruleImport';
import { Sheet } from './Sheet';
import { lightTheme as theme } from './theme';

/**
 * 站点切换面板。
 *
 * 切换站点是高频动作，用底部弹层而不是整页；每行右侧的「…」进入站点动作。
 */
export function SiteSwitcher({
  visible,
  sites,
  activeSiteId,
  onClose,
  onSelect,
  onActions,
  onAdd,
}: {
  visible: boolean;
  sites: StoredSite[];
  activeSiteId?: string;
  onClose: () => void;
  onSelect: (site: StoredSite) => void;
  onActions: (site: StoredSite) => void;
  onAdd: () => void;
}): React.JSX.Element {
  return (
    <Sheet visible={visible} title="站点" onClose={onClose} testID="site-switcher">
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {sites.length === 0 ? (
          <Text style={styles.empty}>还没有站点</Text>
        ) : (
          sites.map(site => {
            const active = site.id === activeSiteId;
            return (
              <View key={site.id} style={styles.row}>
                <Pressable
                  testID={`switch-site-${site.id}`}
                  onPress={() => onSelect(site)}
                  style={styles.main}>
                  <View style={styles.titleRow}>
                    {active ? <View style={styles.dot} /> : null}
                    <Text style={[styles.name, active && styles.nameActive]}>
                      {site.name}
                    </Text>
                  </View>
                  <Text style={styles.meta}>
                    {site.domain}
                    {site.cookies ? ' · Cookie' : ''}
                    {site.forceWebView ? ' · WebView' : ''}
                  </Text>
                </Pressable>
                <Pressable
                  testID={`site-actions-${site.id}`}
                  hitSlop={8}
                  onPress={() => onActions(site)}
                  style={styles.actions}>
                  <Text style={styles.actionsText}>…</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
      <Pressable testID="add-site" onPress={onAdd} style={styles.add}>
        <Text style={styles.addText}>＋ 添加站点</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 360,
  },
  listContent: {
    paddingBottom: 4,
  },
  empty: {
    color: theme.textMuted,
    fontSize: 13,
    paddingVertical: 16,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingVertical: 12,
  },
  main: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  name: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  nameActive: {
    color: theme.accent,
  },
  meta: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  actions: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actionsText: {
    color: theme.textMuted,
    fontSize: 20,
    lineHeight: 20,
  },
  add: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
  },
  addText: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '700',
  },
});
