import { NativeModules } from 'react-native';

/**
 * 站点仓库持久化接口。
 *
 * Android 用 SiteStore 原生模块（SharedPreferences）；Jest/无原生模块时
 * 回退到进程内存，保证导入 UI 仍可运行。
 */
export interface SiteStorage {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

interface NativeSiteStore {
  load(): Promise<string | null>;
  save(value: string): Promise<boolean>;
  clear(): Promise<boolean>;
}

let memoryValue: string | null = null;

export function createSiteStorage(): SiteStorage {
  const native = NativeModules.SiteStore as NativeSiteStore | undefined;
  if (
    native &&
    typeof native.load === 'function' &&
    typeof native.save === 'function' &&
    typeof native.clear === 'function'
  ) {
    return {
      load: () => native.load(),
      async save(value) {
        await native.save(value);
      },
      async clear() {
        await native.clear();
      },
    };
  }
  return {
    async load() {
      return memoryValue;
    },
    async save(value) {
      memoryValue = value;
    },
    async clear() {
      memoryValue = null;
    },
  };
}
