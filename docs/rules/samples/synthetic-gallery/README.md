# 合成样本：GalleryRule 分页

- 性质：**合成 fixture**，不代表真实站点。
- 覆盖：`GalleryRule`、`totalPages`、`{cidCode:}` + `{page:1}` 展开、`this` 作用域、图片 URL 绝对化。
- 输入：`page.html` + `rule.json`；`galleryRule` 作用于 `galleryUrl` 展开后的 `https://example.test/gallery/ch-1/1`。
- 基准：`expected.json`。
- 约束：
  - `totalPages` 必须是数字 `3`，不是字符串。
  - 图片顺序必须与 DOM 顺序一致。
  - 本 fixture 不测试跨页抓取；跨页终止条件见 `open-questions.md` Q19。
