import {
  blockingReasons,
  DebugSession,
  describeCapabilities,
  formatDiagnostic,
  MAX_DEBUG_RECORDS,
  sanitizeText,
  sanitizeUrl,
} from '../src/app/debugReport';
import { buildRoutePlan } from '../src/engine';
import type { Diagnostic, RuleDocument } from '../src/engine';

test('masks sensitive query params and keeps locator params', () => {
  expect(
    sanitizeUrl('https://e.test/list?page=2&token=abc123&keyword=cat'),
  ).toBe('https://e.test/list?page=2&token=***&keyword=cat');

  expect(sanitizeUrl('https://e.test/x?api_key=k&sign=s&sig=g&auth=a')).toBe(
    'https://e.test/x?api_key=***&sign=***&sig=***&auth=***',
  );
});

test('keeps path, hash and non-secret params untouched', () => {
  expect(sanitizeUrl('https://e.test/comic/123/456.html#p=7')).toBe(
    'https://e.test/comic/123/456.html#p=7',
  );
  // 书名号里的 keyword 不是密钥，不能被误伤。
  expect(sanitizeUrl('https://e.test/search?keyword=%E7%8C%AB&page=1')).toBe(
    'https://e.test/search?keyword=%E7%8C%AB&page=1',
  );
  expect(sanitizeUrl('')).toBe('');
});

test('strips userinfo from URLs', () => {
  expect(sanitizeUrl('https://user:pass@e.test/a?page=1')).toBe(
    'https://e.test/a?page=1',
  );
});

test('masks secrets in free text but not business params', () => {
  expect(sanitizeText('fetch https://e.test/a?token=x&page=2 failed')).toBe(
    'fetch https://e.test/a?token=***&page=2 failed',
  );
  expect(sanitizeText('token=abc')).toBe('token=***');
  expect(sanitizeText('idCode=456')).toBe('idCode=456');
});

test('formats a diagnostic with severity, code and field path', () => {
  const diagnostic: Diagnostic = {
    fieldPath: 'galleryRule.image',
    code: 'MISSING_FIELD',
    severity: 'error',
    detail: 'GET https://e.test/g?sign=zzz',
  };
  expect(formatDiagnostic(diagnostic)).toBe(
    'ERROR MISSING_FIELD @ galleryRule.image — GET https://e.test/g?sign=***',
  );

  expect(
    formatDiagnostic({
      fieldPath: 'detailRule.item',
      code: 'EMPTY_RESULT',
      severity: 'warning',
    }),
  ).toBe('WARNING EMPTY_RESULT @ detailRule.item');
});

test('summarizes capabilities as a single line', () => {
  const rule: RuleDocument = {
    name: 'Caps',
    domain: 'example.test',
    flags: { jsNeededDetail: true, charset: 'gbk' },
  };
  const text = describeCapabilities(buildRoutePlan(rule).capabilities);

  expect(text).toContain('static=');
  expect(text).toContain('webview=');
  expect(text).toContain('charset=');
});

test('only error diagnostics block execution', () => {
  const rule: RuleDocument = {
    name: 'Blocked',
    domain: 'example.test',
    indexRule: { item: { selector: 'div' } },
  };
  const plan = buildRoutePlan(rule);
  const blocked = blockingReasons(plan);

  expect(blocked.every(item => item.severity === 'error')).toBe(true);
});

test('keeps the newest records first and caps the session', () => {
  const debug = new DebugSession();
  for (let index = 0; index < MAX_DEBUG_RECORDS + 3; index += 1) {
    debug.record({
      stage: 'list',
      label: `第 ${index} 次`,
      counts: { items: index },
    });
  }

  const records = debug.list();
  expect(records).toHaveLength(MAX_DEBUG_RECORDS);
  expect(records[0].label).toBe(
    `第 ${MAX_DEBUG_RECORDS + 2} 次`,
  );
});

test('records stage counts and both kinds of diagnostics', () => {
  const debug = new DebugSession();
  debug.record({
    stage: 'detail',
    label: '第 2 话',
    counts: { chapters: 2, pictures: 0, urls: 1 },
    diagnostics: [
      { fieldPath: 'a', code: 'EMPTY_RESULT', severity: 'warning' },
      { fieldPath: 'b', code: 'MISSING_FIELD', severity: 'error' },
    ],
    urls: ['https://e.test/d?token=secret'],
  });

  const [record] = debug.list();
  expect(record.stage).toBe('detail');
  expect(record.counts).toEqual({ chapters: 2, pictures: 0, urls: 1 });
  expect(record.diagnostics).toHaveLength(2);
  // 存的是原始地址，展示层才脱敏。
  expect(record.urls[0]).toContain('secret');
  expect(sanitizeUrl(record.urls[0])).toBe('https://e.test/d?token=***');
});

test('list returns copies so callers cannot mutate the session', () => {
  const debug = new DebugSession();
  debug.record({ stage: 'list', counts: { items: 1 } });

  const records = debug.list();
  records[0].counts.items = 99;
  expect(debug.list()[0].counts.items).toBe(1);

  debug.clear();
  expect(debug.list()).toEqual([]);
});
