import { chapterMetaText } from '../src/app/DetailScreen';
import {
  MAX_ENTRIES_PER_SITE,
  parseSiteLibrary,
  progressKeyFor,
  ReadingProgressRepository,
  serializeSiteLibrary,
} from '../src/app/readingProgress';
import type { StoredSite } from '../src/app/ruleImport';

function site(id: string): StoredSite {
  return {
    id,
    name: id,
    domain: `${id}.test`,
    source: 'paste',
    hash: id,
    raw: '{}',
    rule: { name: id, domain: `${id}.test` },
    plan: {
      site: { name: id, domain: `${id}.test` },
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
      },
      pages: [],
      unsupported: [],
    } as unknown as StoredSite['plan'],
    diagnostics: [],
    importedAt: '2026-10-21T00:00:00.000Z',
  };
}

test('keys progress by chapter idCode, then by chapter URL', () => {
  expect(
    progressKeyFor({ idCode: '456', url: 'https://e.test/1.html' }),
  ).toBe('456');
  expect(progressKeyFor({ url: 'https://e.test/1.html' })).toBe(
    'https://e.test/1.html',
  );
  expect(progressKeyFor({ idCode: '  ', url: '' })).toBe('');
  expect(progressKeyFor({})).toBe('');
});

test('migrates the legacy site-array payload', () => {
  const legacy = JSON.stringify([site('site-a')]);
  const library = parseSiteLibrary(legacy);

  expect(library.version).toBe(2);
  expect(library.sites).toHaveLength(1);
  expect(library.progress).toEqual([]);
});

test('reads the versioned payload and drops junk entries', () => {
  const raw = JSON.stringify({
    version: 2,
    sites: [site('site-a')],
    progress: [
      {
        siteId: 'site-a',
        chapterKey: '456',
        chapterUrl: 'https://a.test/456.html#p=1',
        index: 3,
        total: 20,
        updatedAt: '2026-10-21T01:00:00.000Z',
      },
      { siteId: 'site-a' },
      { chapterKey: 'no-site' },
      'garbage',
    ],
  });

  const library = parseSiteLibrary(raw);
  expect(library.sites).toHaveLength(1);
  expect(library.progress).toEqual([
    {
      siteId: 'site-a',
      chapterKey: '456',
      chapterUrl: 'https://a.test/456.html#p=1',
      index: 3,
      total: 20,
      updatedAt: '2026-10-21T01:00:00.000Z',
    },
  ]);
});

test('round-trips sites and progress through the envelope', () => {
  const progress = new ReadingProgressRepository();
  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 2,
    total: 8,
  });

  const raw = serializeSiteLibrary([site('site-a')], progress.list());
  const parsed = parseSiteLibrary(raw);

  expect(parsed.sites).toHaveLength(1);
  expect(parsed.sites[0].id).toBe('site-a');
  expect(parsed.progress).toHaveLength(1);
  expect(parsed.progress[0].chapterKey).toBe('1');
  expect(parsed.progress[0].index).toBe(2);
});

test('upserts one entry per chapter and tracks the latest per site', () => {
  const progress = new ReadingProgressRepository();

  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 1,
  });
  progress.save({
    siteId: 'site-a',
    chapterKey: '2',
    chapterUrl: 'https://a.test/2.html',
    index: 0,
  });
  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 5,
    total: 9,
  });

  expect(progress.list()).toHaveLength(2);
  expect(progress.get('site-a', '1')).toMatchObject({ index: 5, total: 9 });
  expect(progress.latestForSite('site-a')?.chapterKey).toBe('1');
  expect(progress.latestForSite('site-b')).toBeUndefined();
});

test('skips writes when nothing changed', () => {
  const progress = new ReadingProgressRepository();
  let changes = 0;
  progress.onChange = () => {
    changes += 1;
  };

  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 2,
    total: 4,
  });
  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 2,
    total: 4,
  });
  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 3,
    total: 4,
  });

  expect(changes).toBe(2);
});

test('ignores entries without a stable identity', () => {
  const progress = new ReadingProgressRepository();
  expect(
    progress.save({ siteId: '', chapterKey: '1', chapterUrl: '', index: 0 }),
  ).toBeUndefined();
  expect(
    progress.save({ siteId: 'site-a', chapterKey: '', chapterUrl: '', index: 0 }),
  ).toBeUndefined();
  expect(progress.list()).toEqual([]);
});

