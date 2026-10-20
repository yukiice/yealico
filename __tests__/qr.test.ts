import { parseQrPayload } from '../src/engine';

const SAMPLE =
  'Yealico QR Code: v2:ImJpWmDcnxYVUFVnmJTeQGK+gxDqQ54aXbjfZZYW95uwfyG8ZZieqthW0YRHnOrYWtbM6vtu+l/vxEh4XrmCdg==';
const MAIN =
  'Yealico QR Code: v2:ImJpWmDcnxYVUFVnmJTeQJD6x0fbWBTXHgnHmaPH8p4W9et2fH04qTzTg9Q5ZHZ2VETeIcoDOne9VLYnWfDGCQ==';

describe('QR payload gate', () => {
  test('recognizes Yealico v2 as opaque, not as an importable rule', () => {
    const result = parseQrPayload(SAMPLE);
    expect(result.kind).toBe('yealico-v2');
    expect(result.version).toBe(2);
    expect(result.bytes).toBe(64);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_QR_PAYLOAD',
        fieldPath: 'qr.payload',
      }),
    ]);
  });

  test('two v2 payloads share a 16-byte prefix and differ afterwards', () => {
    const cn = parseQrPayload(SAMPLE);
    const main = parseQrPayload(MAIN);
    const cnBytes = Buffer.from(cn.base64 ?? '', 'base64');
    const mainBytes = Buffer.from(main.base64 ?? '', 'base64');

    expect(cnBytes).toHaveLength(64);
    expect(mainBytes).toHaveLength(64);
    expect(cnBytes.subarray(0, 16)).toEqual(mainBytes.subarray(0, 16));
    expect(cnBytes.subarray(16)).not.toEqual(mainBytes.subarray(16));
  });

  test('rejects Yealico encrypted export instead of treating it as a rule', () => {
    const result = parseQrPayload('{"encrypted":"v2:AAAA"}');
    expect(result.kind).toBe('unsupported');
    expect(result.diagnostics[0].code).toBe('UNSUPPORTED_ENCRYPTED_EXPORT');
  });

  test('accepts a plain rule URL', () => {
    const result = parseQrPayload('https://example.test/rules/site.json');
    expect(result.kind).toBe('rule-url');
    expect(result.url).toBe('https://example.test/rules/site.json');
    expect(result.diagnostics).toEqual([]);
  });

  test('accepts a raw rule JSON object', () => {
    const result = parseQrPayload('{"name":"Example","indexUrl":"https://example.test"}');
    expect(result.kind).toBe('rule-json');
    expect(result.json).toContain('"name":"Example"');
    expect(result.diagnostics).toEqual([]);
  });

  test('accepts yealico:// import URLs with url or rule query', () => {
    const byUrl = parseQrPayload(
      'yealico://import?url=https%3A%2F%2Fexample.test%2Frule.json',
    );
    expect(byUrl.kind).toBe('rule-url');
    expect(byUrl.url).toBe('https://example.test/rule.json');

    const byRule = parseQrPayload(
      'yealico://import?rule=%7B%22name%22%3A%22Example%22%7D',
    );
    expect(byRule.kind).toBe('rule-json');
  });

  test('rejects invalid base64 and unknown payloads explicitly', () => {
    const invalid = parseQrPayload('Yealico QR Code: v2:not-base64');
    expect(invalid.kind).toBe('unsupported');
    expect(invalid.diagnostics[0].code).toBe('UNSUPPORTED_QR_PAYLOAD');

    const unknown = parseQrPayload('some random text');
    expect(unknown.kind).toBe('unsupported');
    expect(unknown.diagnostics[0].code).toBe('UNSUPPORTED_QR_PAYLOAD');
  });
});
