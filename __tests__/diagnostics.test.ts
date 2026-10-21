import { errorText, friendlyDiagnostic } from '../src/app/diagnostics';
import type { Diagnostic } from '../src/engine';

test('renders the first error diagnostics as one line each', () => {
  const diagnostics: Diagnostic[] = [
    { fieldPath: 'a', code: 'EMPTY_RESULT', severity: 'warning' },
    { fieldPath: 'b', code: 'MISSING_FIELD', severity: 'error' },
    { fieldPath: 'c', code: 'INVALID_RULE', severity: 'error' },
    { fieldPath: 'd', code: 'NEEDS_LOGIN', severity: 'error' },
    { fieldPath: 'e', code: 'NEEDS_CONSENT', severity: 'error' },
  ];

  expect(errorText(diagnostics)).toBe(
    [
      'MISSING_FIELD: b',
      'INVALID_RULE: c',
      'NEEDS_LOGIN: d',
    ].join('\n'),
  );
});

test('returns an empty string when nothing failed', () => {
  expect(
    errorText([{ fieldPath: 'a', code: 'EMPTY_RESULT', severity: 'warning' }]),
  ).toBe('');
});

test('sanitizes image URLs before they reach the screen', () => {
  const diagnostics: Diagnostic[] = [
    {
      fieldPath: 'gallery',
      code: 'NETWORK_ERROR',
      severity: 'error',
      detail:
        'WebView render timed out: https://img.test/a.webp?e=1793771509&m=somwbCWkrsmGioLKBdzZAw',
    },
  ];

  const text = errorText(diagnostics);
  expect(text).toContain('NETWORK_ERROR');
  expect(text).toContain('https://img.test/a.webp?e=1793771509&m=***');
  expect(text).not.toContain('somwbCWkrsmGioLKBdzZAw');
});

test('masks signatures in html-escaped, pipe-joined diagnostics', () => {
  // 真机原样输出：&amp; 分隔符 + `|` 拼接的候选值。
  const detail =
    'https://eu1.test/x.webp?e=1793771509&amp;m=somwbCWkrsmGioLKBdzZAw|mangaFile|mangaBox|';

  expect(errorText([{ fieldPath: 'gallery', code: 'NETWORK_ERROR', severity: 'error', detail }])).toBe(
    'NETWORK_ERROR: https://eu1.test/x.webp?e=1793771509&amp;m=***|mangaFile|mangaBox|',
  );
});

test('explains opaque QR payloads instead of exposing the raw code', () => {
  expect(
    friendlyDiagnostic({
      fieldPath: 'qr',
      code: 'UNSUPPORTED_QR_PAYLOAD',
      detail: 'Yealico QR v2 payload is opaque (64 bytes)',
      severity: 'error',
    }),
  ).toContain('无法离线解码');
});

test('falls back to the raw code for unmapped diagnostics', () => {
  expect(
    friendlyDiagnostic({
      fieldPath: 'name',
      code: 'MISSING_FIELD',
      detail: 'site name is required',
      severity: 'error',
    }),
  ).toBe('MISSING_FIELD: site name is required');
});
