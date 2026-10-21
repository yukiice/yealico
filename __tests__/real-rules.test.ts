import fs from 'node:fs';
import path from 'node:path';

import {
  buildGalleryPageUrls,
  buildPagePlan,
  buildRoutePlan,
  executeDetail,
  executeGallery,
  executeList,
  listRulePages,
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
const mangaCopy = loadSite('site-2-');
const aba = loadSite('site-3-');
const mangabz = loadSite('site-5-');

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
    expect(listRulePages(rule)).toHaveLength(29);
    expect(codes).not.toContain('INVALID_RULE');
    expect(codes).not.toContain('UNKNOWN_FIELD');
    expect(codes).not.toContain('UNSUPPORTED_PAGES');
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
    const rule = toRuleDocument(aba);
    const built = buildPagePlan(rule, '最近更新');
    expect(built.page).toBeTruthy();
    expect(built.rule.indexUrl).toContain('/update_history/');
    const html = `
      <div class="entry-content">
        <p class="wp-block-paragraph">[10/05] <a href="https://wc3818290.home.blog/2024/12/01/foo/">Manga Raw</a> - 更新</p>
        <p class="wp-block-paragraph">[09/16] <a href="https://wc3818290.home.blog/2026/01/07/bar/">パイパンコン</a> - 更新</p>
      </div>
    `;

    const result = executeList(
      built.rule,
      built.plan,
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

(jm ? test : test.skip)(
  'extracted 禁漫天堂 can select a page override and inherit site rules',
  () => {
    if (!jm) {
      return;
    }
    const rule = toRuleDocument(jm);
    const built = buildPagePlan(rule, '月排行');
    const codes = built.plan.unsupported.map(item => item.code);

    expect(built.page).toBeTruthy();
    expect(built.rule.indexUrl).toBe(
      'https://{domain:}/albums?t=m&o=mv&page={page:1}',
    );
    expect(built.rule.indexRule).toBe(rule.indexRule);
    expect(built.plan.site.page).toEqual({
      index: 1,
      name: '月排行',
      pk: 19,
    });
    expect(codes).not.toContain('UNSUPPORTED_PAGES');
    expect(codes).not.toContain('INVALID_RULE');
  },
);

(mangaCopy ? test : test.skip)(
  'extracted 拷貝漫畫 photoAlbumLink resolves a second-level chapters URL',
  () => {
    if (!mangaCopy) {
      return;
    }
    const rule = toRuleDocument(mangaCopy);
    const html =
      '<input class="alert-body-input" value="comic%2Fabc">';
    const result = executeDetail(
      rule,
      buildRoutePlan(rule),
      html,
      {
        baseUrl: 'https://www.mangacopy.com/comic/1',
        domain: mangaCopy.meta.domain,
      },
    );

    expect(result.photoAlbumUrl).toBe(
      'https://www.mangacopy.com/comicdetail/abc/chapters',
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'detailRule.photoAlbumLink',
          code: 'SECOND_LEVEL_REQUIRED',
        }),
      ]),
    );
  },
);

(mangabz ? test : test.skip)(
  'extracted M-ngabz selector-less secondLevelPageUrl reads the page script',
  () => {
    if (!mangabz) {
      return;
    }
    const rule = toRuleDocument(mangabz);
    const html = `
      <script>
        MANGABZ_MID=123; MANGABZ_CID=456; MANGABZ_VIEWSIGN="sig"; MANGABZ_VIEWSIGN_DT="dt";
      </script>
    `;
    const result = executeGallery(
      rule,
      buildRoutePlan(rule),
      html,
      {
        baseUrl: 'http://comicbz.com/m456/',
        domain: mangabz.meta.domain,
      },
    );

    expect(result.secondLevelUrl).toBe(
      'https://comicbz.com/m456/chapterimage.ashx?cid=456&page=1&key=&_cid=456&_mid=123&_dt=dt&_sign=sig',
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'galleryRule.secondLevelPageUrl',
          code: 'SECOND_LEVEL_REQUIRED',
        }),
      ]),
    );
    expect(
      result.diagnostics.filter(item => item.code === 'INVALID_RULE'),
    ).toEqual([]);
  },
);
