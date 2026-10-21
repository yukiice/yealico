import {
  buildRoutePlan,
  executeDetail,
  executeGallery,
  executePicturePage,
} from '../src/engine';
import type { RuleDocument } from '../src/engine';

const context = {
  baseUrl: 'https://example.test/comic/1',
  domain: 'example.test',
};

const detailRule: RuleDocument = {
  name: 'Synthetic Second Level Detail',
  domain: 'example.test',
  detailUrl: 'https://example.test/comic/{idCode:}',
  detailRule: {
    title: { selector: 'h1', function: 'text' },
    photoAlbumLink: {
      selector: 'a.chapters',
      function: 'attr',
      param: 'href',
    },
    chapterRule: {
      item: { selector: '#chapters a' },
      idCode: {
        selector: 'this',
        function: 'attr',
        param: 'href',
        regex: '/photo/(\\d+)',
        replacement: '$1',
      },
      title: { selector: 'this', function: 'text' },
      url: { selector: 'this', function: 'attr', param: 'href' },
    },
    pictureRule: {
      item: { selector: '#pictures img' },
      url: { selector: 'this', function: 'attr', param: 'src' },
    },
  },
};

test('photoAlbumLink reports the secondary URL instead of parsing the wrong page', () => {
  const primary = `
    <h1>Album Title</h1>
    <a class="chapters" href="/album/1/chapters">Chapters</a>
    <div id="pictures"><img src="/wrong.jpg"></div>
  `;
  const result = executeDetail(detailRule, buildRoutePlan(detailRule), primary, context);

  expect(result.fields.title).toBe('Album Title');
  expect(result.photoAlbumUrl).toBe('https://example.test/album/1/chapters');
  expect(result.chapters).toEqual([]);
  expect(result.pictures).toEqual([]);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fieldPath: 'detailRule.photoAlbumLink',
        code: 'SECOND_LEVEL_REQUIRED',
      }),
    ]),
  );
});

test('photoAlbumLink uses secondary content for chapters/pictures but keeps detail fields', () => {
  const primary = `
    <h1>Album Title</h1>
    <a class="chapters" href="/album/1/chapters">Chapters</a>
  `;
  const secondary = `
    <div id="chapters"><a href="/photo/123">Chapter 1</a></div>
    <div id="pictures"><img src="/img/cover.jpg"></div>
  `;
  const result = executeDetail(
    detailRule,
    buildRoutePlan(detailRule),
    primary,
    context,
    {
      secondaryContent: secondary,
      secondaryUrl: 'https://example.test/album/1/chapters',
    },
  );

  expect(result.fields.title).toBe('Album Title');
  expect(result.photoAlbumUrl).toBe('https://example.test/album/1/chapters');
  expect(result.chapters).toEqual([
    expect.objectContaining({
      idCode: '123',
      title: 'Chapter 1',
      url: 'https://example.test/photo/123',
    }),
  ]);
  expect(result.pictures).toEqual(['https://example.test/img/cover.jpg']);
  expect(result.diagnostics).toEqual([]);
});

test('pictureRule.link returns links and the link page can be parsed separately', () => {
  const rule: RuleDocument = {
    name: 'Synthetic Picture Links',
    domain: 'example.test',
    detailRule: {
      pictureRule: {
        item: { selector: 'div.page-link' },
        link: { selector: 'a', function: 'attr', param: 'href' },
        url: { selector: 'img', function: 'attr', param: 'src' },
      },
    },
  };
  const detailHtml = `
    <div class="page-link"><a href="/viewer/1"></a></div>
    <div class="page-link"><a href="/viewer/2"></a></div>
  `;
  const detail = executeDetail(
    rule,
    buildRoutePlan(rule),
    detailHtml,
    context,
  );

  expect(detail.pictures).toEqual([]);
  expect(detail.pictureLinks).toEqual([
    'https://example.test/viewer/1',
    'https://example.test/viewer/2',
  ]);

  const page = executePicturePage(
    rule,
    buildRoutePlan(rule),
    '<img src="/img/page-1.jpg">',
    { baseUrl: 'https://example.test/viewer/1', domain: 'example.test' },
  );
  expect(page.pictures).toEqual(['https://example.test/img/page-1.jpg']);
  expect(page.diagnostics).toEqual([]);
});

const galleryRule: RuleDocument = {
  name: 'Synthetic Second Level Gallery',
  domain: 'example.test',
  galleryRule: {
    secondLevelPageUrl: {
      selector: '#viewer',
      function: 'attr',
      param: 'data-url',
    },
    totalPages: { selector: 'span.total', function: 'text' },
    item: { selector: 'img.page' },
    image: { selector: 'this', function: 'attr', param: 'src' },
  },
};

test('gallery secondLevelPageUrl requires a secondary fetch and then extracts images', () => {
  const primary = '<div id="viewer" data-url="/viewer/1"></div>';
  const first = executeGallery(
    galleryRule,
    buildRoutePlan(galleryRule),
    primary,
    context,
  );

  expect(first.secondLevelUrl).toBe('https://example.test/viewer/1');
  expect(first.images).toEqual([]);
  expect(first.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fieldPath: 'galleryRule.secondLevelPageUrl',
        code: 'SECOND_LEVEL_REQUIRED',
      }),
    ]),
  );

  const secondary = `
    <span class="total">2</span>
    <img class="page" src="/img/page-1.jpg">
  `;
  const result = executeGallery(
    galleryRule,
    buildRoutePlan(galleryRule),
    primary,
    context,
    {
      secondaryContent: secondary,
      secondaryUrl: 'https://example.test/viewer/1',
    },
  );

  expect(result.secondLevelUrl).toBe('https://example.test/viewer/1');
  expect(result.totalPages).toBe(2);
  expect(result.images).toEqual(['https://example.test/img/page-1.jpg']);
  expect(result.diagnostics).toEqual([]);
});
