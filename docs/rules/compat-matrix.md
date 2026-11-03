# 兼容矩阵（P0a 骨架）

- 状态只允许：`已支持` / `部分支持` / `不支持` / `待验证`。
- “已支持”必须能指向离线 fixture 或在线记录；**不能用“函数已实现”代替行为验证**。
- 真实站点行在拿到用户规则样本前一律为 `待验证`，不得因为合成 fixture 通过就改成“已支持”。
- 规则哈希：导入原文的 SHA-256 前 8 位；原文变更后必须换行。
- 关联：[规则语义基线](../reference/yealico-rule-model.md)、[待确认项](open-questions.md)。

## 1. 样本级矩阵

| 规则哈希 | 站点 / 样本 | 页面类型 | 能力 | 首版必需 | 离线证据 | Android 证据 | 在线证据 | 状态 | 限制 / 错误码 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `synthetic01` | 合成：静态列表 | List | CSS、attr、regex、相对 URL | 是 | `samples/synthetic-list/expected.json` | API36 PASS（7/7） | 不适用 | 已支持 | 合成样本，不代表真实站点 |
| `synthetic02` | 合成：图库分页 | Gallery | GalleryRule、totalPages、`{page:1}` | 是 | `samples/synthetic-gallery/expected.json` | API36 PASS（7/7） | 不适用 | 已支持 | 合成样本 |
| `synthetic03` | 合成：JSONPath | List | JSONPath（无 `$root`） | 是 | `samples/synthetic-json/expected.json` | API36 PASS（7/7） | 不适用 | 部分支持 | `$root` 未测试（Q12） |
| `synthetic04` | 合成：不支持能力 | Detail | `jsNeededDetail`、未知函数 | 是 | `samples/synthetic-unsupported/expected-plan.json` | API36 PASS（7/7） | 不适用 | 已支持 | 仅验证诊断，不执行页面 |
| `real-aba-2.4` | 阿巴基猫（作者自建 WordPress） | List/Detail | 静态列表、text、pictureRule | 是 | SQLite 提取 + `List: recently` / `buildPagePlan` / `loadDetail` 测试 | API36 网络探针 PASS（列表 70 条，详情 4 图） | 真实页 118 条（117 链接 + 1 空段） | 部分支持 | search/waterfall 未实现；见 [SQLite](yealico-macos-sqlite.md) |
| `real-jm-2.26` | 禁漫天堂（作者规则） | List/Detail/Gallery | CSS、chapterRule、tagRule、gallery、pages | 是 | SQLite 提取；RoutePlan `static=true`；29 页可选；detail 2 章节 / gallery 3 图 3 页（合成页） | 待跑 | 未抓取（成人站点，不做未授权抓取） | 部分支持 | search/series/displayMode tag 未实现 |
| `real-manhuagui-1.7` | 漫画柜（公开页） | Detail/Gallery | WebView、chapterRule、直接 image 集合 | 是 | 真实规则 + 合成/在线探针 | API36 在线 PASS（650 章 / 18 页 / 阅读器出图） | 在线详情/章节/多页已取 | 部分支持 | 图片选择器为 `#mangaBox img.mangaFile, #manga>img`；总页数读 `#pageSelect option:last-child` |
| `real-mangabz-2.1` | M-ngabz / comicbz.com（作者规则） | List/Detail/Gallery | JSONPath 列表、WebView、chapterRule、gallery（iPhone UA） | 是 | Jest 渲染 DOM（21 项 / 5 章 / 30 图） | 真机列表 10+、详情 5 章、阅读器 20 图 | 在线 API / 章节页已取 | 部分支持 | 列表走 WebView 渲染 JSON API，需解包 `<pre>`；图库页面用 `gallery.httpHeaders` 的 iPhone UA |
| `real-mangacopy-2.15` | 拷贝漫画（作者规则） | List/Detail/Gallery | WebView、`jsNeededIndex`/`jsNeededDetail`、chapterRule、gallery | 是 | 规则 + Jest 渲染 DOM（12 章 / 3 图） | 真机列表 10 部；详情 16 章（限流窗口） | 接口桌面/移动 CH 对比：4898 vs 610 字节 | 部分支持 | 章节接口与章节页主文档需桌面 CH 代发；图库真机待复测（站点限流） |
| `real-pending-a` | 真实样本 A | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待验证 | 需要用户提供规则 JSON 与详情 URL |
| `real-pending-b` | 真实样本 B | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待验证 | 同上 |
| `real-pending-c` | 真实样本 C | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待验证 | 同上 |

## 2. 能力级矩阵

能力级矩阵回答“某个规则函数/占位符/flag 是否真的按语义工作”，样本级矩阵回答“某个站点是否可用”。两者不能互相替代。

**Node/Hermes 的 PASS 仅指合成 fixture；真实站点仍为 `待验证`，直到 P0b 提供样本并完成在线验收。**

