import { buildRoutePlan, executeGallery } from '../src/engine';
import type { RuleDocument } from '../src/engine';

/** 漫画柜现行章节页：分页信息在 #pageSelect 的 option 里，最后一个 option 的 value 是总页数。 */
const rule: RuleDocument = {
  name: 'Paged Gallery',
  domain: 'example.test',
  galleryRule: {
    totalPages: {
      selector: '#pageSelect option:last-child',
      function: 'attr',
      param: 'value',
    },
    item: { selector: '#mangaBox img.mangaFile' },
    image: { selector: 'this', function: 'attr', param: 'src' },
  },
};

const plan = buildRoutePlan(rule);

test('reads total pages from the last option value', () => {
  const html = `
    <select id="pageSelect">
      <option value="1">第1页</option>
      <option value="2">第2页</option>
      <option value="18">第18页</option>
    </select>
    <div id="mangaBox"><img class="mangaFile" src="/img/1.jpg"></div>`;

  const result = executeGallery(rule, plan, html, {
    baseUrl: 'https://example.test/comic/1/2.html',
    domain: 'example.test',
  });

  expect(result.totalPages).toBe(18);
  expect(result.images).toEqual(['https://example.test/img/1.jpg']);
});

test('leaves totalPages undefined when the pager is missing', () => {
  const result = executeGallery(
    rule,
    plan,
    '<div id="mangaBox"><img class="mangaFile" src="/img/1.jpg"></div>',
    { baseUrl: 'https://example.test/comic/1/2.html', domain: 'example.test' },
  );

  expect(result.totalPages).toBeUndefined();
  expect(result.images).toHaveLength(1);
});
