import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyRegex,
  buildRoutePlan,
  executeGallery,
  executeList,
  expandUrl,
  loadGalleryPages,
  parseFunctionChain,
  queryJsonPath,
  resolveUrl,
  validateJsonPath,
} from '../src/engine';
import type { RuleDocument, RuleFetcher, RuleRequest } from '../src/engine';

function fixture(...parts: string[]): string {
  return readFileSync(
    join(__dirname, '..', 'docs', 'rules', 'samples', ...parts),
    'utf8',
  );
}

describe('P1 golden fixtures', () => {
  test('list: CSS + attr/text + regex + relative url', () => {
    const rule = JSON.parse(fixture('synthetic-list', 'rule.json')) as RuleDocument;
    const expected = JSON.parse(fixture('synthetic-list', 'expected.json')) as {
      baseUrl: string;
      items: unknown;
    };
    const plan = buildRoutePlan(rule);

    expect(plan.capabilities.static).toBe(true);
    expect(plan.unsupported).toEqual([]);

    const result = executeList(rule, plan, fixture('synthetic-list', 'page.html'), {
      baseUrl: expected.baseUrl,
      page: 1,
      domain: rule.domain,
    });

    expect(result.items).toEqual(expected.items);
    expect(result.diagnostics).toEqual([]);
  });

  test('gallery: GalleryRule + totalPages + absolute image urls', () => {
    const rule = JSON.parse(fixture('synthetic-gallery', 'rule.json')) as RuleDocument;
    const expected = JSON.parse(fixture('synthetic-gallery', 'expected.json')) as {
      baseUrl: string;
      totalPages: number;
      images: string[];
    };
    const plan = buildRoutePlan(rule);

    const result = executeGallery(
      rule,
      plan,
      fixture('synthetic-gallery', 'page.html'),
      {
        baseUrl: expected.baseUrl,
        page: 1,
        domain: rule.domain,
      },
    );

    expect(result.totalPages).toBe(expected.totalPages);
    expect(result.images).toEqual(expected.images);
    expect(result.diagnostics).toEqual([]);
  });

  test('json: JSONPath subset + this/text', () => {
    const rule = JSON.parse(fixture('synthetic-json', 'rule.json')) as RuleDocument;
    const expected = JSON.parse(fixture('synthetic-json', 'expected.json')) as {
      baseUrl: string;
      items: unknown;
    };
    const plan = buildRoutePlan(rule);

    const result = executeList(
      rule,
      plan,
      fixture('synthetic-json', 'response.json'),
      {
        baseUrl: expected.baseUrl,
        page: 1,
        domain: rule.domain,
      },
    );

    expect(result.items).toEqual(expected.items);
    expect(result.diagnostics).toEqual([]);
  });

  test('unsupported: capabilities and structured diagnostics', () => {
    const rule = JSON.parse(
      fixture('synthetic-unsupported', 'rule.json'),
    ) as RuleDocument;
    const expected = JSON.parse(
      fixture('synthetic-unsupported', 'expected-plan.json'),
    ) as {
      capabilities: Record<string, unknown>;
      unsupported: Array<{ code: string; fieldPath: string }>;
    };

    const plan = buildRoutePlan(rule);

    expect(plan.capabilities).toEqual(expected.capabilities);
    expect(
      plan.unsupported.map(item => `${item.code}:${item.fieldPath}`).sort(),
    ).toEqual(
      expected.unsupported.map(item => `${item.code}:${item.fieldPath}`).sort(),
    );
  });

  test('search/series are warnings, not blocking errors', () => {
    const rule = {
      name: 'optional-capabilities',
      domain: 'example.test',
      indexUrl: 'https://{domain:}/list/{page:}',
      searchUrl: 'https://{domain:}/s/{keyword:}',
      seriesRule: { title: { selector: 'h2' } },
      indexRule: { item: { selector: 'li' } },
    } as RuleDocument;

    const plan = buildRoutePlan(rule);
    const optional = plan.unsupported.filter(
      item =>
        item.code === 'UNSUPPORTED_FEATURE' ||
        item.code === 'UNSUPPORTED_SERIES',
    );

    expect(optional.map(item => item.fieldPath).sort()).toEqual([
      'searchUrl',
      'seriesRule',
    ]);
    expect(optional.every(item => item.severity === 'warning')).toBe(true);
  });

  test('jsNeeded flags are warnings because the webview renderer exists', () => {
    const rule = JSON.parse(
      fixture('synthetic-unsupported', 'rule.json'),
    ) as RuleDocument;

    const plan = buildRoutePlan(rule);
    const webview = plan.unsupported.filter(
      item => item.code === 'NEEDS_WEBVIEW',
    );

    expect(webview.length).toBeGreaterThan(0);
    expect(webview.every(item => item.severity === 'warning')).toBe(true);
    expect(plan.capabilities.webview).toBe(true);
  });
});

