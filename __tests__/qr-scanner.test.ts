import { NativeModules } from 'react-native';

import { describeScanError, isQrScannerAvailable, scanQrCode } from '../src/platform/qrScanner';

const modules = NativeModules as Record<string, unknown>;

afterEach(() => {
  modules.QrScanner = undefined;
});

test('reports unavailable when the native module is missing', async () => {
  expect(isQrScannerAvailable()).toBe(false);
  await expect(scanQrCode()).rejects.toThrow('没有扫码模块');
});

test('returns the scanned payload when the native module exists', async () => {
  modules.QrScanner = {
    scan: jest.fn().mockResolvedValue('{"name":"Scanned Site"}'),
  };

  expect(isQrScannerAvailable()).toBe(true);
  await expect(scanQrCode()).resolves.toBe('{"name":"Scanned Site"}');
});

test('propagates native scan failures', async () => {
  modules.QrScanner = {
    scan: jest.fn().mockRejectedValue(new Error('SCAN_CANCELED')),
  };

  await expect(scanQrCode()).rejects.toThrow('SCAN_CANCELED');
});

test('describes scan errors with an actionable fallback', () => {
  expect(describeScanError(new Error('SCAN_CANCELED'))).toBe('已取消扫码');
  expect(
    describeScanError(
      new Error('Waiting for the Barcode UI module to be downloaded.'),
    ),
  ).toContain('请改用粘贴 JSON');
  expect(describeScanError(new Error('boom'))).toBe('扫码失败: boom');
});
