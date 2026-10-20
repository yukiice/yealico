/**
 * 最小 URL 解析与相对地址归一化。
 *
 * 为什么不用全局 `new URL()`：
 * - Node 的实现符合 WHATWG；RN/Hermes 的 polyfill 在相对地址上只做字符串拼接，
 *   `/img/a.jpg` 与 `../img/a.jpg` 都会拼到当前目录后面（P1 模拟器实测）。
 * - 规则里的 `absoluteUrl`、`{urlPath}`、`{urlQuery}` 都依赖稳定的解析结果，
 *   因此这里用一套在 Node 与 Hermes 上一致的实现。
 *
 * 只覆盖规则需要的部分：http(s) 绝对地址、authority、path、query、hash。
 */

export interface ParsedUrl {
  /** 不含冒号，例如 https */
  protocol: string;
  /** hostname[:port] */
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  /** 不含问号 */
  search: string;
  /** 不含井号 */
  hash: string;
}

const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

export function parseUrl(input: string | undefined): ParsedUrl | null {
  if (!input) {
    return null;
  }
  const match = ABSOLUTE_URL.exec(input.trim());
  if (!match) {
    return null;
  }
  const protocol = match[1].toLowerCase();
  const authority = match[2];
  const pathname = match[3] || '/';
  const search = match[4] ?? '';
  const hash = match[5] ?? '';

  let hostname = authority;
  let port = '';
  const at = authority.lastIndexOf('@');
  if (at !== -1) {
    hostname = authority.slice(at + 1);
  }
  if (hostname.startsWith('[')) {
    const close = hostname.indexOf(']');
    if (close !== -1) {
      const after = hostname.slice(close + 1);
      if (after.startsWith(':')) {
        port = after.slice(1);
      }
      hostname = hostname.slice(0, close + 1);
    }
  } else {
    const colon = hostname.lastIndexOf(':');
    if (colon !== -1 && /^\d+$/.test(hostname.slice(colon + 1))) {
      port = hostname.slice(colon + 1);
      hostname = hostname.slice(0, colon);
    }
  }

  return {
    protocol,
    host: port ? `${hostname}:${port}` : hostname,
    hostname,
    port,
    pathname: pathname.startsWith('/') ? pathname : `/${pathname}`,
    search,
    hash,
  };
}

export function normalizePath(path: string): string {
  const leading = path.startsWith('/');
  const trailing = path.endsWith('/');
  const stack: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  const joined = stack.join('/');
  const prefix = leading ? '/' : '';
  if (!joined) {
    return leading ? '/' : '';
  }
  return `${prefix}${joined}${trailing ? '/' : ''}`;
}

function splitPath(pathWithQueryAndHash: string): {
  path: string;
  search: string;
  hash: string;
} {
  let braceDepth = 0;
  let quote: string | null = null;
  let escaped = false;
  let queryIndex = -1;
  let hashIndex = -1;

  for (let i = 0; i < pathWithQueryAndHash.length; i += 1) {
    const ch = pathWithQueryAndHash[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      continue;
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth === 0 && ch === '?' && queryIndex === -1) {
      queryIndex = i;
      continue;
    }
    if (braceDepth === 0 && ch === '#' && hashIndex === -1) {
      hashIndex = i;
      break;
    }
  }

  const end = hashIndex === -1 ? pathWithQueryAndHash.length : hashIndex;
  const queryEnd = queryIndex === -1 ? end : queryIndex;
  return {
    path: pathWithQueryAndHash.slice(0, queryEnd),
    search:
      queryIndex === -1
        ? ''
        : pathWithQueryAndHash.slice(queryIndex + 1, end),
    hash:
      hashIndex === -1 ? '' : pathWithQueryAndHash.slice(hashIndex + 1),
  };
}

export function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export function getQueryValue(search: string, key: string): string | null {
  if (!search) {
    return null;
  }
  for (const pair of search.split('&')) {
    if (!pair) {
      continue;
    }
    const equals = pair.indexOf('=');
    const rawKey = equals === -1 ? pair : pair.slice(0, equals);
    if (decodeQueryComponent(rawKey) === key) {
      return equals === -1 ? '' : decodeQueryComponent(pair.slice(equals + 1));
    }
  }
  return null;
}

/**
 * 把 relative 解析为绝对地址；baseUrl 必须是绝对地址。
 * 与 WHATWG URL 的 br[href] 行为对齐，但不依赖平台实现。
 */
export function resolveUrl(relative: string, baseUrl: string): string {
  if (!relative) {
    return '';
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relative)) {
    return relative;
  }

  const base = parseUrl(baseUrl);
  if (!base) {
    return relative;
  }

  const origin = `${base.protocol}://${base.host}`;

  if (relative.startsWith('//')) {
    return `${base.protocol}:${relative}`;
  }

  if (relative.startsWith('/')) {
    const parts = splitPath(relative);
    return `${origin}${normalizePath(parts.path)}${
      parts.search ? `?${parts.search}` : ''
    }${parts.hash ? `#${parts.hash}` : ''}`;
  }

  if (relative.startsWith('?')) {
    return `${origin}${base.pathname}${relative}`;
  }

  if (relative.startsWith('#')) {
    return `${origin}${base.pathname}${base.search ? `?${base.search}` : ''}${relative}`;
  }

  const directory = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  const parts = splitPath(relative);
  return `${origin}${normalizePath(`${directory}${parts.path}`)}${
    parts.search ? `?${parts.search}` : ''
  }${parts.hash ? `#${parts.hash}` : ''}`;
}
