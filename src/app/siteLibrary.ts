import type { StoredSite } from './ruleImport';

/**
 * 启动时选哪个站点。
 *
 * 优先上次打开的；它被删掉或从未记录时退回列表第一个。
 * 没有站点返回 null，由调用方展示空态。
 */
export function pickInitialSite(
  sites: StoredSite[],
  lastSiteId?: string,
): StoredSite | null {
  if (sites.length === 0) {
    return null;
  }
  return sites.find(site => site.id === lastSiteId) ?? sites[0];
}
