import { defaultPageFor } from '../src/app/SiteWorkspace';
import type { RuleDocument } from '../src/engine';

test('prefers a recent/update page', () => {
  const rule: RuleDocument = {
    name: 'Pages',
    domain: 'example.test',
    pages: [
      { name: '首页' },
      {
        name: '最近更新',
        indexRule: { item: { selector: 'div.item' } },
      },
    ],
  };

  expect(defaultPageFor(rule)).toBe(1);
});

test('falls back to a page with a rule, then index 0', () => {
  const withRule: RuleDocument = {
    name: 'Pages',
    domain: 'example.test',
    pages: [
      { name: '无规则' },
      {
        name: '有规则',
        indexRule: { item: { selector: 'div.item' } },
      },
    ],
  };
  expect(defaultPageFor(withRule)).toBe(1);

  const noRule: RuleDocument = {
    name: 'Pages',
    domain: 'example.test',
    pages: [{ name: '只有页面' }],
  };
  expect(defaultPageFor(noRule)).toBe(0);
});

test('returns undefined for a site without pages', () => {
  expect(defaultPageFor({ name: 'No Pages', domain: 'example.test' })).toBeUndefined();
});
