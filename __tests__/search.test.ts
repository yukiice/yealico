import { buildRoutePlan, loadSearch } from '../src/engine';
import type { RuleDocument, RuleFetcher } from '../src/engine';

function searchRule(): RuleDocument {
  return {
    name: 'Search',
    domain: 'example.test',
    searchUrl: 'https://example.test/search?q={keyword:}&page={page:}',
    searchRule: {
      item: { selector: 'li.result' },
      idCode: {
        selector: 'a',
        function: 'attr',
        param: 'href',
        regex: '/comic/(.+)',
        replacement: '$1',
      },
      title: { selector: 'a', function: 'text' },
    },
  };
}

test('loadSearch expands keyword and parses searchRule', async () => {
  const rule = searchRule();
  const requests: string[] = [];
  const fetcher: RuleFetcher = {
    async fetch(request) {
      requests.push(request.url);
      return {
        url: request.url,
        status: 200,
        body:
          '<ul>' +
          '<li class="result"><a href="/comic/a">猫A</a></li>' +
          '<li class="result"><a href="/comic/b">猫B</a></li>' +
          '</ul>',
      };
    },
  };

  const result = await loadSearch(
    rule,
    buildRoutePlan(rule),
    fetcher,
    '猫',
    { baseUrl: 'https://example.test/', domain: 'example.test' },
  );

  expect(requests).toHaveLength(1);
  expect(decodeURIComponent(requests[0])).toContain('q=猫');
  expect(result.items.map(item => item.idCode)).toEqual(['a', 'b']);
  expect(result.items.map(item => item.title)).toEqual(['猫A', '猫B']);
  expect(result.pages).toBe(1);
});

test('loadSearch without searchUrl reports MISSING_FIELD', async () => {
  const rule = searchRule();
  delete (rule as { searchUrl?: string }).searchUrl;
  const fetcher: RuleFetcher = {
    async fetch(request) {
      return { url: request.url, status: 200, body: '' };
    },
  };

  const result = await loadSearch(rule, buildRoutePlan(rule), fetcher, '猫', {
    baseUrl: 'https://example.test/',
    domain: 'example.test',
  });

  expect(result.items).toEqual([]);
  expect(result.diagnostics[0]?.code).toBe('MISSING_FIELD');
});
