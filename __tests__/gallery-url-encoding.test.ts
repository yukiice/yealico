import { buildRoutePlan, executeGallery, toRuleDocument } from '../src/engine';
import type { ExtractedYealicoSite } from '../src/engine';
import { encodeUrl } from '../src/engine/url';

const SITE: ExtractedYealicoSite = {
  meta: {
    sitePk: 1,
    name: '图库编码测试',
    domain: 'www.manhuagui.com',
  },
  urls: {
    index: 'https://{domain:}/list/update_p{page:1}.html',
    detail: 'https://{domain:}/comic/{idCode:}/',
    gallery: 'https://{domain:}/comic/{idCode:}/',
  },
  pages: [],
  namedRules: {},
  rules: {
    gallery: {
      image: { selector: '#mangaBox img.mangaFile', function: 'attr', param: 'src' },
    },
  },
};

const CONTEXT = {
  baseUrl: 'https://www.manhuagui.com/',
  domain: 'www.manhuagui.com',
};

describe('图库图片地址编码', () => {
  test('中文卷名与空格会被转义（漫画柜 CDN 的真实形态）', () => {
    const rule = toRuleDocument(SITE);
    const plan = buildRoutePlan(rule);
    const html = `
      <div id="mangaBox">
        <img class="mangaFile" src="https://eu.hamreus.com/ps2/m/marvel/59660/第06卷/Spectacular Spider-Man 20006 0001.jpg.webp?e=1796894370&m=abc" />
      </div>
    `;
    const result = executeGallery(rule, plan, html, CONTEXT, {
      allowWebView: true,
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toBe(
      'https://eu.hamreus.com/ps2/m/marvel/59660/%E7%AC%AC06%E5%8D%B7/Spectacular%20Spider-Man%2020006%200001.jpg.webp?e=1796894370&m=abc',
    );
  });

  test('已转义的部分不会被二次编码，结构字符保持原样', () => {
    const url =
      'https://example.test/a%20b/第01卷/c.jpg?x=1&y=%2F#p=1';
    expect(encodeUrl(url)).toBe(
      'https://example.test/a%20b/%E7%AC%AC01%E5%8D%B7/c.jpg?x=1&y=%2F#p=1',
    );
  });

  test('纯 ASCII 的地址原样返回', () => {
    const url = 'https://cf.mhgui.com/cpic/h/59660.jpg';
    expect(encodeUrl(url)).toBe(url);
  });
});
