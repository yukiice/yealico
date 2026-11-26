import { importRuleText } from '../src/app/ruleImport';
import { SITE_PRESETS, presetRuleText } from '../src/app/sitePresets';

type FieldMap = Record<string, unknown>;

function field(map: unknown, key: string): FieldMap {
  const value = (map as FieldMap | undefined)?.[key];
  return (value ?? {}) as FieldMap;
}

function selector(map: unknown, key: string): string {
  const value = field(map, key).selector;
  return typeof value === 'string' ? value : '';
}

describe('内置站点预设', () => {
  test('清单非空且 id 唯一', () => {
    expect(SITE_PRESETS.length).toBeGreaterThan(0);
    const ids = SITE_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const preset of SITE_PRESETS) {
    describe(preset.id, () => {
      const result = importRuleText(presetRuleText(preset), 'preset');

      test('能通过导入管线且没有 error 诊断', () => {
        expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual(
          [],
        );
        expect(result.site).toBeDefined();
      });

      test('来源标记为 preset 且域名与声明一致', () => {
        expect(result.site?.source).toBe('preset');
        expect(result.site?.domain).toBe(preset.domain);
      });

      test('同一份规则换来源导入仍是同一 id，去重不会因入口不同失效', () => {
        const pasted = importRuleText(presetRuleText(preset), 'paste');
        expect(pasted.site?.id).toBe(result.site?.id);
      });
    });
  }

  describe('漫画柜', () => {
    const preset = SITE_PRESETS.find(item => item.id === 'manhuagui');
    const rule = (): FieldMap => {
      const site = importRuleText(
        presetRuleText(preset!),
        'preset',
      ).site;
      return site?.rule as unknown as FieldMap;
    };

    test('预设存在且域名正确', () => {
      expect(preset).toBeDefined();
      expect(preset?.domain).toBe('www.manhuagui.com');
    });

    // 以下选择器是 2026-11-26 对 www.manhuagui.com 线上页面逐项核实过的锚点。
    // 规则常量由 scripts/sync-real-rules.mjs 重新生成，若 artifact 被替换，
    // 这些断言会先失败，而不是等真机上白屏才发现。
    test('列表页选择器与线上结构一致', () => {
      const index = rule().indexRule;
      expect(selector(index, 'item')).toBe('#contList li');
      expect(selector(index, 'cover')).toBe('a.bcover img');
      expect(selector(index, 'datetime')).toBe('span.updateon');
    });

    test('详情页章节选择器与线上结构一致', () => {
      const detail = rule().detailRule;
      expect(selector(field(detail, 'chapterRule'), 'item')).toBe(
        'div.chapter-list ul li',
      );
      expect(selector(detail, 'title')).toBe('h1');
      expect(selector(detail, 'cover')).toBe('div.book-cover p.hcover img');
    });

    test('图库依赖 WebView 注入后的节点', () => {
      const gallery = rule().galleryRule;
      expect(selector(gallery, 'totalPages')).toBe(
        '#pageSelect option:last-child',
      );
      expect(selector(gallery, 'image')).toContain('#mangaBox img.mangaFile');
    });
  });
});
