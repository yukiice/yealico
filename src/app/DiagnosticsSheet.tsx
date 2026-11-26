import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { debugRecordSummary } from './debugReport';
import type { DebugSession } from './debugReport';
import { Sheet } from './Sheet';
import { lightTheme as theme } from './theme';

/**
 * 诊断面板：看最近几个阶段的抓取结果、失败 URL 和诊断。
 *
 * 调试页此前已移除；这里只保留只读排查信息，不做任何操作入口。
 */
export function DiagnosticsSheet({
  visible,
  debug,
  onClose,
}: {
  visible: boolean;
  debug: DebugSession;
  onClose: () => void;
}): React.JSX.Element {
  const records = visible ? debug.list() : [];

  return (
    <Sheet visible={visible} title="诊断" onClose={onClose} testID="diagnostics">
      {records.length === 0 ? (
        <Text style={styles.empty}>还没有记录，先打开一章试试。</Text>
      ) : (
        <ScrollView style={styles.list}>
          {records.map((record, index) => (
            <View key={`${record.at}:${index}`} style={styles.card}>
              <Text style={styles.time}>
                {new Date(record.at).toLocaleTimeString()}
              </Text>
              {debugRecordSummary(record).map((line, lineIndex) => (
                <Text
                  key={`${index}:${lineIndex}`}
                  style={lineIndex === 0 ? styles.headline : styles.line}
                  selectable>
                  {line}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      {records.length > 0 ? (
        <Pressable
          onPress={() => {
            debug.clear();
            onClose();
          }}
          style={styles.clear}>
          <Text style={styles.clearText}>清空记录</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 420,
  },
  empty: {
    color: theme.textMuted,
    fontSize: 13,
    paddingVertical: 20,
    textAlign: 'center',
  },
  card: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingVertical: 10,
  },
  time: {
    color: theme.textMuted,
    fontSize: 10,
    marginBottom: 4,
  },
  headline: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  line: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  clear: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: theme.surface,
  },
  clearText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
