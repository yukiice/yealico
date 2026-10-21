# P1 工程基线与运行时验证记录

- 阶段：P1（工程骨架 + 最小规则执行验证）
- 记录日期：2026-10-20
- 状态：P1 核心链路已在 Node 与 Android 模拟器通过；Cookie/GBK/图片/WebView/真实页面性能探针仍未完成，因此 P1 不整体标记通过。
- 关联：[开发计划](../DEVELOPMENT_PLAN.md)、[评审](../DEVELOPMENT_PLAN_REVIEW.md)、[规则语义基线](../reference/yealico-rule-model.md)。

## 1. 版本基线

| 项 | 版本 / 值 | 说明 |
| --- | --- | --- |
| React Native | 0.83.10 | 选 stable 补丁版，不用 0.88 |
| React | 19.2.0 | 由 RN 模板锁定 |
| Node | 24.20.0 | 满足 RN 0.83 的 `>= 20.19.4` |
| npm | 11.19.0 | 使用已配置的 npmmirror 镜像 |
| JDK | Zulu 17.0.13 | Gradle 与 AGP 使用 |
| compileSdk / targetSdk | 36 | 本机已安装 |
| minSdk | 24 | 模板默认 |
| NDK | 27.1.12297006 | 本机已安装 |
| Gradle | 9.0.0 | 模板 wrapper |
| 解析库 | htmlparser2 9.1.0 + css-select 5.1.0 + domutils 3.1.0 + domhandler 5.0.3 | 全部 CJS |
| LZString | lz-string 1.5.0 | `decompressFromBase64` |
| 测试 | Jest 29 + react-test-renderer | 13 个用例 |

## 2. 关键选型与理由

### 2.1 bare RN，不用 Expo 托管

本项目的高风险点集中在 Cookie/OkHttp、图片请求头、WebView 会话，最终大概率需要自定义原生配置。bare RN 直接持有 `android/`，避免 config plugin 与 prebuild 的二次维护。iOS 目录未生成，首版仅 Android。

### 2.2 解析库选 CJS 旧主版本，不选最新 ESM

- `css-select@7` 的 `dist/index.js` 是 ESM，Jest 直接报 `Cannot use import statement outside a module`，Metro 链路也需要额外配置。
- `htmlparser2@9 + css-select@5 + domutils@3 + domhandler@5` 均为 CJS，Node/Jest 直接可用，Hermes 打包风险更低。
- 代价：不是最新版本；升级前必须补 Node + Android 双端回归。

### 2.3 不用 `jsonpath-plus`，改为受限 JSONPath

`jsonpath-plus@11` 的 Node 构建 `require('node:vm')`，Metro/Hermes 无法打包；其过滤表达式还会引入不必要的代码执行面。P1 自实现：

- 支持：`$`、`.key`、`['key']`、`[n]`、`[*]`。
- 不支持：`..`、`[?(...)]`、切片、联合。
- 不支持的语法进入 `UNSUPPORTED_JSONPATH`，不静默返回空。

这与主计划 3.3“限制可执行代码能力、未知能力明确失败”一致。若 P0b 样本证明需要过滤表达式，再评估受限表达式解析器，不允许直接引入 `eval`/`Function`。

### 2.4 函数链先实现 `.`，逗号形式明确拒绝

官方 Wiki 同时出现“逗号分隔”和“`.` 链式”两种说法（Q1）。P1：

- 支持 `decodeBase64.reversed` 这类 `.` 链。
- 顶层逗号链（如 `text,html`）抛 `UNSUPPORTED_FUNCTION_SYNTAX`，不猜语义。
- `replace("a", with: "b")` 的逗号在括号内，不会被误切。

### 2.5 fixture 单一来源

`docs/rules/samples` 是唯一来源；`scripts/sync-fixtures.mjs` 生成 `src/engine/fixtures.generated.ts`。Node 测试读 docs，Android 读生成文件，二者字节一致。

### 2.6 不依赖全局 URL

P1 在模拟器上发现：RN/Hermes 的全局 `new URL(relative, base)` 不做标准相对路径解析。`/img/a-2.jpg` 被拼成 `https://example.test/list/1/img/a-2.jpg`，`../img/a-1.jpg` 保留 `..`。Node/Jest 通过、Android 失败，说明不能把平台 URL 当规范实现。

改为 `src/engine/url.ts`：

- 自解析 authority / path / query / hash；
- 相对路径按 base 目录归一化 `.` / `..`；
- `{urlPath}` / `{urlQuery}` 复用同一解析结果。

修复后同一 fixture 在 Node 与 Android 均通过。该问题记录为 P1 的正式运行时差异，不用环境分支掩盖。

## 3. P1 已实现范围

