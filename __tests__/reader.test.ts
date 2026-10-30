import {
  canLoadMorePages,
  dominantIndex,
  imageHeaders,
  IMAGE_USER_AGENT,
  nextPageBudget,
  preloadTargets,
} from '../src/app/ReaderScreen';
import {
  buildRoutePlan,
  executeDetail,
  loadGalleryPages,
} from '../src/engine';
import type { RuleDocument, RuleFetcher } from '../src/engine';

test('picks the image that covers the scroll offset', () => {
  const blocks = [
    { y: 0, height: 100 },
    { y: 100, height: 200 },
    { y: 300, height: 150 },
  ];

  expect(dominantIndex(0, blocks)).toBe(0);
  expect(dominantIndex(99, blocks)).toBe(0);
  expect(dominantIndex(100, blocks)).toBe(1);
  expect(dominantIndex(299, blocks)).toBe(1);
  expect(dominantIndex(300, blocks)).toBe(2);
  expect(dominantIndex(9999, blocks)).toBe(2);
});

test('skips images whose layout is not ready', () => {
  const blocks = [
    undefined,
    { y: 0, height: 100 },
    undefined,
    { y: 100, height: 50 },
  ];

  expect(dominantIndex(0, blocks)).toBe(1);
  expect(dominantIndex(120, blocks)).toBe(3);
});

test('falls back to the first laid-out image or index zero', () => {
  expect(dominantIndex(500, [])).toBe(0);
  expect(dominantIndex(500, [undefined, undefined])).toBe(0);
  expect(dominantIndex(500, [undefined, { y: 0, height: 10 }])).toBe(1);
});

test('preloads only the images ahead of the current one', () => {
  const images = ['a', 'b', 'c', 'd'];

  expect(preloadTargets(images, 0)).toEqual(['b', 'c']);
  expect(preloadTargets(images, 2)).toEqual(['d']);
  expect(preloadTargets(images, 3)).toEqual([]);
  expect(preloadTargets(images, 1, 1)).toEqual(['c']);
  expect(preloadTargets(images, 1, 0)).toEqual([]);
});

test('clamps the preload window at both ends', () => {
  expect(preloadTargets([], 0)).toEqual([]);
  expect(preloadTargets(['a', 'b'], -5)).toEqual(['a', 'b']);
  expect(preloadTargets(['a', 'b'], 99)).toEqual([]);
});

test('only offers more pages when the total is known and not reached', () => {
  expect(canLoadMorePages(1, 3)).toBe(true);
  expect(canLoadMorePages(3, 3)).toBe(false);
  expect(canLoadMorePages(4, 3)).toBe(false);
  expect(canLoadMorePages(1, undefined)).toBe(false);
  expect(canLoadMorePages(1, 0)).toBe(false);
});

test('grows the page budget by one step without passing the total', () => {
  expect(nextPageBudget(1, 10)).toBe(5);
  expect(nextPageBudget(8, 10)).toBe(10);
  expect(nextPageBudget(0, 3)).toBe(3);
});

test('sends rule headers and fills browser defaults', () => {
  expect(imageHeaders({ name: 'x', domain: 'a.test' }, 'a.test')).toEqual({
    Referer: 'https://a.test/',
    'User-Agent': IMAGE_USER_AGENT,
    Accept: expect.stringContaining('image/'),
  });

  const customReferer = imageHeaders(
    { name: 'x', headers: { Referer: 'https://b.test/view' } },
    'a.test',
  );
  expect(customReferer.Referer).toBe('https://b.test/view');

  // 大小写不同也算已有的 Referer，不再覆盖。
  const lowerReferer = imageHeaders(
    { name: 'x', headers: { referer: 'https://c.test/view' } },
    'a.test',
  );
  expect(lowerReferer.referer).toBe('https://c.test/view');
  expect(lowerReferer.Referer).toBeUndefined();

  const customUa = imageHeaders(
    { name: 'x', headers: { 'User-Agent': 'UA' } },
    '',
  );
  expect(customUa['User-Agent']).toBe('UA');
  expect(customUa.Referer).toBeUndefined();

  const customAccept = imageHeaders(
    { name: 'x', headers: { Accept: 'image/png' } },
    'a.test',
  );
  expect(customAccept.Accept).toBe('image/png');
});

test('feeds a chapter URL from detail straight into gallery paging', async () => {
  const rule: RuleDocument = {
    name: 'Chapter Reader',
    domain: 'example.test',
    detailUrl: 'https://example.test/comic/{idCode:}/',
    detailRule: {
      title: { selector: 'h1', function: 'text' },
      chapterRule: {
        item: { selector: 'li.ch' },
        title: { selector: 'a', function: 'text' },
        idCode: { selector: 'a', function: 'attr', param: 'data-id' },
        url: { selector: 'a', function: 'attr', param: 'href' },
      },
    },
    galleryRule: {
      totalPages: { selector: 'span.total', function: 'text' },
      item: { selector: 'img.page' },
      image: { selector: 'this', function: 'attr', param: 'src' },
    },
  };
  const plan = buildRoutePlan(rule);
  const detail = executeDetail(
    rule,
    plan,
    '<h1>Demo</h1><li class="ch"><a href="/comic/1/2.html#p={page:1}" data-id="2">第 2 话</a></li>',
    { baseUrl: 'https://example.test/comic/1/', domain: 'example.test' },
  );
  const chapterUrl = detail.chapters[0]?.url;

  // 详情产出的是模板，保留 {page:} 交给图库分页展开。
  expect(chapterUrl).toBe('https://example.test/comic/1/2.html#p={page:1}');

  const bodies: Record<string, string> = {
    'https://example.test/comic/1/2.html#p=1':
      '<span class="total">2</span><img class="page" src="/img/c1-1.jpg">',
    'https://example.test/comic/1/2.html#p=2':
      '<img class="page" src="/img/c1-2.jpg">',
  };
  const fetcher: RuleFetcher = {
    fetch: async request => {
      const body = bodies[request.url];
      return body === undefined
        ? { status: 404, body: 'not found' }
        : { status: 200, url: request.url, body };
    },
  };

  expect(chapterUrl).toBeTruthy();
  const result = await loadGalleryPages(
    rule,
    plan,
    fetcher,
    chapterUrl as string,
    { baseUrl: chapterUrl as string, page: 1, domain: 'example.test' },
    { maxPages: 4 },
  );

  expect(result.pages).toBe(2);
  expect(result.totalPages).toBe(2);
  expect(result.images).toEqual([
    'https://example.test/img/c1-1.jpg',
    'https://example.test/img/c1-2.jpg',
  ]);
  expect(result.stopReason).toBe('complete');
});
