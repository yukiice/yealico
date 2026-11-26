# P6 内置站点与按阶段 WebView

本轮解决两个问题：站点只能靠手粘 600 多行 JSON 导入；引擎把「详情需要 JS」当成整站都需要 WebView。

## 1. 内置站点

新增 `src/app/sitePresets.ts`：一份策展清单，只决定「哪几条规则给用户一键导入」，规则正文仍以 `artifacts/yealico-rules` 为准，由 `scripts/sync-real-rules.mjs` 同步成 TS 常量。导入调用 `importRuleText(presetRuleText(preset), 'preset')`，与粘贴 JSON 完全同一条管线，因此诊断、去重（规则原文哈希）和持久化行为一致。

- 入口：「添加站点」弹层的第一个页签「内置站点」。
- 每个预设在副标题里写明已知限制，避免被理解成「完全适配」。
- 来源标记新增 `'preset'`，与 `'paste'` / `'url'` 并列；同一份规则换入口导入仍是同一 id。

`__tests__/site-presets.test.ts` 除了验证导入成功，还把 2026-11 对线上核实过的选择器写成断言（`#contList li`、`div.chapter-list ul li`、`#pageSelect option:last-child`、`#mangaBox img.mangaFile`）。规则常量由脚本重新生成，一旦 artifact 被替换，这些断言会先失败，而不是等真机白屏才发现。

## 2. 按阶段 WebView

### 问题

Yealico 的 `jsNeeded*` 标记是按阶段声明的（`jsNeededIndex` / `jsNeededDetail` / `jsNeededGallery`），但 `buildRoutePlan` 只要遇到任意一个就把 `capabilities.webview` 置真，`execute.ts` 的 `blockingDiagnostics` 又以「有没有 `NEEDS_WEBVIEW`」为准。于是「详情要 JS」的站点，静态的列表页也被塞进 WebView。

漫画柜就是典型：`flags: "jsNeededDetail"`，但首页是纯静态 HTML。实测同一份首页 HTML 走普通 fetch 抽到 0 条（被阻断），修复后抽到 172 条。

### 方案

`src/engine/phases.ts` 提供 `needsWebViewForPhase(plan, phase)`，从诊断的 `fieldPath` 反推阶段：

| 标记 | 生效阶段 |
| --- | --- |
| `jsNeededIndex` | 仅列表 |
| `jsNeededDetail` | 仅详情 |
| `jsNeededGallery` | 仅图库 |
| 其他 `jsNeeded*` | 所有阶段（保守） |

`execute.ts` 的四个入口各自带阶段：`executeList` → index、`executeDetail` → detail、`executeGallery` / `executePicturePage` → gallery。`shouldUseWebView(plan, forceWebView, phase)` 同步按阶段选择 fetcher，三个页面入口分别传 `index` / `detail` / `gallery`。站点级 `forceWebView` 开关仍然覆盖阶段判断。

### 规则侧的连带修正

分阶段后，原先靠「整站 WebView」兜住的规则必须显式声明，否则会静默退回 HTTP：

| 规则 | 原标记 | 现标记 |
| --- | --- | --- |
| 漫画柜 | `jsNeededDetail` | `jsNeededDetail,jsNeededGallery` |
| 拷贝漫画 | `jsNeededIndex,jsNeededDetail` | 追加 `jsNeededGallery` |
| Māngabz | `jsNeededDetail` | `jsNeededIndex,jsNeededDetail,jsNeededGallery` |

**注意**：设备上已导入的站点保存的是当时的规则原文，不会自动带上新标记，需要重新导入（或等后续做规则迁移）。

## 3. 漫画柜接入实证

| 环节 | 结论 |
| --- | --- |
| 首页列表 | `#contList li`、`a.bcover img`、`span.updateon` 结构未变；封面是协议相对地址 `//cf.mhgui.com`，`resolveUrl` 会补全为 https |
| 详情 | `h1`、`div.book-cover p.hcover img`、`div.chapter-list ul li`、`ul.detail-list` 均存活 |
| 章节页 | `#mangaBox` 与 `#pageSelect` 在原始 HTML 里是空壳，图片与页码由混淆 JS 注入 → 必须 WebView，且 `totalPages` / `image` 依赖注入后的节点 |
| 请求头 | 缺 `Accept-Language` 会被 nginx 直接 403；`BROWSER_HEADERS` 与原生 WebView 的 `loadUrl` 都已固定 `zh-CN` |
| UA 陷阱 | 移动端 UA 会被 301 到 `http://m.manhuagui.com`，release 构建默认禁止明文 HTTP；两条抓取路径都固定 macOS Chrome 126 才安全 |
| 网络 | 国内直连 `www.manhuagui.com:443` 超时（真机 `nc` 验证），需要代理才能拉取 |

## 4. 验证

- `npm run typecheck`、`npm run lint` 干净。
- `npm test`：31 suites / 178 tests 通过。
- 真机（PKB110，release 包，走代理）：内置站点一键添加 → 列表出封面（蜘蛛侠、无限正义联盟V2、扎坦娜V4、西海岸复仇者V2 等）→ 进入第 59 回，显示「第 1 / 453 章 · 已载 4 页 / 20」并渲染图片。
- 回归：拷贝漫画列表在改动后仍正常渲染。

## 5. 未做

- 站内搜索（`searchUrl` + `searchRule`）未在漫画柜上验证。
- 已装站点的规则标记迁移。
- 内置站点目前只有漫画柜一条。
