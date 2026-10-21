import { buildRoutePlan, executeDetail } from '../src/engine';
import type { RuleDocument } from '../src/engine';

const context = {
  baseUrl: 'https://example.test/comic/1',
  domain: 'example.test',
};

test('totalImages expands a picture URL template for each page', () => {
  const rule: RuleDocument = {
    name: 'Synthetic Total Images',
    domain: 'example.test',
    detailRule: {
      totalImages: { selector: 'span.total', function: 'text' },
      pictureRule: {
        item: { selector: '#template' },
        url: {
          selector: 'this',
          function: 'attr',
          param: 'data-template',
        },
      },
    },
  };
  const html = `
    <span class="total">3</span>
    <div id="template" data-template="https://cdn.example.test/page/{page:}.jpg"></div>
  `;

  const result = executeDetail(
    rule,
    buildRoutePlan(rule),
    html,
    context,
  );

  expect(result.fields.totalImages).toBe(3);
  expect(result.pictures).toEqual([
    'https://cdn.example.test/page/1.jpg',
    'https://cdn.example.test/page/2.jpg',
    'https://cdn.example.test/page/3.jpg',
  ]);
  expect(result.diagnostics).toEqual([]);
});

test('totalImages can drive a root-level picture URL without an item selector', () => {
  const rule: RuleDocument = {
    name: 'Synthetic Total Images Root',
    domain: 'example.test',
    detailRule: {
      totalImages: { selector: 'span.total', function: 'text' },
      pictureRule: {
        url: {
          selector: '#template',
          function: 'attr',
          param: 'data-template',
        },
      },
    },
  };
  const html = `
    <span class="total">2</span>
    <div id="template" data-template="/page/{page:}.jpg"></div>
  `;

  const result = executeDetail(
    rule,
    buildRoutePlan(rule),
    html,
    context,
  );

  expect(result.pictures).toEqual([
    'https://example.test/page/1.jpg',
    'https://example.test/page/2.jpg',
  ]);
  expect(result.diagnostics).toEqual([]);
});

test('a {page:} template without totalImages is reported, not emitted literally', () => {
  const rule: RuleDocument = {
    name: 'Synthetic Missing Total Images',
    domain: 'example.test',
    detailRule: {
      pictureRule: {
        item: { selector: '#template' },
        url: {
          selector: 'this',
          function: 'attr',
          param: 'data-template',
        },
      },
    },
  };
  const html = `
    <div id="template" data-template="/page/{page:}.jpg"></div>
  `;

  const result = executeDetail(
    rule,
    buildRoutePlan(rule),
    html,
    context,
  );

  expect(result.pictures).toEqual([]);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fieldPath: 'detailRule.totalImages',
        code: 'MISSING_FIELD',
      }),
    ]),
  );
});
