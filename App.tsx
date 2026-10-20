/**
 * P1 自检页。
 *
 * 这里刻意不做完整 UI：只在 Android 运行时跑与 Node 相同的一组
 * fixture，并把 PASS/FAIL 显示出来，用于验证 Hermes 与打包链路。
 */

import React, { useMemo } from 'react';
import { Platform, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { runBenchmark, runSelftest } from './src/engine/selftest';

function App(): React.JSX.Element {
  const results = useMemo(() => runSelftest(), []);
  const benchmarks = useMemo(() => runBenchmark(), []);
  const failed = results.filter(result => !result.ok).length;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>Yealico P1 自检</Text>
      <Text
        testID="selftest-summary"
        style={[styles.summary, failed === 0 ? styles.pass : styles.fail]}>
        {failed === 0
          ? `全部通过 (${results.length})`
          : `失败 ${failed}/${results.length}`}
      </Text>
      <Text style={styles.note}>
        合成 fixture，仅验证规则引擎；不代表真实站点兼容。
      </Text>
      <ScrollView contentContainerStyle={styles.list}>
        {results.map(result => (
          <View key={result.name} style={styles.row}>
            <Text style={[styles.name, result.ok ? styles.pass : styles.fail]}>
              {result.ok ? 'PASS' : 'FAIL'} {result.name}
            </Text>
            {!result.ok && <Text style={styles.detail}>{result.detail}</Text>}
          </View>
        ))}
        <Text style={styles.section}>解析耗时（合成 fixture，20 次）</Text>
        {benchmarks.map(benchmark => (
          <Text key={benchmark.name} style={styles.bench}>
            {benchmark.name}: avg {benchmark.avgMs.toFixed(2)}ms / max{' '}
            {benchmark.maxMs.toFixed(2)}ms / {benchmark.chars} chars
          </Text>
        ))}
        <Text style={styles.note}>内存未测量；真实页面性能待 P1 探针。</Text>
      </ScrollView>
    </View>
  );
}

const monospace = Platform.OS === 'android' ? 'monospace' : 'Menlo';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f1115',
    paddingTop: 48,
    paddingHorizontal: 16,
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  summary: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  note: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 16,
  },
  list: {
    paddingBottom: 32,
  },
  row: {
    marginBottom: 12,
  },
  name: {
    fontSize: 13,
  },
  pass: {
    color: '#4ade80',
  },
  fail: {
    color: '#f87171',
  },
  detail: {
    color: '#fca5a5',
    fontSize: 11,
    marginTop: 4,
    fontFamily: monospace,
  },
  section: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  bench: {
    color: '#93c5fd',
    fontSize: 12,
    fontFamily: monospace,
    marginBottom: 4,
  },
});

export default App;
