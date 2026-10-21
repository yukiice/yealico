# 本地规则与测试证据

本目录用于私有仓库的兼容性测试，**不要公开再分发**。

## `yealico-rules/`

从本机 macOS 版 Yealico 7.2.4 的容器 SQLite（`ComiGa.sqlite`）只读提取：

- 6 个站点条目，含禁漫天堂 2.26、阿巴基猫 2.4
- 只包含站点元数据、URL、规则 JSON、命名规则、页面引用
- **不包含** Cookie、账号、收藏、历史、下载任务
- 作者：`wc3818290`
- 提取脚本：`scripts/extract_yealico_rules.py`
- 方法说明：`docs/rules/yealico-macos-sqlite.md`

用途：

- `__tests__/real-rules.test.ts` 的真实规则回归
- P2/P3 的 Detail/Gallery、pages、分页验证
- 另一台机器无需 macOS Yealico 也能跑真实规则测试

## `yealico-export-sample.json`

用户提供的 Yealico 加密导出样本：

- 外层 `{"encrypted":"v2:<base64>"}`
- 3840 bytes 高熵数据，未解出明文
- 仅用于格式研究，不当作规则导入

## `p1-android*.png`

Android 模拟器上的 P1 自检证据：

- `p1-android-pass.png`：10/10 通过
- `p1-android.png`：早期 URL polyfill 失败证据

## `p2-aba-detail.png`

Android 模拟器上的 P2 验证证据（2026-10-21）：

- 同步自检：13/13 通过（含 pages、totalImages）
- 公开站点网络探针：6/6 通过，阿巴基猫 `update_history` 第 1 页 70 条，随后进入第一条详情页得到 4 张图片、0 error diagnostics
- 只访问公开博客；未访问禁漫等成人站点

## `p2-webview.png`

Android 原生 WebView 验证证据（2026-10-21）：

- 同步自检：13/13 通过
- WebView 探针：2/2 通过；本地 JS 页面异步生成 `.chapter-list`，WebView 等到 marker 后取 outerHTML
- 漫画柜形态的 `chapterRule` 解析出章节 id `456`，并把 `#p={page:1}` 展开为 `#p=1`
- 未访问漫画柜在线页面

## `p2-manhuagui-online.png`

漫画柜公开页在线验收（2026-10-21）：

- 详情页 `ONE PIECE航海王`，章节列表 650 条，首章 `第745回 鸟笼`
- 章节 URL 模板 `#p={page:1}` 正确保留
- 图库首图抓取成功，探针 5/5；当前站点图库 selector 已改版（`#mangaBox img.mangaFile`）
- 只取 DOM/URL，不下载图片、不批量翻页

## 生成的真实规则

`src/engine/real-rules.generated.ts` 由 `npm run rules:sync` 生成，只包含阿巴基猫公开站点规则，供 Android 网络探针打包使用；生成文件同样只在私有仓库/本地测试使用。

## `lucky/`

第三方文章截图，仅本地分析使用，**未提交、未再分发**。