describe('URL placeholders', () => {
  test('page and pageFormat', () => {
    expect(
      expandUrl('https://example.test/list/{page:1}', {
        baseUrl: 'https://example.test/list/1',
        page: 1,
      }).url,
    ).toBe('https://example.test/list/1');

    expect(
      expandUrl('https://example.test/list/{page:2:2}', {
        baseUrl: 'https://example.test/list/2',
        page: 3,
      }).url,
    ).toBe('https://example.test/list/6');

    const template = 'https://example.test/list{pageFormat:/page/{page:1}}';
    expect(
      expandUrl(template, {
        baseUrl: 'https://example.test/list',
        page: 1,
      }).url,
    ).toBe('https://example.test/list');
    expect(
      expandUrl(template, {
        baseUrl: 'https://example.test/list',
        page: 2,
      }).url,
    ).toBe('https://example.test/list/page/2');
  });

  test('urlPath, urlQuery and scheme/host/port', () => {
    const context = {
      baseUrl: 'https://example.test/v1/api/list/detail?id=100&lang=en',
      page: 1,
    };

    expect(expandUrl('{urlPath:0}', context).url).toBe('example.test');
    expect(expandUrl('{urlPath:1}', context).url).toBe('v1');
    expect(expandUrl('{urlPath:-1}', context).url).toBe('detail');
    expect(expandUrl('{urlPath:*}', context).url).toBe('v1/api/list/detail');
    expect(expandUrl('{urlQuery:id}', context).url).toBe('100');
    expect(expandUrl('{urlQuery:missing|fallback}', context).url).toBe('fallback');
    expect(expandUrl('{urlScheme}://{urlHost}', context).url).toBe(
      'https://example.test',
    );
  });

  test('{json:...} forces POST and keeps nested braces', () => {
    const result = expandUrl('https://example.test/api{json:{"a":{"b":1}}}', {
      baseUrl: 'https://example.test/api',
    });
    expect(result.url).toBe('https://example.test/api');
    expect(result.method).toBe('POST');
    expect(result.body).toBe('{"a":{"b":1}}');
    expect(result.diagnostics).toEqual([]);
  });

  test('unknown placeholder is reported, not silently dropped', () => {
    const result = expandUrl('https://example.test/{unknown:}', {
      baseUrl: 'https://example.test/',
    });
    expect(result.url).toBe('https://example.test/');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_PLACEHOLDER',
        fieldPath: 'url.unknown',
      }),
    ]);
  });
});

