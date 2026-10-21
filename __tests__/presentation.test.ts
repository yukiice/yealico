import { contentState, displayIdCode } from '../src/app/presentation';

test('shows parsed content even when an advisory diagnostic is present', () => {
  // 阿巴基猫：列表解析出 70 条，同时带一条 search 未实现的提示。
  expect(contentState(70, 'UNSUPPORTED_FEATURE: search is not implemented')).toBe(
    'content',
  );
  expect(contentState(1, '')).toBe('content');
});

test('reports blocked only when nothing was parsed and an error exists', () => {
  expect(contentState(0, 'NEEDS_WEBVIEW: list requires DOM rendering')).toBe(
    'blocked',
  );
});

test('reports empty when nothing was parsed and nothing failed', () => {
  expect(contentState(0, '')).toBe('empty');
});

test('decodes percent-encoded idCode for display', () => {
  expect(displayIdCode('2024/12/01/%e3%82%b5%e3%82%a4%e3%83%88')).toBe(
    '2024/12/01/サイト',
  );
  expect(displayIdCode('50458')).toBe('50458');
});

test('keeps malformed percent sequences untouched', () => {
  expect(displayIdCode('100%')).toBe('100%');
});
