import {
  canLoadMorePages,
  imageHeaders,
  nextMove,
  nextPageBudget,
  preloadTargets,
  previousMove,
} from '../src/app/ReaderScreen';
import {
  buildRoutePlan,
  executeDetail,
  loadGalleryPages,
} from '../src/engine';
import type { RuleDocument, RuleFetcher } from '../src/engine';

test('moves inside a chapter before crossing to another', () => {
  expect(previousMove(2, 1)).toEqual({ kind: 'image', index: 1 });
  expect(nextMove(1, 4, 1, 3)).toEqual({ kind: 'image', index: 2 });
});

test('crosses chapters only at the chapter boundaries', () => {
  expect(previousMove(0, 1)).toEqual({ kind: 'chapter', chapterIndex: 0 });
  expect(nextMove(3, 4, 1, 3)).toEqual({ kind: 'chapter', chapterIndex: 2 });
});

test('stops at the first and last chapter', () => {
  expect(previousMove(0, 0)).toEqual({ kind: 'none' });
  expect(nextMove(3, 4, 2, 3)).toEqual({ kind: 'none' });
  expect(nextMove(0, 0, 0, 1)).toEqual({ kind: 'none' });
});

test('keeps image navigation when no chapter list is provided', () => {
  expect(previousMove(0, -1)).toEqual({ kind: 'none' });
  expect(nextMove(3, 4, -1, 0)).toEqual({ kind: 'none' });
  expect(nextMove(0, 4, -1, 0)).toEqual({ kind: 'image', index: 1 });
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

test('sends rule headers and falls back to a referer', () => {
  expect(imageHeaders({ name: 'x', domain: 'a.test' }, 'a.test')).toEqual({
    Referer: 'https://a.test/',
  });

  expect(
    imageHeaders(
      { name: 'x', headers: { Referer: 'https://b.test/view' } },
      'a.test',
    ),
  ).toEqual({ Referer: 'https://b.test/view' });

  // 大小写不同也算已有的 Referer，不再覆盖。
  expect(
    imageHeaders(
      { name: 'x', headers: { referer: 'https://c.test/view' } },
      'a.test',
    ),
  ).toEqual({ referer: 'https://c.test/view' });

  expect(
    imageHeaders({ name: 'x', headers: { 'User-Agent': 'UA' } }, ''),
  ).toEqual({ 'User-Agent': 'UA' });
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
