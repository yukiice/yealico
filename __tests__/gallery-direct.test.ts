import fs from 'node:fs';
import path from 'node:path';

import {
  buildRoutePlan,
  executeGallery,
  toRuleDocument,
} from '../src/engine';
import type { ExtractedYealicoSite, RuleDocument } from '../src/engine';

const context = {
  baseUrl: 'https://example.test/manga/1',
  domain: 'example.test',
};

test('GalleryRule without item treats image selector as the image collection', () => {
  const rule: RuleDocument = {
    name: 'Synthetic Direct Gallery',
    domain: 'example.test',
    galleryRule: {
      totalPages: { selector: 'span.total', function: 'text' },
      image: { selector: '#manga > img' },
    },
  };
  const html = `
    <span class="total">3</span>
    <div id="manga">
      <img src="/img/1.jpg">
      <img data-src="/img/2.jpg">
      <img data-original="/img/3.jpg">
    </div>
  `;

  const result = executeGallery(rule, buildRoutePlan(rule), html, context);

  expect(result.totalPages).toBe(3);
  expect(result.images).toEqual([
    'https://example.test/img/1.jpg',
    'https://example.test/img/2.jpg',
    'https://example.test/img/3.jpg',
  ]);
  expect(result.diagnostics).toEqual([]);
});

test('direct image collection honors an explicit function/param', () => {
  const rule: RuleDocument = {
    name: 'Synthetic Direct Gallery Attr',
    domain: 'example.test',
    galleryRule: {
      image: {
        selector: '#manga > img',
        function: 'attr',
        param: 'data-src',
      },
    },
  };
  const html = `
    <div id="manga">
      <img src="/fallback.jpg" data-src="/preferred.jpg">
    </div>
  `;

  const result = executeGallery(rule, buildRoutePlan(rule), html, context);

  expect(result.images).toEqual(['https://example.test/preferred.jpg']);
});

const RULES_DIR = path.join(__dirname, '..', 'artifacts', 'yealico-rules');

test('site-6 漫画柜 direct image shape works offline', () => {
  const name = fs
    .readdirSync(RULES_DIR)
    .find(file => file.startsWith('site-6-') && file.endsWith('.json'));
  if (!name) {
    return;
  }
  const extracted = JSON.parse(
    fs.readFileSync(path.join(RULES_DIR, name), 'utf8'),
  ) as ExtractedYealicoSite;
  const fullRule = toRuleDocument(extracted);
  // 只取 galleryRule，避免 jsNeededDetail 让 RoutePlan 阻断整个图库测试。
  const rule: RuleDocument = {
    name: fullRule.name,
    domain: fullRule.domain,
    galleryRule: fullRule.galleryRule,
  };
  // 现行章节页：图片在 #mangaBox img.mangaFile，总页数是 #pageSelect 最后一个 option 的 value。
  const options = Array.from(
    { length: 12 },
    (_, index) => `<option value="${index + 1}">第${index + 1}页</option>`,
  ).join('');
  const html = `
    <select id="pageSelect">${options}</select>
    <div id="mangaBox">
      <img class="mangaFile" src="/img/page-1.jpg">
      <img class="mangaFile" src="/img/page-2.jpg">
    </div>
  `;

  const result = executeGallery(
    rule,
    buildRoutePlan(rule),
    html,
    { ...context, domain: fullRule.domain },
  );

  expect(result.totalPages).toBe(12);
  expect(result.images).toEqual([
    'https://example.test/img/page-1.jpg',
    'https://example.test/img/page-2.jpg',
  ]);
  expect(result.diagnostics).toEqual([]);
});
