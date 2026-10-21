import {
  buildPagePlan,
  buildRoutePlan,
  executeList,
  listRulePages,
  resolveRulePage,
} from '../src/engine';
import type { RuleDocument } from '../src/engine';

const siteRule: RuleDocument = {
  name: 'Synthetic Pages',
  domain: 'example.test',
  displayMode: 'collection',
  indexUrl: 'https://example.test/home/{page:1}',
  detailUrl: 'https://example.test/comic/{idCode:}',
  headers: {
    'x-site': 'site',
    'x-shared': 'site',
  },
  flags: {
    repeatedThumbnail: true,
  },
  indexRule: {
    item: { selector: 'div.default-item' },
    title: { selector: 'a', function: 'text' },
  },
  detailRule: {
    title: { selector: 'h1', function: 'text' },
  },
  pages: [
    {
      pk: 19,
      name: '月排行',
      indexUrl: 'https://example.test/rank/{page:1}',
      displayMode: 'text',
      headers: { 'x-page': 'page', 'x-shared': 'page' },
      indexRule: {
        item: { selector: 'div.rank-item' },
        title: { selector: '.rank-title', function: 'text' },
      },
    },
    {
      pk: 20,
      name: '继承页',
      indexUrl: 'https://example.test/inherit/{page:1}',
      displayMode: 'default',
    },
    {
      pk: 21,
      name: '登录页',
      indexUrl: 'https://example.test/login/{page:1}',
      flags: { loginRequired: true },
    },
  ],
};

test('listRulePages exposes stable indices and names', () => {
  expect(listRulePages(siteRule)).toEqual([
    {
      index: 0,
      name: '月排行',
      pk: 19,
      displayMode: 'text',
    },
    {
      index: 1,
      name: '继承页',
      pk: 20,
      displayMode: 'default',
    },
    {
      index: 2,
      name: '登录页',
      pk: 21,
    },
  ]);
});

test('page selection overrides URLs, rules, flags and headers', () => {
  const resolved = resolveRulePage(siteRule, '月排行');

  expect(resolved.diagnostics).toEqual([]);
  expect(resolved.rule.indexUrl).toBe('https://example.test/rank/{page:1}');
  expect(resolved.rule.indexRule).toEqual(
    expect.objectContaining({
      item: { selector: 'div.rank-item' },
    }),
  );
  expect(resolved.rule.detailRule).toBe(siteRule.detailRule);
  expect(resolved.rule.displayMode).toBe('text');
  expect(resolved.rule.flags).toEqual({ repeatedThumbnail: true });
  expect(resolved.rule.headers).toEqual({
    'x-site': 'site',
    'x-shared': 'page',
    'x-page': 'page',
  });
  expect(resolved.rule.pages).toBeUndefined();
  expect(resolved.rule.selectedPage).toEqual({
    index: 0,
    name: '月排行',
    pk: 19,
  });
});

test('page without rule override inherits site defaults and ignores default mode', () => {
  const resolved = resolveRulePage(siteRule, 1);

  expect(resolved.diagnostics).toEqual([]);
  expect(resolved.rule.indexUrl).toBe('https://example.test/inherit/{page:1}');
  expect(resolved.rule.indexRule).toBe(siteRule.indexRule);
  expect(resolved.rule.displayMode).toBe('collection');
  expect(resolved.rule.flags).toEqual({ repeatedThumbnail: true });
  expect(resolved.rule.headers).toEqual({
    'x-site': 'site',
    'x-shared': 'site',
  });
});

test('buildPagePlan returns the scoped rule and its route plan', () => {
  const built = buildPagePlan(siteRule, '月排行');
  const codes = built.plan.unsupported.map(item => item.code);

  expect(built.rule.indexUrl).toBe('https://example.test/rank/{page:1}');
  expect(built.plan.site.page).toEqual({
    index: 0,
    name: '月排行',
    pk: 19,
  });
  expect(codes).not.toContain('NEEDS_LOGIN');
  expect(codes).not.toContain('UNSUPPORTED_PAGES');
  expect(codes).not.toContain('INVALID_RULE');

  const login = buildPagePlan(siteRule, '登录页');
  expect(login.plan.capabilities.login).toBe(true);
  expect(login.plan.unsupported.map(item => item.code)).toContain('NEEDS_LOGIN');
});

test('site-level plan no longer rejects pages, and page rules execute', () => {
  const plan = buildRoutePlan(siteRule);
  expect(plan.unsupported.map(item => item.code)).not.toContain('UNSUPPORTED_PAGES');

  const built = buildPagePlan(siteRule, '月排行');
  const html = `
    <div class="rank-item">
      <a class="rank-title" href="/comic/1">Rank 1</a>
    </div>
    <div class="default-item">
      <a href="/comic/2">Default</a>
    </div>
  `;
  const result = executeList(built.rule, built.plan, html, {
    baseUrl: 'https://example.test/rank/1',
    page: 1,
    domain: 'example.test',
  });

  expect(result.items).toEqual([{ title: 'Rank 1' }]);
});

test('unknown page is reported instead of silently falling back', () => {
  const resolved = resolveRulePage(siteRule, '不存在');
  expect(resolved.diagnostics).toEqual([
    expect.objectContaining({
      fieldPath: 'pages',
      code: 'MISSING_FIELD',
    }),
  ]);

  const built = buildPagePlan(siteRule, '不存在');
  expect(built.plan.unsupported).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'MISSING_FIELD',
        fieldPath: 'pages',
      }),
    ]),
  );
});
