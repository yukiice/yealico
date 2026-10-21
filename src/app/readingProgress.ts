import type { ChapterItem } from '../engine';
import type { StoredSite } from './ruleImport';

/** 单章节的阅读位次。 */
export interface ReadingProgressEntry {
  /** 站点稳定 ID（规则哈希派生）。 */
  siteId: string;
  /** 章节稳定标识：优先 chapterRule.idCode，缺失时退回章节 URL。 */
  chapterKey: string;
  chapterUrl: string;
  chapterTitle?: string;
  /** 当前图片下标，0 起。 */
  index: number;
  /** 上次保存时该章节已加载的图片数，用于恢复时判断是否越界。 */
  total?: number;
  updatedAt: string;
}

export interface ReadingProgressInput {
  siteId: string;
  chapterKey: string;
  chapterUrl: string;
  chapterTitle?: string;
  index: number;
  total?: number;
}

/** 落盘 envelope。旧版本直接存的是站点数组，见 parseSiteLibrary。 */
export interface SiteLibraryData {
  version: 2;
  sites: StoredSite[];
  progress: ReadingProgressEntry[];
}

/** 单站点最多保留的章节进度条数，防止长期使用无限增长。 */
export const MAX_ENTRIES_PER_SITE = 50;

/**
 * 章节稳定标识。
 *
 * 只用页面上的临时图片地址会把进度绑死在会过期的 URL 上，
 * 所以优先 idCode；两者都没有时返回空串，调用方负责跳过保存。
 */
export function progressKeyFor(chapter: ChapterItem): string {
  const idCode =
    typeof chapter.idCode === 'string' ? chapter.idCode.trim() : '';
  if (idCode) {
    return idCode;
  }
  return typeof chapter.url === 'string' ? chapter.url.trim() : '';
}

function normalizeIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeEntry(value: unknown): ReadingProgressEntry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const siteId = typeof raw.siteId === 'string' ? raw.siteId : '';
  const chapterKey = typeof raw.chapterKey === 'string' ? raw.chapterKey : '';
  if (!siteId || !chapterKey) {
    return undefined;
  }
  const entry: ReadingProgressEntry = {
    siteId,
    chapterKey,
    chapterUrl: typeof raw.chapterUrl === 'string' ? raw.chapterUrl : '',
    index: normalizeIndex(raw.index),
    updatedAt:
      typeof raw.updatedAt === 'string' && raw.updatedAt
        ? raw.updatedAt
        : new Date(0).toISOString(),
  };
  if (typeof raw.chapterTitle === 'string' && raw.chapterTitle) {
    entry.chapterTitle = raw.chapterTitle;
  }
  if (typeof raw.total === 'number' && Number.isFinite(raw.total)) {
    entry.total = Math.max(0, Math.floor(raw.total));
  }
  return entry;
}

