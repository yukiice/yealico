import fs from 'node:fs';
import path from 'node:path';

import {
  buildGalleryPageUrls,
  buildRoutePlan,
  executeDetail,
  executeGallery,
  executeList,
  toRuleDocument,
} from '../src/engine';
import type { ExtractedYealicoSite } from '../src/engine';

const RULES_DIR = path.join(__dirname, '..', 'artifacts', 'yealico-rules');

function loadSite(prefix: string): ExtractedYealicoSite | null {
  if (!fs.existsSync(RULES_DIR)) {
    return null;
  }
  const name = fs
    .readdirSync(RULES_DIR)
    .find(file => file.startsWith(prefix) && file.endsWith('.json'));
  if (!name) {
    return null;
  }
  return JSON.parse(
    fs.readFileSync(path.join(RULES_DIR, name), 'utf8'),
  ) as ExtractedYealicoSite;
}

const jm = loadSite('site-1-');
const aba = loadSite('site-3-');

(jm ? test : test.skip)(
  'extracted 禁漫天堂 2.26 has static index/detail/gallery rules',
  () => {
    if (!jm) {
      return;
    }
    const rule = toRuleDocument(jm);
    const plan = buildRoutePlan(rule);
    const codes = plan.unsupported.map(item => item.code);

    expect(plan.capabilities.static).toBe(true);
    expect(rule.indexRule).toBeTruthy();
    expect(rule.detailRule).toBeTruthy();
    expect(rule.galleryRule).toBeTruthy();
    expect(codes).not.toContain('INVALID_RULE');
    expect(codes).not.toContain('UNKNOWN_FIELD');
  },
);

(jm ? test : test.skip)(
  'extracted 禁漫天堂 detail/gallery works on synthetic HTML',
  () => {
    if (!jm) {
      return;
    }
    const rule = toRuleDocument(jm);
    const plan = buildRoutePlan(rule);
    const detailHtml = `
      <div class="panel-heading"><div class="pull-left">Album Title</div></div>
      <div id="episode-block">
        <a href="/photo/123">Chapter 1</a>
        <a href="/photo/456">Chapter 2</a>
      </div>
    `;
    const detail = executeDetail(rule, plan, detailHtml, {
      baseUrl: 'https://jm18c-dfg.cc/album/999/',
      domain: 'jm18c-dfg.cc',
    });

    expect(detail.diagnostics).toEqual([]);
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters[0]).toMatchObject({ idCode: '123' });
    expect(detail.chapters[0].url).toContain('{pageFormat:?page={page:}}');

    const galleryHtml = `
      <div><div class="scramble-page"><img data-original="/img/1.jpg"></div></div>
      <div><div class="scramble-page"><img data-original="/img/2.jpg"></div></div>
      <ul class="pagination">
        <li><a href="?page=1">1</a></li>
        <li><a href="?page=3">3</a></li>
      </ul>
    `;
    const gallery = executeGallery(rule, plan, galleryHtml, {
      baseUrl: 'https://jm18c-dfg.cc/photo/123?page=1',
      page: 1,
      domain: 'jm18c-dfg.cc',
    });

    expect(gallery.totalPages).toBe(3);
    expect(gallery.images).toEqual([
      'https://jm18c-dfg.cc/img/1.jpg',
      'https://jm18c-dfg.cc/img/2.jpg',
    ]);

    const pages = buildGalleryPageUrls(
      detail.chapters[0].url ?? '',
      gallery.totalPages,
      { baseUrl: 'https://jm18c-dfg.cc/album/999/', domain: 'jm18c-dfg.cc' },
    );
    expect(pages.urls).toEqual([
      'https://jm18c-dfg.cc/photo/123',
      'https://jm18c-dfg.cc/photo/123?page=2',
      'https://jm18c-dfg.cc/photo/123?page=3',
    ]);
  },
);

(aba ? test : test.skip)(
  'extracted 阿巴基猫 List: recently runs against a real-shaped list page',
  () => {
    if (!aba) {
      return;
    }
    const page = aba.pages.find(item => item.name === '最近更新');
    expect(page).toBeTruthy();
    if (!page) {
      return;
    }

    const rule = toRuleDocument(aba);
    const pageRule = {
      ...rule,
      indexUrl: page.listUrl ?? undefined,
      indexRule: page.listRule ?? undefined,
    };
    const html = `
      <div class="entry-content">
        <p class="wp-block-paragraph">[10/05] <a href="https://wc3818290.home.blog/2024/12/01/foo/">Manga Raw</a> - 更新</p>
        <p class="wp-block-paragraph">[09/16] <a href="https://wc3818290.home.blog/2026/01/07/bar/">パイパンコン</a> - 更新</p>
      </div>
    `;

    const result = executeList(
      pageRule,
      buildRoutePlan(pageRule),
      html,
      {
        baseUrl: 'https://wc3818290.home.blog/update_history/',
        page: 1,
        domain: aba.meta.domain,
      },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      datetime: '10/05',
      idCode: '2024/12/01/foo',
    });
    expect(result.items[0].title).toContain('Manga Raw');
    expect(result.items[1]).toMatchObject({
      datetime: '09/16',
      idCode: '2026/01/07/bar',
    });
  },
);
