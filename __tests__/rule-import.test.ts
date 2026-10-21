import fs from 'node:fs';
import path from 'node:path';

import {
  importRuleFromQr,
  importRuleFromUrl,
  importRuleText,
  SiteRepository,
} from '../src/app/ruleImport';
import type { RuleDocument, RuleFetcher } from '../src/engine';

const RULES_DIR = path.join(__dirname, '..', 'artifacts', 'yealico-rules');

function abaJson(): string {
  const name = fs
    .readdirSync(RULES_DIR)
    .find(file => file.startsWith('site-3-') && file.endsWith('.json'));
  if (!name) {
    throw new Error('Aba rule fixture not found');
  }
  return fs.readFileSync(path.join(RULES_DIR, name), 'utf8');
}

const plainRule: RuleDocument = {
  name: 'Plain Site',
  domain: 'example.test',
  indexUrl: 'https://example.test/list/{page:1}',
  indexRule: {
    item: { selector: 'div.item' },
    title: { selector: 'a', function: 'text' },
  },
};

function fetcherFor(body: string, status = 200): RuleFetcher {
  return {
    async fetch() {
      return { status, body, url: 'https://example.test/rule.json' };
    },
  };
}

test('imports an extracted Yealico site and keeps its raw rule', () => {
  const raw = abaJson();
  const result = importRuleText(raw, 'paste');

  expect(result.site).toBeTruthy();
  expect(result.site?.name).toContain('阿巴基猫');
  expect(result.site?.domain).toBe('wc3818290.home.blog');
  expect(result.site?.raw).toBe(raw.trim());
  expect(result.site?.hash).toMatch(/^[0-9a-f]{8}$/);
  expect(result.site?.plan.site.domain).toBe('wc3818290.home.blog');
  expect(result.site?.diagnostics.some(item => item.code === 'INVALID_RULE')).toBe(false);
});

test('imports plain RuleDocument JSON', () => {
  const result = importRuleText(JSON.stringify(plainRule));
  expect(result.site?.name).toBe('Plain Site');
  expect(result.site?.domain).toBe('example.test');
  expect(result.diagnostics.some(item => item.code === 'INVALID_RULE')).toBe(false);
});

test('recognizes Yealico v2 QR as unsupported, not as a site', () => {
  const payload = `Yealico QR Code: v2:${Buffer.alloc(64).toString('base64')}`;
  const result = importRuleText(payload);

  expect(result.site).toBeUndefined();
  expect(result.qr?.kind).toBe('yealico-v2');
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'UNSUPPORTED_QR_PAYLOAD',
        fieldPath: 'qr.payload',
      }),
    ]),
  );
});

test('imports a rule URL and a QR rule URL through the same pipeline', async () => {
  const fromUrl = await importRuleFromUrl(
    'https://example.test/rule.json',
    fetcherFor(JSON.stringify(plainRule)),
  );
  expect(fromUrl.site?.source).toBe('url');
  expect(fromUrl.site?.sourceUrl).toBe('https://example.test/rule.json');

  const fromQr = await importRuleFromQr(
    'https://example.test/rule.json',
    fetcherFor(JSON.stringify(plainRule)),
  );
  expect(fromQr.site?.source).toBe('qr');
  expect(fromQr.site?.name).toBe('Plain Site');
});

test('imports a QR raw JSON payload', async () => {
  const result = await importRuleFromQr(
    JSON.stringify(plainRule),
    fetcherFor('unused'),
  );
  expect(result.site?.name).toBe('Plain Site');
  expect(result.site?.source).toBe('qr');
});

test('repository rejects duplicate sites and supports remove', () => {
  const site = importRuleText(JSON.stringify(plainRule)).site;
  expect(site).toBeTruthy();
  if (!site) {
    return;
  }
  const repository = new SiteRepository();
  expect(repository.add(site).site).toBeTruthy();
  expect(repository.add(site).diagnostics).toEqual([
    expect.objectContaining({ code: 'DUPLICATE_SITE' }),
  ]);
  expect(repository.list()).toHaveLength(1);

  repository.remove(site.id);
  expect(repository.list()).toHaveLength(0);
});

test('rejects invalid JSON and HTTP errors', async () => {
  expect(importRuleText('{not json').diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'INVALID_RULE' })]),
  );
  const result = await importRuleFromUrl(
    'https://example.test/missing.json',
    fetcherFor('missing', 404),
  );
  expect(result.site).toBeUndefined();
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'NETWORK_ERROR' })]),
  );
});

test('http rule URL failures explain the Android cleartext policy', async () => {
  const failing: RuleFetcher = {
    fetch: async () => {
      throw new Error('Network request failed');
    },
  };

  const result = await importRuleFromUrl('http://10.0.2.2:8000/aba.json', failing);

  expect(result.site).toBeUndefined();
  expect(result.diagnostics[0]).toEqual(
    expect.objectContaining({
      code: 'NETWORK_ERROR',
      detail: expect.stringContaining('https://'),
    }),
  );
  expect(result.diagnostics[0].detail).toContain(
    'http://10.0.2.2:8000/aba.json',
  );
});
