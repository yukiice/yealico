import { NativeModules } from 'react-native';

interface QrScannerNativeModule {
  scan(): Promise<string>;
}

function scannerModule(): QrScannerNativeModule | undefined {
  return (NativeModules as { QrScanner?: QrScannerNativeModule }).QrScanner;
}

/** 当前构建是否带扫码模块（Jest、Web 或旧安装包为 false）。 */
export function isQrScannerAvailable(): boolean {
  return Boolean(scannerModule());
}

/**
 * 调起系统扫码 UI（Google Code Scanner）。
 *
 * 用户取消时 reject 的原因为 SCAN_CANCELED，调用方应视为“没有操作”。
 */
export async function scanQrCode(): Promise<string> {
  const scanner = scannerModule();
  if (!scanner) {
    throw new Error('当前构建没有扫码模块');
  }
  return scanner.scan();
}

/**
 * 把原生侧的错误翻译成用户能行动的一句话。
 *
 * Google Code Scanner 依赖 Play Services 的按需模块：没有 GMS 或模块
 * 下载不了的设备会报 "Waiting for the Barcode UI module to be downloaded."，
 * 这不是用户能处理的错误，必须直接给回退路径。
 */
export function describeScanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(text)) {
    return '已取消扫码';
  }
  if (/download|unavailable|not available|play services/i.test(text)) {
    return '当前设备无法使用系统扫码（需要 Google Play Services），请改用粘贴 JSON 或 https:// 规则 URL';
  }
  return `扫码失败: ${text}`;
}