- `buildRoutePlan`：Site/List/Detail/Gallery 字段白名单、flags 能力扫描、未知字段/函数/占位符/正则诊断。
- `expandUrl`：`{page}`、`{pageFormat}`、`{idCode}`、`{cidCode}`、`{keyword}`、`{domain}`、`{urlPath}`、`{urlQuery}`、`{urlScheme/Host/Port}`、`{json}`；嵌套括号与引号感知。
- `evaluateSelector`：CSS、`this`、JSONPath 子集、`text/html/attr/空函数`、`.` 函数链、regex/replacement、`|{source:}`、绝对 URL。
- `executeList` / `executeGallery`：静态 ListRule 与 GalleryRule。
- `executeDetail`：chapterRule / pictureRule、章节 URL 模板。
- `buildPageUrls` / `buildGalleryPageUrls`：`{page}`/`{pageFormat}` 展开、重复/空/200 页上限。
- `loadListPages` / `loadGalleryPages`：可注入 fetcher 的顺序抓页、去重、`noNewItems`/`NETWORK_ERROR` 终止。
- `resolveRulePage` / `buildPagePlan`：真实规则 `pages` 的页面选择与规则继承。
- `loadDetail`：详情 → `photoAlbumLink` → `pictureRule.link` 的顺序加载；`executePicturePage` 解析图片页。
- `totalImages` + `{page:}`：详情页图片模板展开（上限 500，缺总数告警）。
- URL 字段默认绝对化；`attr` 多属性按顺序取第一个非空；`{domain:}` 在 regex/replacement 中展开。
- `parseQrPayload`：识别 Yealico `v2:` opaque 载荷、加密导出 `{"encrypted":"v2:..."}`、规则 URL、原始 JSON、`yealico://`；不猜解密，不把扫码成功当导入成功。
- `scripts/extract_yealico_rules.py`：从 macOS Yealico 容器的 SQLite 只读提取规则；不读 Cookie/账号/历史。
- `toRuleDocument`：把提取结构转成项目 `RuleDocument`。
- 真实规则：本机提取 6 个站点，含禁漫 2.26、阿巴基猫 2.4。
- 合成 fixture 5 组：列表、图库、JSON、不支持能力、QR 载荷。

明确未实现：

- Android 真实规则执行、UI 阅读器与翻页。
- WebView、登录、consent、Cookie、图片加载。
- Yealico QR `v2:` 的实际解码与相机扫码 UI。
- `+` 多 JSONPath、`$root` 完整语法、数学表达式（P2）。
- GBK/Big5 解码与 GBK URL 编码。
- 真实站点的在线抓取（禁漫等成人站点不做未授权抓取）。

## 4. 命令与结果

```bash
npm run fixtures   # 生成 src/engine/fixtures.generated.ts
npm run lint       # eslint .
npm run typecheck  # tsc --noEmit && tsc -p tsconfig.test.json --noEmit
npm test -- --runInBand
```

Node 侧结果（2026-10-20）：

- lint：0 error / 0 warning。
- typecheck：通过（应用配置 + 测试配置）。
- Jest：14 个 suite、60 个用例全部通过（含 WebView renderer）。
- 覆盖：golden fixture、分页/URL 占位符、函数链、regex、受限 JSONPath、QR、真实 `List: recently`、Detail/Gallery、chapter URL 模板、attr fallback、分页编排与去重、pages、二级页、totalImages、直接 image 集合、WebView、fetch 超时与网络探针。

真实规则验证（2026-10-20）：

- 数据库：`ComiGa.sqlite`，`ZSITE` 6 条、`ZSITELISTRULE` 9 条、`ZSITEPAGE` 93 条。
- 禁漫 2.26：index/detail/gallery/series/search/tag 均提取；RoutePlan `static=true`，无 `INVALID_RULE`/`UNKNOWN_FIELD`；29 个 `pages` 可枚举，`月排行` 可选择并继承站点规则；合成 Detail 得到 2 章节，Gallery 得到 3 页/2 图，chapter URL 正确展开 `?page=2/3`。未支持 `searchUrl`、`seriesRule`、`displayMode=tag`。
- 阿巴基猫 2.4：真实 `List: recently` 对 `update_history` 提取 118 条、0 诊断；117 条带链接，第 118 条为空段落。
- P2 详情见 [P2 Detail/Gallery](p2-detail-gallery.md)。
- 详细方法与边界见 [macOS 容器规则提取](../rules/yealico-macos-sqlite.md)。

Android 侧结果（2026-10-20）：

- 设备：`sdk_gphone64_arm64`，API 36，arm64-v8a；AVD `RN_Test`。
- 构建：`./gradlew assembleDebug` 成功，`app-debug.apk` 约 101 MB（debug，未压缩/未混淆）。
- 启动：Metro + `adb reverse tcp:8081`，logcat 出现 `ReactNativeJS: Running "Yealico"`。
- 自检页：P1 时 `全部通过 (10)`，含 3 条 QR 检查（v2 识别、64 bytes、要求规则 JSON/URL）；截图 `artifacts/p1-android-pass.png`。
- 首次运行失败证据：`artifacts/p1-android.png`（URL 拼接错误），修复后重新验证。
- 基准（20 次，合成 fixture）：

