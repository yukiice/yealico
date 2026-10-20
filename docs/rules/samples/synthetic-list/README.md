# 合成样本：静态列表

- 性质：**合成 fixture**，用于验证引擎语义，不代表任何真实站点。
- 覆盖：CSS 选择器、`item` 作用域、`attr`、`text`、`regex` + `$1`、相对 URL 绝对化、多字段顺序。
- 输入：`page.html` + `rule.json`。
- 基准：`expected.json`，其中 `baseUrl` 是列表页展开后的 URL，用于相对地址解析。
- 约束：
  - `cover` 的 `../img/a-1-large.jpg` 必须解析为 `https://example.test/img/a-1-large.jpg`。
  - 结果顺序必须与 DOM 顺序一致。
  - 不测试 `totalImages`、GalleryRule 或任何网络行为。
