import { createFetchRuleFetcher } from '../src/platform/ruleFetcher';
import type { FetchInitLike } from '../src/platform/ruleFetcher';

function response(
  body: string,
  init: { status?: number; url?: string; headers?: unknown } = {},
) {
  return {
    status: init.status ?? 200,
    url: init.url,
    headers: init.headers,
    async text() {
      return body;
    },
  };
}

test('adapts RuleRequest to fetch and preserves response metadata', async () => {
  const calls: Array<{ url: string; init?: FetchInitLike }> = [];
  const fetcher = createFetchRuleFetcher({
    credentials: 'include',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response('ok', {
        url: 'https://example.test/final',
        headers: {
          'content-type': 'text/html',
        },
      });
    },
  });

  const result = await fetcher.fetch({
    url: 'https://example.test/start',
    method: 'POST',
    headers: { 'x-test': '1' },
    body: '{"a":1}',
    timeoutMs: 1000,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://example.test/start');
  expect(calls[0].init).toMatchObject({
    method: 'POST',
    headers: { 'x-test': '1' },
    body: '{"a":1}',
    credentials: 'include',
  });
  expect(calls[0].init?.signal).toBeDefined();
  expect(result).toEqual({
    url: 'https://example.test/final',
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: 'ok',
  });
});

test('reads Headers objects through forEach', async () => {
  const headers = {
    forEach(callback: (value: string, key: string) => void) {
      callback('text/plain', 'content-type');
      callback('42', 'content-length');
    },
  };
  const fetcher = createFetchRuleFetcher({
    fetchImpl: async () => response('body', { headers }),
  });

  const result = await fetcher.fetch({
    url: 'https://example.test/',
    method: 'GET',
    headers: {},
  });

  expect(result.headers).toEqual({
    'content-type': 'text/plain',
    'content-length': '42',
  });
});

test('aborts a request after the configured timeout', async () => {
  jest.useFakeTimers();
  try {
    const fetcher = createFetchRuleFetcher({
      timeoutMs: 10,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as
            | {
                addEventListener?: (
                  event: string,
                  callback: () => void,
                ) => void;
              }
            | undefined;
          signal?.addEventListener?.('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    });

    const pending = fetcher.fetch({
      url: 'https://example.test/slow',
      method: 'GET',
      headers: {},
    });
    jest.advanceTimersByTime(20);

    await expect(pending).rejects.toThrow(
      'request timed out after 10ms: https://example.test/slow',
    );
  } finally {
    jest.useRealTimers();
  }
});

test('fills browser headers and keeps rule overrides', async () => {
  const calls: Array<{ init?: FetchInitLike }> = [];
  const fetcher = createFetchRuleFetcher({
    fetchImpl: async (_url, init) => {
      calls.push({ init });
      return response('ok');
    },
  });

  await fetcher.fetch({
    url: 'https://example.test/',
    method: 'GET',
    headers: { 'x-test': '1' },
  });
  expect(calls[0].init?.headers).toMatchObject({
    'x-test': '1',
    'User-Agent': expect.stringContaining('Mozilla'),
    Accept: expect.stringContaining('text/html'),
    'Accept-Language': expect.stringContaining('zh-CN'),
  });

  await fetcher.fetch({
    url: 'https://example.test/',
    method: 'GET',
    headers: { 'user-agent': 'Custom', Accept: 'application/json' },
  });
  const headers = calls[1].init?.headers ?? {};
  expect(headers['user-agent']).toBe('Custom');
  expect(headers.Accept).toBe('application/json');
  expect(headers['User-Agent']).toBeUndefined();
});