| 样本 | avg | max | 输入字符数 |
| --- | --- | --- | --- |
| list | 1.38 ms | 1.92 ms | 1045 |
| gallery | 0.36 ms | 0.48 ms | 339 |
| json | 0.03 ms | 0.07 ms | 102 |

- 内存未测量；这些样本远小于真实页面，不能据此承诺线上性能。
- 开发循环注意：Metro 对新增文件的监听不稳定，改动引擎后需重启 Metro（`--reset-cache`）并清理应用数据，否则会继续执行旧 bundle。

P2 Android 验证（2026-10-21，API 36 / arm64-v8a）：

- APK 使用 Temurin 17 构建，`assembleDebug` 成功。
- 冷启动自检：`全部通过 (13)`，新增 pages 2 项、totalImages 1 项。
- 手动真实规则网络探针：`网络探针通过 (6)`，阿巴基猫 `update_history` 第 1 页 70 条；随后进入第一条详情页，`pictures=4`、`cover=yes`，列表/详情均 0 error diagnostics。
- 证据：`artifacts/p2-aba-detail.png`；只访问公开博客，未访问成人站点。
- 原生 WebView 探针：`WebView 探针通过 (2)`；本地 JS 页面生成章节列表，漫画柜形态 `chapterRule` 解析并展开章节 URL。
- 证据：`artifacts/p2-webview.png`；未访问漫画柜在线页面。
- 漫画柜在线探针：`漫画柜探针通过 (5)`；详情页 650 章，首章 `第745回 鸟笼`，第一页图库 1 图；当前图库 selector 需迁移为 `#mangaBox img.mangaFile`。
- 证据：`artifacts/p2-manhuagui-online.png`；只取 DOM/URL，不下载图片。

## 5. 待验证项（不得当作已通过）

| 项 | 状态 | 验收方式 |
| --- | --- | --- |
| Android Hermes 执行同一组 fixture | 已通过 | 10/10，`artifacts/p1-android-pass.png` |
| Node/Hermes 相对 URL 一致性 | 已通过 | `src/engine/url.ts` 自实现后双端一致 |
| Metro `package exports` ESM 解析 | 已解决 | `unstable_conditionNames: ['react-native', 'require']`，bundle 含新引擎 |
| Hermes `atob` / LZString | 待跑 | 在 selftest 中增加对应断言 |
| Hermes RegExp 命名组/lookbehind | 待跑 | 能力探针 |
| GBK/Big5 解码 | 待跑 | 需要编码表或原生能力 |
| 图片请求头与 Cookie 共享 | 待跑 | P1 探针，不实现 UI |
| fetch 的 Set-Cookie / 最终 URL | 待跑 | P1 探针，决定是否加 Kotlin 模块 |
| Yealico QR `v2:` 载荷 | 已识别；解码阻塞 | API36 10/10 识别；可用 [Yealico Edit 取证](../rules/yealico-rule-extraction.md)，但不能自动导入 |
| Yealico 加密导出 JSON | 已识别 | 3840 bytes 高熵；报 `UNSUPPORTED_ENCRYPTED_EXPORT`，见 [export-format](../rules/yealico-export-format.md) |
| 1 MB HTML 解析耗时/阻塞 | 待跑 | 记录 P95 与掉帧 |
| 真实规则兼容 | 部分完成 | 6 条已提取；禁漫 RoutePlan 无 invalid/unknown；阿巴基 118 条 |
| 真实规则 Android 执行 | 部分完成 | 阿巴基猫公开 List/Detail（详情 4 图）与漫画柜在线 Detail/Gallery（650 章/首图）通过；禁漫 Detail/Gallery 未在 Android 跑 |
| pages / 二级图片 / WebView / 网络编排 | 引擎 + Android List/Detail/WebView 已通 | Node/Jest、Android fetch/WebView 通过；阅读器 UI 待接；漫画柜在线未验收；search/series 未实现 |

## 6. 下一步

1. 做 P1 能力探针：fetch 的 Set-Cookie/最终 URL、CookieManager、图片 headers、GBK、RegExp、`atob`/LZString、1 MB 解析耗时。
2. 根据探针结果决定是否需要 Kotlin 模块；没有证据不建空壳。
3. 把 `loadDetail` / `loadGalleryPages` 接到 UI 与真实规则阅读流程；禁漫 search/series/displayMode 作为能力矩阵输入。
4. 把真实规则接入 Android selftest；在线验收只针对已授权/公开站点，成人站点不做未授权抓取。
