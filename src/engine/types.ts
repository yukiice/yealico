/**
 * P1 规则核心的公共类型。
 *
 * 设计约束：
 * - 规则原文只读，所有诊断带 fieldPath。
 * - 未知能力必须进入 unsupported，不能静默变成空结果。
 * - 这里的类型是 RoutePlan 的契约，P2 在此基础上扩展，不另起一套。
 */

export type DiagnosticCode =
  | 'INVALID_RULE'
  | 'UNSUPPORTED_FUNCTION'
  | 'UNSUPPORTED_FUNCTION_SYNTAX'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_PLACEHOLDER'
  | 'UNSUPPORTED_JSONPATH'
  | 'UNSUPPORTED_QR_PAYLOAD'
  | 'UNSUPPORTED_ENCRYPTED_EXPORT'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_FEATURE'
  | 'UNSUPPORTED_SERIES'
  | 'UNSUPPORTED_PAGES'
  | 'UNSUPPORTED_IGNORE_DETAIL'
  | 'UNSUPPORTED_REGEX'
  | 'NEEDS_WEBVIEW'
  | 'NEEDS_LOGIN'
  | 'NEEDS_CONSENT'
  | 'MISSING_FIELD'
  | 'EMPTY_RESULT';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  fieldPath: string;
  code: DiagnosticCode;
  detail?: string;
  severity: DiagnosticSeverity;
}

export interface SelectorSpec {
  selector: string;
  function?: string;
  param?: string;
  regex?: string;
  replacement?: string;
  /** 本项目的显式扩展：把相对地址解析为绝对地址。 */
  absoluteUrl?: boolean;
  [key: string]: unknown;
}

export type RuleFields = Record<string, unknown>;

export interface RuleDocument {
  name?: string;
  domain?: string;
  displayMode?: string;
  loginUrl?: string;
  indexUrl?: string;
  detailUrl?: string;
  galleryUrl?: string;
  searchUrl?: string;
  headers?: Record<string, string>;
  flags?: Record<string, unknown>;
  indexRule?: RuleFields;
  detailRule?: RuleFields;
  galleryRule?: RuleFields;
  seriesRule?: RuleFields;
  pages?: unknown;
  [key: string]: unknown;
}

export interface Capabilities {
  static: boolean;
  webview: boolean;
  login: boolean;
  consent: boolean;
  post: boolean;
  charset: string;
  gbkUrlEncoding: boolean;
  ignoreDetail: boolean;
  repeatedThumbnail: boolean;
  scroll: boolean;
}

export interface RoutePlan {
  site: {
    name: string;
    domain: string;
    displayMode: string;
  };
  capabilities: Capabilities;
  unsupported: Diagnostic[];
}

export interface PageContext {
  /** 当前页面展开后的 URL，用于相对地址与 URL 派生占位符。 */
  baseUrl: string;
  /** 页码，1 起。 */
  page?: number;
  idCode?: string;
  cidCode?: string;
  keyword?: string;
  domain?: string;
}

export interface ExtractItem {
  idCode?: string;
  title?: string;
  cover?: string;
  [key: string]: string | number | undefined;
}

export interface ListResult {
  items: ExtractItem[];
  diagnostics: Diagnostic[];
}

export interface GalleryResult {
  totalPages?: number;
  images: string[];
  diagnostics: Diagnostic[];
}

export interface ChapterItem {
  idCode?: string;
  title?: string;
  datetime?: string;
  url?: string;
  [key: string]: string | number | undefined;
}

export interface DetailResult {
  fields: ExtractItem;
  chapters: ChapterItem[];
  pictures: string[];
  diagnostics: Diagnostic[];
}

export interface PageUrlResult {
  urls: string[];
  diagnostics: Diagnostic[];
  stopReason?: 'maxPages' | 'duplicate' | 'empty';
}

export interface ExpandResult {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  diagnostics: Diagnostic[];
}

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];
