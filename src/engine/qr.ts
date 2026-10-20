import type { Diagnostic } from './types';
import { getQueryValue } from './url';

/**
 * QR 载荷识别。
 *
 * 现实约束：
 * - Yealico 的站点规则二维码是 `Yealico QR Code: v2:<base64>`。
 * - 示例载荷 base64 解码后是 64 字节二进制，不是 JSON/URL，
 *   也不是 zlib/gzip/Brotli/LZString；常见 AES/ChaCha 派生密钥也没有解出明文。
 * - 因此这里只做“载体识别 + 明确失败”，不猜解密算法，不把扫码成功当成导入成功。
 *
 * 支持：
 * - 原样 JSON（`{...}` / `[...]`）
 * - `http(s)://` 规则 URL（可指向 raw JSON）
 * - `yealico://import?url=...` / `?rule=...`
 * - 识别 `Yealico QR Code: vN:<base64>`，但 v2 视为不透明载荷
 */

export type QrPayloadKind =
  | 'yealico-v2'
  | 'rule-url'
  | 'rule-json'
  | 'unsupported';

export interface QrPayload {
  kind: QrPayloadKind;
  raw: string;
  version?: number;
  base64?: string;
  bytes?: number;
  url?: string;
  json?: string;
  diagnostics: Diagnostic[];
}

const YEALICO_PREFIX = /^Yealico\s+QR\s+Code:\s*v(\d+):\s*([\s\S]+)$/i;
const HTTP_URL = /^https?:\/\/\S+$/i;
const CUSTOM_SCHEME = /^yealico(?:-android)?:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i;

function unsupported(raw: string, detail: string): QrPayload {
  return {
    kind: 'unsupported',
    raw,
    diagnostics: [
      {
        fieldPath: 'qr',
        code: 'UNSUPPORTED_QR_PAYLOAD',
        detail,
        severity: 'error',
      },
    ],
  };
}

function normalizeBase64(input: string): string | null {
  const compact = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (
    !compact ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) ||
    compact.length % 4 !== 0
  ) {
    return null;
  }
  return compact;
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function parseJsonPayload(raw: string, text: string): QrPayload {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return unsupported(raw, 'JSON payload must be a rule object');
    }
    const encrypted = (parsed as { encrypted?: unknown }).encrypted;
    if (typeof encrypted === 'string' && /^v2:/i.test(encrypted)) {
      const payload = encrypted.slice(3);
      const base64 = normalizeBase64(payload);
      const bytes = base64 ? base64ByteLength(base64) : undefined;
      return {
        kind: 'unsupported',
        raw,
        diagnostics: [
          {
            fieldPath: 'qr.encrypted',
            code: 'UNSUPPORTED_ENCRYPTED_EXPORT',
            detail: `Yealico encrypted export${
              bytes === undefined ? '' : ` (${bytes} bytes)`
            }; use Yealico Edit to extract plaintext or provide a rule JSON`,
            severity: 'error',
          },
        ],
      };
    }
    return { kind: 'rule-json', raw, json: text, diagnostics: [] };
  } catch (error) {
    return unsupported(
      raw,
      `invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseCustomScheme(raw: string, text: string): QrPayload {
  const match = CUSTOM_SCHEME.exec(text);
  if (!match) {
    return unsupported(raw, 'unsupported custom scheme');
  }
  const query = match[3] ?? '';
  const url = getQueryValue(query, 'url');
  if (url && HTTP_URL.test(url)) {
    return { kind: 'rule-url', raw, url, diagnostics: [] };
  }
  const rule = getQueryValue(query, 'rule') ?? getQueryValue(query, 'json');
  if (rule) {
    return parseJsonPayload(raw, rule);
  }
  return unsupported(raw, 'custom scheme requires url= or rule=');
}

export function parseQrPayload(input: string): QrPayload {
  const raw = input.trim();
  if (!raw) {
    return unsupported(raw, 'empty QR payload');
  }

  const yealico = YEALICO_PREFIX.exec(raw);
  if (yealico) {
    const version = Number.parseInt(yealico[1], 10);
    const base64 = normalizeBase64(yealico[2]);
    if (!base64) {
      return unsupported(raw, 'invalid Yealico QR base64');
    }
    const bytes = base64ByteLength(base64);
    if (version === 2) {
      return {
        kind: 'yealico-v2',
        raw,
        version,
        base64,
        bytes,
        diagnostics: [
          {
            fieldPath: 'qr.payload',
            code: 'UNSUPPORTED_QR_PAYLOAD',
            detail: `Yealico QR v2 payload is opaque (${bytes} bytes); rule JSON or URL required`,
            severity: 'error',
          },
        ],
      };
    }
    return unsupported(raw, `unsupported Yealico QR version: v${version}`);
  }

  if (raw.startsWith('{') || raw.startsWith('[')) {
    return parseJsonPayload(raw, raw);
  }

  if (HTTP_URL.test(raw)) {
    return { kind: 'rule-url', raw, url: raw, diagnostics: [] };
  }

  if (/^yealico(?:-android)?:\/\//i.test(raw)) {
    return parseCustomScheme(raw, raw);
  }

  return unsupported(raw, 'unrecognized QR payload');
}