export function normalizeEntries(values: unknown): ReadingProgressEntry[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const byKey = new Map<string, ReadingProgressEntry>();
  for (const value of values) {
    const entry = normalizeEntry(value);
    if (!entry) {
      continue;
    }
    const key = `${entry.siteId}\u0000${entry.chapterKey}`;
    const existing = byKey.get(key);
    // 同一章节出现多条时保留更新的一条。
    if (!existing || compareUpdatedAt(entry, existing) >= 0) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

function compareUpdatedAt(
  a: ReadingProgressEntry,
  b: ReadingProgressEntry,
): number {
  return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
}

/**
 * 阅读进度仓库（内存）。
 *
 * 持久化由宿主注入的 onChange 触发；这里只维护去重、上限和序列化契约，
 * 便于脱离 React Native 单测。
 */
export class ReadingProgressRepository {
  private entries: ReadingProgressEntry[];

  onChange?: (entries: ReadingProgressEntry[]) => void;

  constructor(entries: ReadingProgressEntry[] = []) {
    this.entries = normalizeEntries(entries);
  }

  list(): ReadingProgressEntry[] {
    return this.entries.map(entry => ({ ...entry }));
  }

  get(siteId: string, chapterKey: string): ReadingProgressEntry | undefined {
    const entry = this.entries.find(
      item => item.siteId === siteId && item.chapterKey === chapterKey,
    );
    return entry ? { ...entry } : undefined;
  }

  /** 站点最近一次阅读记录；平手时取后写入的那条。 */
  latestForSite(siteId: string): ReadingProgressEntry | undefined {
    let latest: ReadingProgressEntry | undefined;
    for (const entry of this.entries) {
      if (entry.siteId !== siteId) {
        continue;
      }
      if (!latest || compareUpdatedAt(entry, latest) >= 0) {
        latest = entry;
      }
    }
    return latest ? { ...latest } : undefined;
  }

  save(input: ReadingProgressInput): ReadingProgressEntry | undefined {
    if (!input.siteId || !input.chapterKey) {
      return undefined;
    }
    const index = normalizeIndex(input.index);
    const existing = this.entries.find(
      item =>
        item.siteId === input.siteId && item.chapterKey === input.chapterKey,
    );
    // 位次、总数、地址都没变就不落盘，避免翻页时反复重写整个库。
    if (
      existing &&
      existing.index === index &&
      existing.total === input.total &&
      existing.chapterUrl === input.chapterUrl
    ) {
      return { ...existing };
    }

    const next: ReadingProgressEntry = {
      siteId: input.siteId,
      chapterKey: input.chapterKey,
      chapterUrl: input.chapterUrl,
      index,
      updatedAt: new Date().toISOString(),
    };
    if (input.chapterTitle) {
      next.chapterTitle = input.chapterTitle;
    }
    if (input.total !== undefined) {
      next.total = normalizeIndex(input.total);
    }

    this.entries = this.entries.filter(
      item =>
        !(item.siteId === input.siteId && item.chapterKey === input.chapterKey),
    );
    this.entries.push(next);
    this.trim(input.siteId);
    this.onChange?.(this.list());
    return { ...next };
  }

  remove(siteId: string, chapterKey: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      item => !(item.siteId === siteId && item.chapterKey === chapterKey),
    );
    const changed = this.entries.length !== before;
    if (changed) {
      this.onChange?.(this.list());
    }
    return changed;
  }

  removeSite(siteId: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(item => item.siteId !== siteId);
    const removed = before - this.entries.length;
    if (removed > 0) {
      this.onChange?.(this.list());
    }
    return removed;
  }

  replaceAll(entries: ReadingProgressEntry[]): void {
    this.entries = normalizeEntries(entries);
  }

  private trim(siteId: string): void {
    const owned = this.entries.filter(item => item.siteId === siteId);
    if (owned.length <= MAX_ENTRIES_PER_SITE) {
      return;
    }
    const keep = new Set(
      owned
        .map((entry, position) => ({ entry, position }))
        .sort(
          (a, b) =>
            compareUpdatedAt(a.entry, b.entry) || a.position - b.position,
        )
        .slice(owned.length - MAX_ENTRIES_PER_SITE)
        .map(item => item.entry.chapterKey),
    );
    this.entries = this.entries.filter(
      item => item.siteId !== siteId || keep.has(item.chapterKey),
    );
  }
}

/**
 * 解析本地数据。
 *
 * 兼容两种历史格式：
 * - 旧版：直接是 `StoredSite[]`；
 * - 新版：`{ version: 2, sites, progress }`。
 *
 * JSON 本身非法时抛出，由调用方提示“本地数据损坏”。
 */
export function parseSiteLibrary(raw: string | null): SiteLibraryData {
  if (!raw) {
    return { version: 2, sites: [], progress: [] };
  }
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return { version: 2, sites: parsed as StoredSite[], progress: [] };
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.sites)) {
      return {
        version: 2,
        sites: record.sites as StoredSite[],
        progress: normalizeEntries(record.progress),
      };
    }
  }
  return { version: 2, sites: [], progress: [] };
}

export function serializeSiteLibrary(
  sites: StoredSite[],
  progress: ReadingProgressEntry[],
): string {
  return JSON.stringify({ version: 2, sites, progress });
}