test('drops progress with the site and per chapter', () => {
  const progress = new ReadingProgressRepository([
    {
      siteId: 'site-a',
      chapterKey: '1',
      chapterUrl: '',
      index: 0,
      updatedAt: '2026-10-21T00:00:00.000Z',
    },
    {
      siteId: 'site-a',
      chapterKey: '2',
      chapterUrl: '',
      index: 0,
      updatedAt: '2026-10-21T00:00:00.000Z',
    },
    {
      siteId: 'site-b',
      chapterKey: '1',
      chapterUrl: '',
      index: 0,
      updatedAt: '2026-10-21T00:00:00.000Z',
    },
  ]);

  expect(progress.remove('site-a', '1')).toBe(true);
  expect(progress.remove('site-a', '1')).toBe(false);
  expect(progress.removeSite('site-a')).toBe(1);
  expect(progress.list().map(item => `${item.siteId}/${item.chapterKey}`)).toEqual([
    'site-b/1',
  ]);
});

test('keeps only the newest chapters per site', () => {
  const progress = new ReadingProgressRepository();
  for (let index = 0; index < MAX_ENTRIES_PER_SITE + 5; index += 1) {
    progress.save({
      siteId: 'site-a',
      chapterKey: `ch-${index}`,
      chapterUrl: `https://a.test/${index}.html`,
      index: 0,
    });
  }

  const owned = progress.list().filter(item => item.siteId === 'site-a');
  expect(owned).toHaveLength(MAX_ENTRIES_PER_SITE);
  // 后写入的章节留下，最早的几条被裁掉（时间戳相同时按写入顺序）。
  expect(owned.some(item => item.chapterKey === 'ch-0')).toBe(false);
  expect(owned.some(item => item.chapterKey === 'ch-5')).toBe(true);
  expect(owned.some(item => item.chapterKey === `ch-${MAX_ENTRIES_PER_SITE + 4}`)).toBe(
    true,
  );
});

test('keeps the newest duplicate when normalizing', () => {
  const entries = new ReadingProgressRepository([
    {
      siteId: 'site-a',
      chapterKey: '1',
      chapterUrl: '',
      index: 1,
      updatedAt: '2026-10-20T00:00:00.000Z',
    },
    {
      siteId: 'site-a',
      chapterKey: '1',
      chapterUrl: '',
      index: 7,
      updatedAt: '2026-10-21T00:00:00.000Z',
    },
  ]).list();

  expect(entries).toHaveLength(1);
  expect(entries[0].index).toBe(7);
});

test('describes the chapter row with stored progress', () => {
  const progress = new ReadingProgressRepository();
  progress.save({
    siteId: 'site-a',
    chapterKey: '456',
    chapterUrl: 'https://a.test/456.html',
    index: 2,
    total: 12,
  });

  expect(
    chapterMetaText(progress, 'site-a', {
      idCode: '456',
      url: 'https://a.test/456.html',
    }),
  ).toBe('已读 3 / 12 张');

  expect(
    chapterMetaText(progress, 'site-a', {
      idCode: '789',
      url: 'https://a.test/789.html',
    }),
  ).toBe('阅读 · 789');
});

test('stores the in-image offset and clamps it', () => {
  const progress = new ReadingProgressRepository();
  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 2,
    offsetRatio: 0.4567,
    total: 8,
  });

  expect(progress.get('site-a', '1')).toMatchObject({
    index: 2,
    offsetRatio: 0.457,
  });

  progress.save({
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 2,
    offsetRatio: 2,
    total: 8,
  });

  expect(progress.get('site-a', '1')?.offsetRatio).toBe(1);
});

test('keeps old progress entries without an offset ratio', () => {
  const library = parseSiteLibrary(
    JSON.stringify({
      version: 2,
      sites: [],
      progress: [
        {
          siteId: 'site-a',
          chapterKey: '1',
          chapterUrl: 'https://a.test/1.html',
          index: 1,
          updatedAt: '2026-10-21T00:00:00.000Z',
        },
      ],
    }),
  );

  expect(library.progress[0].offsetRatio).toBeUndefined();
});

test('rewrites when only the in-image offset changes', () => {
  const progress = new ReadingProgressRepository();
  let changes = 0;
  progress.onChange = () => {
    changes += 1;
  };
  const base = {
    siteId: 'site-a',
    chapterKey: '1',
    chapterUrl: 'https://a.test/1.html',
    index: 2,
    total: 4,
  };

  progress.save({ ...base, offsetRatio: 0.2 });
  progress.save({ ...base, offsetRatio: 0.2 });
  progress.save({ ...base, offsetRatio: 0.6 });

  expect(changes).toBe(2);
});
