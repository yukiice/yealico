import {
  buildGalleryPageUrls,
  buildPageUrls,
  buildRoutePlan,
  executeDetail,
  executeGallery,
  executeList,
} from '../src/engine';
import type { RuleDocument } from '../src/engine';

const rule: RuleDocument = {
  name: 'Synthetic Detail',
  domain: 'example.test',
  indexUrl: 'https://example.test/list/{page:1}',
  detailUrl: 'https://example.test/album/{idCode:}/',
  indexRule: {
    item: { selector: 'div.album' },
    idCode: {
      selector: 'a',
      function: 'attr',
      param: 'href',
      regex: '/album/([^/]+)/',
      replacement: '$1',
    },
    title: { selector: 'a', function: 'text' },
  },
  detailRule: {
    title: { selector: 'h1', function: 'text' },
    chapterRule: {
      item: { selector: '#episodes a' },
      idCode: {
        selector: 'this',
        function: 'attr',
        param: 'href',
        regex: '/photo/(\\d+)',
        replacement: '$1',
      },
      title: { selector: 'this', function: 'text' },
      url: {
        selector: 'this',
        function: 'attr',
        param: 'href',
        regex: '(.+)',
        replacement: '$1{pageFormat:?page={page:}}',
      },
    },
    pictureRule: {
      item: { selector: '.entry-content img' },
      url: { selector: 'this', function: 'attr', param: 'src' },
    },
  },
  galleryRule: {
    totalPages: { selector: 'span.total', function: 'text' },
    item: { selector: 'img.page' },
    image: {
      selector: 'this',
      function: 'attr',
      param: 'data-src',
      absoluteUrl: true,
    },
  },
};

const detailHtml = `
  <h1>Album Title</h1>
  <div class="entry-content"><img src="/img/cover.jpg"></div>
  <div id="episodes">
    <a href="/photo/123">Chapter 1</a>
    <a href="/photo/456">Chapter 2</a>
  </div>
`;

const galleryHtml = `
  <span class="total">3</span>
  <img class="page" data-src="/img/1.jpg">
  <img class="page" data-src="/img/2.jpg">
  <img class="page" data-src="/img/3.jpg">
`;

test('URL fields resolve and attr fallback picks the first non-empty attribute', () => {
  const listRule: RuleDocument = {
    name: 'Synthetic Attr Fallback',
    domain: 'example.test',
    indexUrl: 'https://example.test/list/',
    indexRule: {
      item: { selector: 'div.item' },
      idCode: { selector: 'a', function: 'attr', param: 'href' },
      title: { selector: 'a', function: 'text' },
      cover: {
        selector: 'img',
        function: 'attr',
        param: 'data-original, src',
      },
    },
  };
  const html = `
    <div class="item">
      <a href="/album/1">Album</a>
      <img data-original="/img/large.jpg" src="/img/thumb.jpg">
    </div>
  `;
  const result = executeList(listRule, buildRoutePlan(listRule), html, {
    baseUrl: 'https://example.test/list/',
    domain: 'example.test',
  });

  expect(result.diagnostics).toEqual([]);
  expect(result.items[0].cover).toBe('https://example.test/img/large.jpg');
});

test('executeDetail extracts chapters and preserves pageFormat template', () => {
  const plan = buildRoutePlan(rule);
  const result = executeDetail(rule, plan, detailHtml, {
    baseUrl: 'https://example.test/album/999/',
    domain: 'example.test',
  });

  expect(result.diagnostics).toEqual([]);
  expect(result.fields.title).toBe('Album Title');
  expect(result.chapters).toHaveLength(2);
  expect(result.chapters[0]).toMatchObject({
    idCode: '123',
    title: 'Chapter 1',
    url: 'https://example.test/photo/123{pageFormat:?page={page:}}',
  });
  expect(result.pictures).toEqual(['https://example.test/img/cover.jpg']);
});

test('buildPageUrls expands pageFormat and stops on duplicate', () => {
  const chapter = executeDetail(rule, buildRoutePlan(rule), detailHtml, {
    baseUrl: 'https://example.test/album/999/',
    domain: 'example.test',
  }).chapters[0];

  expect(chapter.url).toBeDefined();
  const pages = buildPageUrls(chapter.url ?? '', {
    baseUrl: 'https://example.test/album/999/',
    domain: 'example.test',
  }, 3);

  expect(pages.urls).toEqual([
    'https://example.test/photo/123',
    'https://example.test/photo/123?page=2',
    'https://example.test/photo/123?page=3',
  ]);
  expect(pages.stopReason).toBe('maxPages');

  const fixed = buildPageUrls('https://example.test/fixed', {
    baseUrl: 'https://example.test/',
    domain: 'example.test',
  }, 3);
  expect(fixed.urls).toEqual(['https://example.test/fixed']);
  expect(fixed.stopReason).toBe('duplicate');
});

test('executeGallery extracts totalPages/images and clamps page URLs', () => {
  const plan = buildRoutePlan(rule);
  const result = executeGallery(rule, plan, galleryHtml, {
    baseUrl: 'https://example.test/photo/123',
    page: 1,
    domain: 'example.test',
  });

  expect(result.diagnostics).toEqual([]);
  expect(result.totalPages).toBe(3);
  expect(result.images).toEqual([
    'https://example.test/img/1.jpg',
    'https://example.test/img/2.jpg',
    'https://example.test/img/3.jpg',
  ]);

  const chapterUrl = 'https://example.test/photo/123{pageFormat:?page={page:}}';
  const pages = buildGalleryPageUrls(chapterUrl, result.totalPages, {
    baseUrl: 'https://example.test/photo/123',
    domain: 'example.test',
  });
  expect(pages.urls).toHaveLength(3);
  expect(pages.urls[1]).toBe('https://example.test/photo/123?page=2');
});