| 能力 | 类别 | 首版必需 | 离线 fixture | Node | Hermes | 在线 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CSS 选择器 + `item` | 选择器 | 是 | `synthetic-list` | PASS | PASS | — | 已支持 | 合成 fixture |
| JSONPath（子集） | 选择器 | 是 | `synthetic-json` | PASS | PASS | — | 部分支持 | 无 `$..`/过滤；见 Q12/Q27 |
| `+` 多 JSONPath | 选择器 | 待样本确认 | 待补 | 待跑 | 待跑 | — | 不支持 | P1 明确报错；见 Q7 |
| `text` / `html` / `attr` / 空函数 | 取值 | 是 | `synthetic-list` | PASS | PASS | — | 已支持 | 合成 fixture |
| `attr` 多属性 fallback | 取值 | 是 | 真实禁漫规则 | PASS | 待跑 | — | 已支持 | `data-original, src` 取第一个非空 |
| `regex` + `replacement` + `$1` | 取值 | 是 | `synthetic-list` | PASS | PASS | — | 已支持 | — |
| `\|{source:}` | 取值 | 是 | 单元测试 | PASS | 待跑 | — | 部分支持 | 无匹配保留原串 |
| `replace(..., with: ...)` | 函数 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | 见 Q2 |
| `decodeBase64` | 函数 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | Hermes `atob` 待测 |
| `decompressFromBase64` (LZString) | 函数 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | 纯 JS 库，Hermes 待跑 |
| `reversed` | 函数 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | 见 Q4 |
| `regexReplacement` | 函数 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | — |
| `addingPercentEncoding` | 函数 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | 字符集语义待定 |
| `{page:start:step}` | 占位符 | 是 | `synthetic-gallery` | PASS | PASS | — | 已支持 | — |
| `{pageFormat:{...}}` | 占位符 | 待样本确认 | 单元测试 | PASS | 待跑 | — | 部分支持 | 嵌套解析 |
| `{idCode:}` / `{cidCode:}` | 占位符 | 是 | `synthetic-list` / `gallery` | PASS | PASS | — | 已支持 | — |
| `{json:...}` | 占位符 | 待样本确认 | 单元测试 | PASS | 待跑 | — | 部分支持 | 强制 POST |
| `{urlPath:n}` / `{urlQuery:k\|d}` | 占位符 | 是 | 单元测试 | PASS | 待跑 | — | 部分支持 | v7.1.1 |
| `pages` 页面选择 / 规则继承 | 导航 | 是 | `__tests__/pages.test.ts` + 真实禁漫 | PASS | PASS | — | 部分支持 | 页面级 headers 优先级仍待样本；见 Q6 |
| `totalImages` + `{page:}` 推导 | 分页 | 待样本确认 | `__tests__/total-images.test.ts` | PASS | PASS | — | 部分支持 | 页码/step 仍按 Q5 默认假设 |
| `photoAlbumLink` / `secondLevelPageUrl` | 二级页 | 是 | `__tests__/second-level.test.ts` + 拷貝/M-ngabz 真实规则 | PASS | 待跑 | — | 部分支持 | 真实在线页未抓取；见 Q25 |
| `gbkCharset*` | 字符集 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | Hermes 解码待测 |
| `gbkUrlEncodingAll` | 编码 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | 见 Q18 |
| `jsNeeded*` | 能力 | 识别 | `synthetic-unsupported` | PASS | PASS | — | 部分支持 | 识别并报 `NEEDS_WEBVIEW`，P4 实现 |
| `chapterRule` + `{pageFormat}` | Detail | 是 | 真实禁漫规则 | PASS | 待跑 | — | 部分支持 | 2 章节 + 翻页模板 |
| `GalleryRule` 图片/总页数 | Gallery | 是 | 真实禁漫规则 | PASS | 待跑 | — | 部分支持 | 3 图/3 页；相对图片绝对化 |
| `GalleryRule` 无 item 的直接 image 集合 | Gallery | 待样本确认 | 漫画柜 1.7 + 合成 | PASS | 待跑 | — | 部分支持 | 默认 src/data-src/data-original；见 P2 |
| `jsNeededDetail` / WebView | 能力 | 是 | 本地 JS 页面 + 漫画柜 chapterRule | PASS | PASS | — | 部分支持 | DOM 渲染/等待 marker 已通；拷贝章节接口与章节主文档需桌面 CH 代发（UA-CH 分流） |
| `post*` | 请求 | 是 | 待补 | 待跑 | 待跑 | — | 待验证 | — |
| `ignoreDetail` | 导航 | 待样本确认 | 待补 | 待跑 | 待跑 | — | 待验证 | 见 Q24 |
| `displayMode` | 展示 | 部分 | 待补 | — | — | — | 部分支持 | 首版 text/collection |

## 3. 导入载体矩阵

| 载体 | 状态 | 证据 / 限制 |
| --- | --- | --- |
| 规则 JSON（粘贴/文件） | 支持 | `importRuleText`；领域层测试 PASS |
| `http(s)://` 规则 URL | 支持 | `importRuleFromUrl`；release 构建只允许 `https://` |
| Yealico 导出 `{"encrypted":"v2:..."}` | 不支持 | 3840 bytes 高熵；报 `UNSUPPORTED_ENCRYPTED_EXPORT`；见 [export-format](yealico-export-format.md) |
| Yealico QR `v2:` | 已移除 | 2026-10-22 确认是 CloudKit 引用，密钥不在客户端，离线不可解码；相机扫码、QR 解析层与 `UNSUPPORTED_QR_PAYLOAD` 已删除，见 [qr-import.md](qr-import.md) |

## 4. 更新规则

1. 每个真实样本导入后，先记录原文哈希和来源，再填能力。
2. 离线通过填 `Node` / `Hermes` 列；在线通过填 `在线` 列；两者分开。
3. 出现“合成通过、真实失败”时，保持状态 `部分支持`，并新增一行记录差异，不允许回退成“已支持”。
4. 因站点改版导致的失败，标记 `站点变更`，不要把责任归到引擎；引擎问题标记 `引擎缺陷`。
