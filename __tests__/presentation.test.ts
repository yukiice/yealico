import { contentState } from '../src/app/presentation';

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
