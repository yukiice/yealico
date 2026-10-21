import type { Capabilities, Diagnostic, RoutePlan } from '../engine';

/** 调试页的阶段标记。 */
export type DebugStage = 'list' | 'detail' | 'gallery';

export interface DebugRecord {
  stage: DebugStage;
  /** 可选补充说明，例如页码或章节标题。 */
  label?: string;
  counts: Record<string, number>;
  diagnostics: Diagnostic[];
  /** 本次阶段实际请求过的地址，展示时脱敏。 */
  urls: string[];
  at: string;
}

/** 单次会话最多保留的阶段记录数。 */
export const MAX_DEBUG_RECORDS = 20;

/**
 * 参数名的敏感词表（完全匹配）。
 *
 * 刻意不用“包含 key”这类宽松匹配：`keyword` 这类业务参数不是密钥，
 * 误伤会让调试页失去意义。
 */
const SENSITIVE_PARAM =
  /^(access_?token|token|refresh_?token|api_?key|key|sign|sig|signature|auth|authorization|session|sessionid|session_id|password|passwd|pwd|secret|cookie|ticket)$/i;

function maskParamName(rawKey: string): boolean {
  let key = rawKey;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    // 非法百分号编码时退回原串，不影响其余参数处理。
  }
  return SENSITIVE_PARAM.test(key.trim());
}

/**
 * URL 脱敏：去掉 userinfo，并把敏感查询参数的值替换成 `***`。
 *
 * 只处理 query，path/hash 保持原样——页码、章节号这些正是定位问题所需的。
 */
export function sanitizeUrl(input: string): string {
  if (!input) {
    return '';
  }
  const withoutUserInfo = input
    .trim()
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1');
  const queryIndex = withoutUserInfo.indexOf('?');
  if (queryIndex === -1) {
    return withoutUserInfo;
  }
  const head = withoutUserInfo.slice(0, queryIndex);
  const rest = withoutUserInfo.slice(queryIndex + 1);
  const hashIndex = rest.indexOf('#');
  const query = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : rest.slice(hashIndex);
  const masked = query
    .split('&')
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq === -1) {
        return pair;
      }
      const rawKey = pair.slice(0, eq);
      return maskParamName(rawKey) ? `${rawKey}=***` : pair;
    })
    .join('&');
  return `${head}?${masked}${hash}`;
}

/** 自由文本里的查询串脱敏，用于诊断详情。 */
export function sanitizeText(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(
    /(^|[?&\s])([A-Za-z0-9_.-]+)=([^&\s]+)/g,
    (match, prefix: string, key: string) =>
      SENSITIVE_PARAM.test(key) ? `${prefix}${key}=***` : match,
  );
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const detail = diagnostic.detail ? sanitizeText(diagnostic.detail) : '';
  const head = `${diagnostic.severity.toUpperCase()} ${diagnostic.code} @ ${
    diagnostic.fieldPath
  }`;
  return detail ? `${head} — ${detail}` : head;
}

/** 能力声明的单行摘要，例如 `static=1 webview=0 charset=utf-8`。 */
export function describeCapabilities(capabilities: Capabilities): string {
  return [
    `static=${capabilities.static ? 1 : 0}`,
    `webview=${capabilities.webview ? 1 : 0}`,
    `login=${capabilities.login ? 1 : 0}`,
    `consent=${capabilities.consent ? 1 : 0}`,
    `post=${capabilities.post ? 1 : 0}`,
    `charset=${capabilities.charset}`,
    `gbkUrl=${capabilities.gbkUrlEncoding ? 1 : 0}`,
    `ignoreDetail=${capabilities.ignoreDetail ? 1 : 0}`,
  ].join(' ');
}

/** 阻断项：plan.unsupported 里 severity=error 的条目会让执行直接失败。 */
export function blockingReasons(plan: RoutePlan): Diagnostic[] {
  return plan.unsupported.filter(item => item.severity === 'error');
}

/**
 * 调试会话：按阶段记录结果数量、诊断和请求地址。
 *
 * 只存内存，不进持久化；记录顺序为最新在前，上限 MAX_DEBUG_RECORDS。
 */
export class DebugSession {
  private records: DebugRecord[] = [];

  record(input: {
    stage: DebugStage;
    label?: string;
    counts?: Record<string, number>;
    diagnostics?: Diagnostic[];
    urls?: string[];
  }): DebugRecord {
    const record: DebugRecord = {
      stage: input.stage,
      counts: { ...(input.counts ?? {}) },
      diagnostics: [...(input.diagnostics ?? [])],
      urls: [...(input.urls ?? [])],
      at: new Date().toISOString(),
    };
    if (input.label) {
      record.label = input.label;
    }
    this.records = [record, ...this.records].slice(0, MAX_DEBUG_RECORDS);
    return record;
  }

  list(): DebugRecord[] {
    return this.records.map(record => ({
      ...record,
      counts: { ...record.counts },
      diagnostics: [...record.diagnostics],
      urls: [...record.urls],
    }));
  }

  clear(): void {
    this.records = [];
  }
}
