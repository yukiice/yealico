import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RoutePlan } from '../engine';
import {
  blockingReasons,
  describeCapabilities,
  formatDiagnostic,
  sanitizeUrl,
} from './debugReport';
import type { DebugSession } from './debugReport';
import type { StoredSite } from './ruleImport';

function stageTitle(stage: string): string {
  switch (stage) {
    case 'list':
      return '列表';
    case 'detail':
      return '详情';
    case 'gallery':
      return '图库';
    default:
      return stage;
  }
}

function countsText(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? ''
    : entries.map(([key, value]) => `${key}=${value}`).join('  ');
}

export function DebugScreen({
  site,
  plan,
  debug,
  onBack,
}: {
  site: StoredSite;
  plan: RoutePlan;
  debug: DebugSession;
  onBack: () => void;
}): React.JSX.Element {
  const records = debug.list();
  const blocked = blockingReasons(plan);
  const errors = records.reduce(
    (total, record) =>
      total + record.diagnostics.filter(item => item.severity === 'error').length,
    0,
  );
  const warnings = records.reduce(
    (total, record) =>
      total +
      record.diagnostics.filter(item => item.severity === 'warning').length,
    0,
  );

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← 返回站点</Text>
      </Pressable>
      <Text style={styles.title}>调试</Text>
      <Text style={styles.meta}>
        {site.name} · {site.domain}
      </Text>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>规则</Text>
        <Text style={styles.line}>来源：{site.source}</Text>
        <Text style={styles.line}>哈希：{site.hash}</Text>
        <Text style={styles.line}>原文：{site.raw.length} 字符</Text>
        <Text style={styles.line}>
          能力：{describeCapabilities(plan.capabilities)}
        </Text>
        <Text style={styles.line}>
          阻断项：{blocked.length === 0 ? '无' : blocked.length}
        </Text>
        {blocked.map(item => (
          <Text key={`${item.code}-${item.fieldPath}`} style={styles.error}>
            {formatDiagnostic(item)}
          </Text>
        ))}

        <View style={styles.sectionRow}>
          <Text style={styles.section}>阶段记录</Text>
          <Pressable onPress={() => debug.clear()} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>清空</Text>
          </Pressable>
        </View>
        <Text style={styles.meta}>
          {`共 ${records.length} 条 · error ${errors} / warning ${warnings}`}
        </Text>

        {records.length === 0 ? (
          <Text style={styles.info}>
            还没有记录。回到列表、详情或章节里触发一次加载即可。
          </Text>
        ) : (
          records.map(record => (
            <View
              key={`${record.at}-${record.stage}`}
              style={styles.record}>
              <Text style={styles.recordTitle}>
                {`${stageTitle(record.stage)}${
                  record.label ? ` · ${record.label}` : ''
                }`}
              </Text>
              <Text style={styles.line}>
                {`${record.at}  ${countsText(record.counts)}`}
              </Text>
              {record.diagnostics.map((item, index) => (
                <Text
                  key={`${item.code}-${item.fieldPath}-${index}`}
                  style={item.severity === 'error' ? styles.error : styles.warn}>
                  {formatDiagnostic(item)}
                </Text>
              ))}
              {record.urls.map(url => (
                <Text key={url} style={styles.url}>
                  {sanitizeUrl(url)}
                </Text>
              ))}
            </View>
          ))
        )}
      </ScrollView>
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
    marginBottom: 8,
  },
  section: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  smallButton: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  smallButtonText: {
    color: '#e2e8f0',
    fontSize: 11,
  },
  content: {
    paddingBottom: 24,
  },
  line: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
  },
  info: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 8,
  },
  error: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  warn: {
    color: '#fcd34d',
    fontSize: 11,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  url: {
    color: '#64748b',
    fontSize: 10,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  record: {
    borderTopColor: '#1e293b',
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 8,
  },
  recordTitle: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
});
