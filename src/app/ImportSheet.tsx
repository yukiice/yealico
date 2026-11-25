import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ImportOutcome } from './useSiteLibrary';
import { Sheet } from './Sheet';
import { lightTheme as theme } from './theme';

type ImportMode = 'paste' | 'url';

/**
 * 添加站点：粘贴规则 JSON 或拉取规则 URL。
 *
 * 导入是低频动作，收进底部弹层，首屏只留内容。
 */
export function ImportSheet({
  visible,
  onClose,
  onImportText,
  onImportUrl,
}: {
  visible: boolean;
  onClose: () => void;
  onImportText: (text: string) => Promise<ImportOutcome>;
  onImportUrl: (url: string) => Promise<ImportOutcome>;
}): React.JSX.Element {
  const [mode, setMode] = useState<ImportMode>('paste');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const close = (): void => {
    if (busy) {
      return;
    }
    setInput('');
    setMessage('');
    onClose();
  };

  const submit = async (): Promise<void> => {
    const payload = input.trim();
    if (!payload) {
      setMessage(mode === 'paste' ? '请粘贴规则 JSON' : '请输入规则 URL');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const outcome =
        mode === 'url'
          ? await onImportUrl(payload)
          : await onImportText(payload);
      if (outcome.ok) {
        setInput('');
        setMessage('');
        onClose();
      } else {
        setMessage(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="添加站点" onClose={close} testID="import-sheet">
      <View style={styles.tabs}>
        {(
          [
            ['paste', '粘贴 JSON'],
            ['url', '规则 URL'],
          ] as Array<[ImportMode, string]>
        ).map(([key, label]) => (
          <Pressable
            key={key}
            testID={`import-tab-${key}`}
            onPress={() => {
              setMode(key);
              setMessage('');
            }}
            style={[styles.tab, mode === key && styles.tabActive]}>
            <Text style={[styles.tabText, mode === key && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        testID="import-input"
        value={input}
        onChangeText={setInput}
        editable={!busy}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={
          mode === 'url'
            ? 'https://example.com/rule.json'
            : '{"name": "...", "domain": "..."}'
        }
        placeholderTextColor={theme.textMuted}
        style={[styles.input, mode === 'url' && styles.inputSingle]}
      />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Pressable
        testID="import-submit"
        disabled={busy}
        onPress={submit}
        style={[styles.submit, busy && styles.submitDisabled]}>
        <Text style={styles.submitText}>{busy ? '导入中…' : '导入'}</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: theme.background,
  },
  tabText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.text,
  },
  input: {
    minHeight: 132,
    maxHeight: 240,
    color: theme.text,
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  inputSingle: {
    minHeight: 48,
    maxHeight: 72,
  },
  message: {
    color: theme.danger,
    fontSize: 12,
    marginTop: 10,
  },
  submit: {
    marginTop: 14,
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
