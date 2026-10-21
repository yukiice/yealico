import {
  buildRoutePlan,
  loadDetail,
  loadGalleryPages,
} from '../src/engine';
import type { RuleDocument, RuleFetcher } from '../src/engine';

function fetcherFromMap(pages: Record<string, string>): RuleFetcher {
  return {
    async fetch(request) {
      const body = pages[request.url];
      if (body === undefined) {
        return { status: 404, body: 'not found' };
      }
      return {
        url: request.url,
        status: 200,
        body,
      };
    },
  };
}

test('loadDetail follows photoAlbumLink and pictureRule.link in order', async () => {
  const rule: RuleDocument = {
    name: 'Synthetic Detail Loader',
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
        item: { selector: 'div.page-link' },
        link: { selector: 'a', function: 'attr', param: 'href' },
        url: { selector: 'img', function: 'attr', param: 'src' },
      },
    },
  };
  const fetcher = fetcherFromMap({
    'https://example.test/comic/1': `
      <h1>Album Title</h1>
      <a class="chapters" href="/album/1/chapters">Chapters</a>
    `,
    'https://example.test/album/1/chapters': `
      <div id="chapters"><a href="/photo/123">Chapter 1</a></div>
      <div class="page-link"><a href="/viewer/1"></a></div>
      <div class="page-link"><a href="/viewer/2"></a></div>
    `,
    'https://example.test/viewer/1': '<img src="/img/page-1.jpg">',
    'https://example.test/viewer/2': '<img src="/img/page-2.jpg">',
  });

  const result = await loadDetail(
    rule,
    buildRoutePlan(rule),
    fetcher,
    'https://example.test/comic/1',
    { baseUrl: 'https://example.test/', domain: 'example.test' },
  );

  expect(result.fields.title).toBe('Album Title');
  expect(result.photoAlbumUrl).toBe(
    'https://example.test/album/1/chapters',
  );
  expect(result.chapters).toEqual([
    expect.objectContaining({
      idCode: '123',
      title: 'Chapter 1',
      url: 'https://example.test/photo/123',
    }),
  ]);
  expect(result.pictures).toEqual([
    'https://example.test/img/page-1.jpg',
    'https://example.test/img/page-2.jpg',
  ]);
  expect(result.urls).toEqual([
    'https://example.test/comic/1',
    'https://example.test/album/1/chapters',
    'https://example.test/viewer/1',
    'https://example.test/viewer/2',
  ]);
  expect(result.diagnostics).toEqual([]);
  expect(result.stopReason).toBe('complete');
});

test('loadGalleryPages follows a per-page second-level viewer URL', async () => {
  const rule: RuleDocument = {
    name: 'Synthetic Gallery Loader',
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
  const template =
    'https://example.test/gallery/1{pageFormat:?page={page:}}';
  const fetcher = fetcherFromMap({
    'https://example.test/gallery/1': `
      <div id="viewer" data-url="/viewer/1"></div>
    `,
    'https://example.test/viewer/1': `
      <span class="total">2</span>
      <img class="page" src="/img/page-1.jpg">
    `,
    'https://example.test/gallery/1?page=2': `
      <div id="viewer" data-url="/viewer/2"></div>
    `,
    'https://example.test/viewer/2': `
      <span class="total">2</span>
      <img class="page" src="/img/page-2.jpg">
    `,
  });

  const result = await loadGalleryPages(
    rule,
    buildRoutePlan(rule),
    fetcher,
    template,
    { baseUrl: 'https://example.test/', domain: 'example.test' },
  );

  expect(result.pages).toBe(2);
  expect(result.totalPages).toBe(2);
  expect(result.images).toEqual([
    'https://example.test/img/page-1.jpg',
    'https://example.test/img/page-2.jpg',
  ]);
  expect(result.urls).toEqual([
    'https://example.test/gallery/1',
    'https://example.test/viewer/1',
    'https://example.test/gallery/1?page=2',
    'https://example.test/viewer/2',
  ]);
  expect(result.secondLevelUrl).toBe('https://example.test/viewer/1');
  expect(result.diagnostics).toEqual([]);
  expect(result.stopReason).toBe('complete');
});
