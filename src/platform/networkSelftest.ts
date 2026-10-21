import {
  buildPagePlan,
  loadListPages,
  toRuleDocument,
} from '../engine';
import { ABA_RULE_JSON } from '../engine/real-rules.generated';
import type { SelftestResult } from '../engine/selftest';
import type { ExtractedYealicoSite, RuleFetcher } from '../engine';

const ABA_PAGE_URL = 'https://wc3818290.home.blog/update_history/';

/**
 * 公开站点网络探针。
 *
 * 只访问阿巴基猫的公开更新页；不访问禁漫等成人站点，也不依赖登录/Cookie。
 * 网络探针是手动触发，不放进 App 启动时的同步自检。
 */
export async function runNetworkSelftest(
  fetcher: RuleFetcher,
): Promise<SelftestResult[]> {
  const rule = toRuleDocument(
    ABA_RULE_JSON as unknown as ExtractedYealicoSite,
  );
  const built = buildPagePlan(rule, '最近更新');
  const result = await loadListPages(
    built.rule,
    built.plan,
    fetcher,
    {
      baseUrl: ABA_PAGE_URL,
      page: 1,
      domain: 'wc3818290.home.blog',
    },
    { maxPages: 1 },
  );
  const errors = result.diagnostics.filter(
    diagnostic => diagnostic.severity === 'error',
  );
  const firstTitle = result.items[0]?.title;

  return [
    {
      name: 'network: Aba page 1 fetched',
      ok: result.pages === 1,
      detail: `pages=${result.pages}, stop=${result.stopReason}`,
    },
    {
      name: 'network: Aba list items',
      ok: result.items.length > 0,
      detail: `items=${result.items.length}${
        firstTitle ? `, first=${firstTitle}` : ''
      }`,
    },
    {
      name: 'network: no error diagnostics',
      ok: errors.length === 0,
      detail:
        errors.length === 0
          ? 'none'
          : errors
              .slice(0, 3)
              .map(item => `${item.code}:${item.fieldPath}`)
              .join(', '),
    },
  ];
}
