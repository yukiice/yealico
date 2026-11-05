import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { lightTheme as theme } from './theme';

export type BottomTab = 'discover' | 'favorites' | 'history' | 'me';

const ITEMS: Array<{ key: BottomTab; label: string; glyph: string }> = [
  { key: 'discover', label: '发现', glyph: '◉' },
  { key: 'favorites', label: '收藏', glyph: '☆' },
  { key: 'history', label: '历史', glyph: '◷' },
  { key: 'me', label: '我', glyph: '○' },
];

export function BottomNav({
  active,
  onChange,
}: {
  active: BottomTab;
  onChange: (tab: BottomTab) => void;
}): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      {ITEMS.map(item => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            testID={`bottom-nav-${item.key}`}
            onPress={() => onChange(item.key)}
            style={styles.item}>
            <Text style={[styles.glyph, selected && styles.active]}>
              {item.glyph}
            </Text>
            <Text style={[styles.label, selected && styles.active]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 18,
    flexDirection: 'row',
    backgroundColor: theme.background,
    borderRadius: 32,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  glyph: {
    color: theme.textMuted,
    fontSize: 18,
    lineHeight: 20,
  },
  label: {
    color: theme.textMuted,
    fontSize: 10,
  },
  active: {
    color: theme.accent,
  },
});
