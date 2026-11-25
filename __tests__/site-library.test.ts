import type { StoredSite } from '../src/app/ruleImport';
import { pickInitialSite } from '../src/app/siteLibrary';
import {
  parseSiteLibrary,
  serializeSiteLibrary,
} from '../src/app/readingProgress';

function site(id: string, name: string): StoredSite {
  return {
    id,
    name,
    domain: `${id}.test`,
    source: 'paste',
    hash: id,
    raw: '{}',
    rule: { meta: { name, domain: `${id}.test` } } as never,
    plan: {
      site: { name, domain: `${id}.test`, displayMode: 'list' },
      capabilities: {
        static: true,
        webview: false,
        login: false,
        consent: false,
        post: false,
        charset: 'utf-8',
        gbkUrlEncoding: false,
        ignoreDetail: false,
        repeatedThumbnail: false,
        scroll: false,
      },
      unsupported: [],
    },
    diagnostics: [],
    importedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('pickInitialSite', () => {
  const sites = [site('a', 'A'), site('b', 'B')];

  it('没有站点返回 null', () => {
    expect(pickInitialSite([])).toBeNull();
  });

  it('优先上次打开的站点', () => {
    expect(pickInitialSite(sites, 'b')?.id).toBe('b');
  });

  it('上次站点不存在时退回第一个', () => {
    expect(pickInitialSite(sites, 'gone')?.id).toBe('a');
    expect(pickInitialSite(sites)?.id).toBe('a');
  });
});

describe('站点库落盘', () => {
  it('lastSiteId 能往返', () => {
    const raw = serializeSiteLibrary([site('a', 'A')], [], 'a');
    const parsed = parseSiteLibrary(raw);
    expect(parsed.lastSiteId).toBe('a');
    expect(parsed.sites).toHaveLength(1);
  });

  it('没有 lastSiteId 时不写入该字段', () => {
    const raw = serializeSiteLibrary([site('a', 'A')], []);
    expect(JSON.parse(raw).lastSiteId).toBeUndefined();
    expect(parseSiteLibrary(raw).lastSiteId).toBeUndefined();
  });

  it('旧版纯数组格式仍可解析', () => {
    const raw = JSON.stringify([site('a', 'A')]);
    const parsed = parseSiteLibrary(raw);
    expect(parsed.sites).toHaveLength(1);
    expect(parsed.lastSiteId).toBeUndefined();
  });
});
