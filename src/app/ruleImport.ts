import {
  buildRoutePlan,
  toRuleDocument,
} from '../engine';
import type {
  Diagnostic,
  ExtractedYealicoSite,
  RuleDocument,
  RuleFetcher,
  RoutePlan,
} from '../engine';
import { parseQrPayload } from '../engine/qr';
import type { QrPayload } from '../engine/qr';

export type RuleImportSource = 'paste' | 'url' | 'qr';

export interface ImportedRuleSite {
  /** 稳定去重 ID（当前用规则原文的简单哈希，不是安全哈希）。 */
  id: string;
  name: string;
  domain: string;
  source: RuleImportSource;
  sourceUrl?: string;
  hash: string;
  raw: string;
  rule: RuleDocument;
  plan: RoutePlan;
  diagnostics: Diagnostic[];
}

export interface RuleImportResult {
  site?: ImportedRuleSite;
  qr?: QrPayload;
  diagnostics: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33 + text.charCodeAt(index)) % 0x100000000;
  }
  return hash.toString(16).padStart(8, '0');
}

function errorDiagnostic(
  code: Diagnostic['code'],
  detail: string,
  fieldPath = 'import',
): Diagnostic {
  return { fieldPath, code, detail, severity: 'error' };
}

function parseRuleJson(
  text: string,
  source: RuleImportSource,
  sourceUrl?: string,
): RuleImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      diagnostics: [
        errorDiagnostic(
          'INVALID_RULE',
          `invalid rule JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      diagnostics: [
        errorDiagnostic('INVALID_RULE', 'rule JSON must be an object'),
      ],
    };
  }

  const encrypted = parsed.encrypted;
  if (typeof encrypted === 'string' && /^v2:/i.test(encrypted)) {
    return {
      diagnostics: [
        errorDiagnostic(
          'UNSUPPORTED_ENCRYPTED_EXPORT',
          'encrypted Yealico export is not importable yet; use plaintext rule JSON',
        ),
      ],
    };
  }

  const extracted = isRecord(parsed.meta) && isRecord(parsed.urls) && isRecord(parsed.rules)
    ? (parsed as unknown as ExtractedYealicoSite)
    : undefined;
  const rule = extracted
    ? toRuleDocument(extracted)
    : (parsed as RuleDocument);
  const plan = buildRoutePlan(rule);
  const fatal = plan.unsupported.filter(
    item =>
      item.severity === 'error' &&
      (item.code === 'INVALID_RULE' || item.code === 'MISSING_FIELD'),
  );
  const diagnostics = [...plan.unsupported];
  if (!plan.site.name) {
    diagnostics.push(errorDiagnostic('MISSING_FIELD', 'site name is required', 'name'));
  }
  if (!plan.site.domain) {
    diagnostics.push(
      errorDiagnostic('MISSING_FIELD', 'site domain is required', 'domain'),
    );
  }

  const hasName = Boolean(plan.site.name);
  const hasDomain = Boolean(plan.site.domain);
  if (fatal.length > 0 || !hasName || !hasDomain) {
    return { diagnostics };
  }

  const hash = hashText(text);
  return {
    site: {
      id: `site-${hash}`,
      name: plan.site.name,
      domain: plan.site.domain,
      source,
      ...(sourceUrl ? { sourceUrl } : {}),
      hash,
      raw: text,
      rule,
      plan,
      diagnostics,
    },
    diagnostics,
  };
}

/**
 * 粘贴/文件导入。只接受 JSON；URL 请用 importRuleFromUrl，
 * 扫码请用 importRuleFromQr。
 */
export function importRuleText(
  text: string,
  source: RuleImportSource = 'paste',
): RuleImportResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      diagnostics: [errorDiagnostic('INVALID_RULE', 'empty rule payload')],
    };
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseRuleJson(trimmed, source);
  }
  const qr = parseQrPayload(trimmed);
  if (qr.kind === 'yealico-v2') {
    return { qr, diagnostics: qr.diagnostics };
  }
  if (qr.kind === 'rule-url') {
    return {
      qr,
      diagnostics: [
        errorDiagnostic(
          'UNSUPPORTED_FEATURE',
          'rule URL requires importRuleFromUrl',
          'url',
        ),
      ],
    };
  }
  if (qr.kind === 'unsupported') {
    return { qr, diagnostics: qr.diagnostics };
  }
  if (qr.kind !== 'rule-json' || !qr.json) {
    return {
      qr,
      diagnostics: [
        errorDiagnostic('INVALID_RULE', 'payload does not contain rule JSON'),
      ],
    };
  }
  return parseRuleJson(qr.json, source);
}

export async function importRuleFromUrl(
  url: string,
  fetcher: RuleFetcher,
  source: RuleImportSource = 'url',
): Promise<RuleImportResult> {
  let response;
  try {
    response = await fetcher.fetch({
      url,
      method: 'GET',
      headers: {},
      timeoutMs: 15_000,
    });
  } catch (error) {
    return {
      diagnostics: [
        errorDiagnostic(
          'NETWORK_ERROR',
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  }
  if (response.status < 200 || response.status >= 400) {
    return {
      diagnostics: [
        errorDiagnostic('NETWORK_ERROR', `HTTP ${response.status} for ${url}`),
      ],
    };
  }
  return parseRuleJson(response.body, source, url);
}

export async function importRuleFromQr(
  payload: string,
  fetcher: RuleFetcher,
): Promise<RuleImportResult> {
  const qr = parseQrPayload(payload);
  if (qr.kind === 'yealico-v2' || qr.kind === 'unsupported') {
    return { qr, diagnostics: qr.diagnostics };
  }
  if (qr.kind === 'rule-url' && qr.url) {
    return { qr, ...(await importRuleFromUrl(qr.url, fetcher, 'qr')) };
  }
  if (qr.kind === 'rule-json' && qr.json) {
    return { qr, ...importRuleText(qr.json, 'qr') };
  }
  return {
    qr,
    diagnostics: [
      errorDiagnostic('INVALID_RULE', 'QR payload does not contain a rule'),
    ],
  };
}

export interface StoredSite extends ImportedRuleSite {
  importedAt: string;
}

/**
 * 内存站点仓库。
 *
 * 这是 P3 的领域模型和去重契约；AsyncStorage/SQLite 持久化在后续接入，
 * 但导入、去重、删除行为先独立测试。
 */
export class SiteRepository {
  private sites: StoredSite[] = [];

  list(): StoredSite[] {
    return [...this.sites];
  }

  get(id: string): StoredSite | undefined {
    return this.sites.find(site => site.id === id);
  }

  add(site: ImportedRuleSite): { site?: StoredSite; diagnostics: Diagnostic[] } {
    const duplicate = this.sites.find(
      item =>
        item.id === site.id ||
        (item.domain === site.domain && item.name === site.name),
    );
    if (duplicate) {
      return {
        diagnostics: [
          errorDiagnostic(
            'DUPLICATE_SITE',
            `site already imported: ${duplicate.name} (${duplicate.domain})`,
            'site',
          ),
        ],
      };
    }
    const stored: StoredSite = {
      ...site,
      importedAt: new Date().toISOString(),
    };
    this.sites.push(stored);
    return { site: stored, diagnostics: [] };
  }

  remove(id: string): boolean {
    const before = this.sites.length;
    this.sites = this.sites.filter(site => site.id !== id);
    return this.sites.length !== before;
  }

  clear(): void {
    this.sites = [];
  }
}
