# 合成样本：不支持能力

- 性质：**合成 fixture**，用于验证 RoutePlan 的能力扫描和结构化错误，不代表真实站点。
- 覆盖：`jsNeededDetail`、`loginRequired`、未知函数、未知 Selector 字段、首版不实现的 `searchUrl`、未知占位符。
- 输入：`rule.json`。
- 基准：`expected-plan.json`。
- 断言方式：
  - `capabilities` 按字段比对。
  - `unsupported` **按 `code + fieldPath` 集合比对，不依赖数组顺序**。
  - 不允许把未知能力静默变成空结果；不允许用 `UNSUPPORTED_FEATURE` 一个码覆盖所有情况。
- 说明：`searchUrl` 在首版不实现，因此即使它含有未知占位符，也同时产生 `UNSUPPORTED_FEATURE`；这是有意设计，用来验证“先判范围、再判细节”的诊断顺序。
