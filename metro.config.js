const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // htmlparser2 / css-select / domutils 同时提供 CJS 与 ESM 入口。
    // 其 ESM 入口含 `export * as`，RN 的 Babel CJS 转换无法直接处理；
    // 这里让 package exports 优先选择 require 条件，保持 CJS 链路。
    unstable_conditionNames: ['react-native', 'require'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