describe('selector semantics', () => {
  test('function chain uses dot and rejects unconfirmed comma syntax', () => {
    expect(parseFunctionChain('text')).toEqual(['text']);
    expect(parseFunctionChain('decodeBase64.reversed')).toEqual([
      'decodeBase64',
      'reversed',
    ]);
    expect(parseFunctionChain('replace("a", with: "b")')).toEqual([
      'replace("a", with: "b")',
    ]);
    expect(() => parseFunctionChain('text,html')).toThrow(
      'comma-separated function chains',
    );
  });

  test('regex replacement, source fallback and arithmetic', () => {
    expect(
      applyRegex('4.5 / 5', {
        selector: 'span.rating',
        regex: '([0-9.]+)',
        replacement: '$1',
      }),
    ).toBe('4.5');
    expect(
      applyRegex('abc', {
        selector: 'span.rating',
        regex: '(x)',
        replacement: '$1',
      }),
    ).toBe('');
    expect(
      applyRegex('abc', {
        selector: 'span.rating',
        regex: '(x)',
        replacement: '|{source:}',
      }),
    ).toBe('abc');
    expect(
      applyRegex('4.5', {
        selector: 'span.rating',
        regex: '([0-9.]+)',
        replacement: '$1 * 2',
      }),
    ).toBe('9');
  });

  test('restricted JSONPath accepts paths but rejects filters and descent', () => {
    const data = { data: { titles: ['一', '二'] } };
    expect(queryJsonPath(data, '$.data.titles[*]')).toEqual(['一', '二']);
    expect(queryJsonPath(data, '$.data.titles[1]')).toEqual(['二']);
    expect(validateJsonPath('$..titles')).not.toBeNull();
    expect(validateJsonPath('$[?(@.id)]')).not.toBeNull();
  });

  test('relative url is resolved against the page url', () => {
    expect(resolveUrl('../img/a-1-large.jpg', 'https://example.test/list/1')).toBe(
      'https://example.test/img/a-1-large.jpg',
    );
    expect(resolveUrl('/img/a-2-large.jpg', 'https://example.test/list/1')).toBe(
      'https://example.test/img/a-2-large.jpg',
    );
  });

  test('JSONPath item pointing at an array expands into multiple items', () => {
    const rule: RuleDocument = {
      name: 'JSON list',
      domain: 'example.test',
      indexRule: {
        item: { selector: '$.Items' },
        title: { selector: '$.Title' },
      },
    };
    const result = executeList(
      rule,
      buildRoutePlan(rule),
      JSON.stringify({ Items: [{ Title: 'A' }, { Title: 'B' }] }),
      { baseUrl: 'https://example.test/', domain: 'example.test' },
    );
    expect(result.items.map(item => item.title)).toEqual(['A', 'B']);
  });

  test('$1|{source:} keeps $1 on match and falls back to source on miss', () => {
    const spec = {
      selector: 'span.title',
      regex: '(.+?)\\s*[（(]\\d+P[）)]',
      replacement: '$1|{source:}',
    };
    expect(applyRegex('第5話 試看 （19P）', spec)).toBe('第5話 試看');
    expect(applyRegex('第4話 試看 (20P)', spec)).toBe('第4話 試看');
    expect(applyRegex('特別篇', spec)).toBe('特別篇');
  });

  test('galleryRule.httpHeaders is merged into the gallery request', async () => {
    const rule: RuleDocument = {
      name: 'Gallery headers',
      domain: 'example.test',
      galleryRule: {
        item: { selector: '#cp_img>img' },
        image: { selector: 'this', function: 'attr', param: 'src' },
        httpHeaders:
          '{"User-Agent":"iPhone UA","Referer":"https://example.test/"}',
      },
    };
    const requests: RuleRequest[] = [];
    const fetcher: RuleFetcher = {
      async fetch(request) {
        requests.push(request);
        return {
          url: request.url,
          status: 200,
          body: '<div id="cp_img"><img src="/1.jpg"></div>',
        };
      },
    };

    await loadGalleryPages(
      rule,
      buildRoutePlan(rule),
      fetcher,
      'https://example.test/m1/',
      { baseUrl: 'https://example.test/', domain: 'example.test' },
    );

    expect(requests[0]?.headers['User-Agent']).toBe('iPhone UA');
    expect(requests[0]?.headers.Referer).toBe('https://example.test/');
  });
});
