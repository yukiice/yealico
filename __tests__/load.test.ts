import {
  buildRoutePlan,
  loadGalleryPages,
  loadListPages,
} from '../src/engine';
import type { RuleDocument, RuleFetcher } from '../src/engine';

const listRule: RuleDocument = {
  name: 'Paged List',
  domain: 'example.test',
  indexUrl: 'https://example.test/list/{page:1}',
  indexRule: {
    item: { selector: 'div.item' },
    idCode: { selector: 'a', function: 'attr', param: 'href' },
    title: { selector: 'a', function: 'text' },
  },
};

const galleryRule: RuleDocument = {
  name: 'Paged Gallery',
  domain: 'example.test',
  indexUrl: 'https://example.test/list/1',
  indexRule: {
    item: { selector: 'div.item' },
    idCode: { selector: 'a', function: 'attr', param: 'href' },
    title: { selector: 'a', function: 'text' },
  },
  galleryRule: {
    totalPages: { selector: 'span.total', function: 'text' },
    item: { selector: 'img.page' },
    image: { selector: 'this', function: 'attr', param: 'data-src' },
  },
};

test('loadListPages stops on no new items and preserves order', async () => {
  const bodies: Record<string, string> = {
    'https://example.test/list/1': '<div class="item"><a href="/a">A</a></div>',
    'https://example.test/list/2': '<div class="item"><a href="/b">B</a></div>',
    'https://example.test/list/3': '<div class="item"><a href="/a">A</a></div>',
  };
  const fetcher: RuleFetcher = {
    fetch: async request => ({
      status: 200,
      url: request.url,
      body: bodies[request.url] ?? '',
    }),
  };

  const result = await loadListPages(
    listRule,
    buildRoutePlan(listRule),
    fetcher,
    { baseUrl: 'https://example.test/list/1', page: 1, domain: 'example.test' },
    { maxPages: 3 },
  );

  expect(result.urls).toEqual([
    'https://example.test/list/1',
    'https://example.test/list/2',
    'https://example.test/list/3',
  ]);
  expect(result.items.map(item => item.idCode)).toEqual(['/a', '/b']);
  expect(result.pages).toBe(3);
  expect(result.stopReason).toBe('noNewItems');
});

test('loadGalleryPages reads totalPages then stops on duplicate images', async () => {
  const bodies: Record<string, string> = {
    'https://example.test/photo/123':
      '<span class="total">3</span><img class="page" data-src="/img/1.jpg"><img class="page" data-src="/img/2.jpg">',
    'https://example.test/photo/123?page=2':
      '<img class="page" data-src="/img/3.jpg">',
    'https://example.test/photo/123?page=3':
      '<img class="page" data-src="/img/3.jpg">',
  };
  const fetcher: RuleFetcher = {
    fetch: async request => ({
      status: 200,
      url: request.url,
      body: bodies[request.url] ?? '',
    }),
  };

  const result = await loadGalleryPages(
    galleryRule,
    buildRoutePlan(galleryRule),
    fetcher,
    'https://example.test/photo/123{pageFormat:?page={page:}}',
    { baseUrl: 'https://example.test/photo/123', page: 1, domain: 'example.test' },
    { maxPages: 3 },
  );

  expect(result.totalPages).toBe(3);
  expect(result.images).toEqual([
    'https://example.test/img/1.jpg',
    'https://example.test/img/2.jpg',
    'https://example.test/img/3.jpg',
  ]);
  expect(result.urls).toEqual([
    'https://example.test/photo/123',
    'https://example.test/photo/123?page=2',
    'https://example.test/photo/123?page=3',
  ]);
  expect(result.pages).toBe(3);
  expect(result.stopReason).toBe('noNewItems');
});

test('loadListPages reports HTTP errors and does not silently continue', async () => {
  const fetcher: RuleFetcher = {
    fetch: async request => ({
      status: 500,
      url: request.url,
      body: '',
    }),
  };
  const result = await loadListPages(
    listRule,
    buildRoutePlan(listRule),
    fetcher,
    { baseUrl: 'https://example.test/list/1', page: 1, domain: 'example.test' },
    { maxPages: 1 },
  );

  expect(result.pages).toBe(0);
  expect(result.stopReason).toBe('error');
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: 'NETWORK_ERROR', fieldPath: 'request' }),
  ]);
});

test('network failures keep the target URL in the diagnostic', async () => {
  const fetcher: RuleFetcher = {
    fetch: async () => {
      throw new Error('Network request failed');
    },
  };
  const result = await loadListPages(
    listRule,
    buildRoutePlan(listRule),
    fetcher,
    { baseUrl: 'https://example.test/list/1', page: 1, domain: 'example.test' },
    { maxPages: 1 },
  );

  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: 'NETWORK_ERROR',
      detail: expect.stringContaining('https://example.test/list/1'),
    }),
  ]);
});
