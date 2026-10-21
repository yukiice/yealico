import { executeDetail, executeGallery, executeList } from './execute';
import { FIXTURE_JSON } from './fixtures.generated';
import { buildPagePlan, buildRoutePlan } from './plan';
import { parseQrPayload } from './qr';
import type { Diagnostic, RuleDocument } from './types';

/**
 * Android 上的同一组 golden test。
 *
 * 约束：这里不读文件、不发网络；输入全部来自 fixtures.generated.ts，
 * 与 Node 测试使用同一份字节。返回结构化结果，由调试页渲染。
 */

export interface SelftestResult {
  name: string;
  ok: boolean;
  detail: string;
}

function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      return Object.keys(current as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((accumulator, key) => {
          accumulator[key] = (current as Record<string, unknown>)[key];
          return accumulator;
        }, {});
    }
    return current;
  });
}

function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics
    .map(item => `${item.code}:${item.fieldPath}`)
    .sort();
}

function compare(name: string, actual: unknown, expected: unknown): SelftestResult {
  const actualText = stable(actual);
  const expectedText = stable(expected);
  return {
    name,
    ok: actualText === expectedText,
    detail:
      actualText === expectedText
        ? expectedText
        : `actual=${actualText}\nexpected=${expectedText}`,
  };
}

export function runSelftest(): SelftestResult[] {
  const results: SelftestResult[] = [];

  {
    const rule = parse<RuleDocument>(FIXTURE_JSON.list.rule);
    const expected = parse<{ baseUrl: string; items: unknown }>(
      FIXTURE_JSON.list.expected,
    );
    const plan = buildRoutePlan(rule);
    const actual = executeList(rule, plan, FIXTURE_JSON.list.html, {
      baseUrl: expected.baseUrl,
      page: 1,
      domain: rule.domain,
    });
    results.push(compare('list: items', actual.items, expected.items));
    results.push(
      compare('list: no blocking diagnostics', codes(actual.diagnostics), []),
    );
  }

  {
    const rule = parse<RuleDocument>(FIXTURE_JSON.gallery.rule);
    const expected = parse<{
      baseUrl: string;
      totalPages: number;
      images: string[];
    }>(FIXTURE_JSON.gallery.expected);
    const plan = buildRoutePlan(rule);
    const actual = executeGallery(rule, plan, FIXTURE_JSON.gallery.html, {
      baseUrl: expected.baseUrl,
      page: 1,
      domain: rule.domain,
    });
    results.push(compare('gallery: totalPages', actual.totalPages, expected.totalPages));
    results.push(compare('gallery: images', actual.images, expected.images));
  }

  {
    const rule = parse<RuleDocument>(FIXTURE_JSON.json.rule);
    const expected = parse<{ baseUrl: string; items: unknown }>(
      FIXTURE_JSON.json.expected,
    );
    const plan = buildRoutePlan(rule);
    const actual = executeList(rule, plan, FIXTURE_JSON.json.html, {
      baseUrl: expected.baseUrl,
      page: 1,
      domain: rule.domain,
    });
    results.push(compare('json: items', actual.items, expected.items));
  }

  {
    const rule = parse<RuleDocument>(FIXTURE_JSON.unsupported.rule);
    const expected = parse<{
      capabilities: Record<string, unknown>;
      unsupported: Array<{ code: string; fieldPath: string }>;
    }>(FIXTURE_JSON.unsupported.expected);
    const plan = buildRoutePlan(rule);
    results.push(
      compare('unsupported: capabilities', plan.capabilities, expected.capabilities),
    );
    results.push(
      compare(
        'unsupported: diagnostics',
        codes(plan.unsupported),
        expected.unsupported.map(item => `${item.code}:${item.fieldPath}`).sort(),
      ),
    );
  }

  {
    const payload = parseQrPayload(FIXTURE_JSON.qr.payload);
    results.push(compare('qr: Yealico v2 recognized', payload.kind, 'yealico-v2'));
    results.push(compare('qr: v2 payload bytes', payload.bytes, 64));
    results.push(
      compare(
        'qr: v2 requires rule json/url',
        payload.diagnostics[0]?.code,
        'UNSUPPORTED_QR_PAYLOAD',
      ),
    );
  }

  {
    const rule: RuleDocument = {
      name: 'Synthetic Pages',
      domain: 'example.test',
      indexUrl: 'https://example.test/default/{page:1}',
      indexRule: {
        item: { selector: 'div.default' },
        title: { selector: 'a', function: 'text' },
      },
      pages: [
        {
          name: '排行',
          indexUrl: 'https://example.test/rank/{page:1}',
          indexRule: {
            item: { selector: 'div.rank' },
            title: { selector: '.title', function: 'text' },
          },
        },
      ],
    };
    const built = buildPagePlan(rule, '排行');
    const actual = executeList(
      built.rule,
      built.plan,
      '<div class="rank"><a class="title">Rank 1</a></div>',
      { baseUrl: 'https://example.test/rank/1', page: 1, domain: rule.domain },
    );
    results.push(compare('pages: selected url', built.rule.indexUrl, rule.pages?.[0].indexUrl));
    results.push(compare('pages: page rule items', actual.items, [{ title: 'Rank 1' }]));
  }

  {
    const rule: RuleDocument = {
      name: 'Synthetic Total Images',
      domain: 'example.test',
      detailRule: {
        totalImages: { selector: 'span.total', function: 'text' },
        pictureRule: {
          item: { selector: '#template' },
          url: { selector: 'this', function: 'attr', param: 'data-template' },
        },
      },
    };
    const actual = executeDetail(
      rule,
      buildRoutePlan(rule),
      '<span class="total">2</span><div id="template" data-template="/page/{page:}.jpg"></div>',
      { baseUrl: 'https://example.test/comic/1', domain: rule.domain },
    );
    results.push(
      compare('totalImages: expanded pictures', actual.pictures, [
        'https://example.test/page/1.jpg',
        'https://example.test/page/2.jpg',
      ]),
    );
  }

  return results;
}

export interface BenchmarkResult {
  name: string;
  iterations: number;
  avgMs: number;
  maxMs: number;
  chars: number;
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/**
 * 设备端解析基准。
 *
 * 只测合成 fixture，目的是建立 Node/Hermes 的可比基线，
 * 不代表真实页面大小或网络耗时。字符数使用 UTF-16 code unit 计数。
 */
export function runBenchmark(iterations = 20): BenchmarkResult[] {
  const listRule = parse<RuleDocument>(FIXTURE_JSON.list.rule);
  const listExpected = parse<{ baseUrl: string }>(FIXTURE_JSON.list.expected);
  const galleryRule = parse<RuleDocument>(FIXTURE_JSON.gallery.rule);
  const galleryExpected = parse<{ baseUrl: string }>(FIXTURE_JSON.gallery.expected);
  const jsonRule = parse<RuleDocument>(FIXTURE_JSON.json.rule);
  const jsonExpected = parse<{ baseUrl: string }>(FIXTURE_JSON.json.expected);

  const cases: Array<{
    name: string;
    rule: RuleDocument;
    content: string;
    baseUrl: string;
    kind: 'list' | 'gallery';
  }> = [
    {
      name: 'list',
      rule: listRule,
      content: FIXTURE_JSON.list.html,
      baseUrl: listExpected.baseUrl,
      kind: 'list',
    },
    {
      name: 'gallery',
      rule: galleryRule,
      content: FIXTURE_JSON.gallery.html,
      baseUrl: galleryExpected.baseUrl,
      kind: 'gallery',
    },
    {
      name: 'json',
      rule: jsonRule,
      content: FIXTURE_JSON.json.html,
      baseUrl: jsonExpected.baseUrl,
      kind: 'list',
    },
  ];

  return cases.map(entry => {
    const plan = buildRoutePlan(entry.rule);
    const run = () => {
      if (entry.kind === 'gallery') {
        executeGallery(entry.rule, plan, entry.content, {
          baseUrl: entry.baseUrl,
          page: 1,
          domain: entry.rule.domain,
        });
      } else {
        executeList(entry.rule, plan, entry.content, {
          baseUrl: entry.baseUrl,
          page: 1,
          domain: entry.rule.domain,
        });
      }
    };

    run();
    let maxMs = 0;
    const totalStart = nowMs();
    for (let i = 0; i < iterations; i += 1) {
      const start = nowMs();
      run();
      const elapsed = nowMs() - start;
      if (elapsed > maxMs) {
        maxMs = elapsed;
      }
    }
    const total = nowMs() - totalStart;

    return {
      name: entry.name,
      iterations,
      avgMs: total / iterations,
      maxMs,
      chars: entry.content.length,
    };
  });
}
