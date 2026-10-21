# 《RN + 按需原生开发计划》评审

- 评审对象：`docs/DEVELOPMENT_PLAN.md`
- 评审日期：2026-10-20
- 评审基线：仓库仅 `LICENSE` 与该计划；无应用工程、无规则样本
- 结论：**方向可以保留，但不能按现稿直接进入 P2**。有 4 处结构性缺口会直接造成返工，需先修订 P0/P1 的定义。

## 0. 结论摘要

计划中正确的部分：

- 单一规则语义核心 + 多适配器，禁止 Kotlin 另写一套引擎。
- 静态优先、WebView 受控、不以“结果为空”推断需要浏览器。
- 按阶段做垂直切片，不先铺完整 UI。
- 不编造兼容性，不把合成 fixture 当真实验收。

需要修订的部分：

| 编号 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| A1 | 规则模型缺少 `GalleryRule`、`Site.pages`、`flags` 的一等建模 | P2 数据模型和 P3 导航会返工 | 先建 RoutePlan，再写执行器 |
| A2 | 占位符与 Selector 语义按“字符串展开”描述，实际存在嵌套、引号、命名参数和特殊推导 | 解析器会写错，兼容性不可测 | 解析器必须括号/引号感知，逐条 fixture |
| B1 | Cookie、字符集、图片请求头被放到 P4，但它们决定 P1 的基座选型 | 可能选错 RN/Expo/原生边界，P3 才发现 | P1 增加“运行时能力探针” |
| C1 | P1 被写成依赖 P0 的真实样本验收 | 没有样本时整条链停摆 | P0 拆 P0a/P0b，P1 只依赖 P0a |
| D1 | 验收标准多为定性描述 | 无法判定“通过/未通过” | 改为可执行的判据和证据文件 |
| A7 | 把“Yealico-compatible”第三方 schema 当作参考实现的风险 | 会把自有 schema 误当官方语义 | 以官方 Wiki + 用户样本为准，第三方仅作产品参考 |

## 1. 已核实的事实基线

以下不是推测，来自官方 Site Rule Wiki（页面标注 update 2026-02-28）和本机环境探测。

### 1.1 规则是四层结构，不是“站点 + 一组选择器”

- 顶层 `Site`：`name`、`domain`、`displayMode`、`loginUrl`、`indexUrl` / `detailUrl` / `galleryUrl` / `searchUrl`、`flags`、`headers`、`pages`，以及 `indexRule` / `detailRule` / `galleryRule` / `seriesRule`。
- 四类 Rule：`SeriesRule`、`ListRule`、`DetailRule`、`GalleryRule`。`GalleryRule` 是图片浏览页，有自己的 `totalPages`、`item`、`image`、`secondLevelPageUrl`，不是 `DetailRule.pictureRule` 的别名。
- `DetailRule` 内含 `tagRule`、`pictureRule`、`chapterRule`、`commentRule`、`photoAlbumLink`。
- `Selector` 五要素：`selector`、`function`、`param`、`regex`、`replacement`。
- `pages` 支持多套页面，每套可覆盖 `displayMode`、`flags`、URL 模板和规则，用 `relListRuleIndex` 关联。

现稿 1.2 的首版闭环只写到“详情 / 必要的章节列表 → 图片阅读”，没有把 `GalleryRule` 作为独立页面类型，也没有处理 `ignoreDetail`（列表直接进图库）。这会在 P2 的数据模型和 P3 的导航上同时返工。

### 1.2 分页不是“翻页参数”，有多种语义

- `{page:start:step}`、`{page:1}`：URL 模板展开。
- `{pageFormat:{page:start:step}}`：首页不带分页信息的嵌套形式。
- `totalImages` + `pictureRule.url` 中的 `{page:}`：客户端按总数推导所有大图 URL，不需要逐页请求。
- `{json:...}`：URL 中带 JSON body，请求方法自动切 POST。
- 搜索用 `{keyword:}`；详情用 `{idCode:}`；章节用 `{cidCode:}`；`{domain:}`（6.5+）。
- v7.1.1 增加 URL 派生占位符：`{urlPath:n}`（0 为主机、支持负数与 `*`）、`{urlQuery:key}`、`{urlQuery:key|default}`、`{urlQuery:*}`、`{urlScheme}`、`{urlHost}`、`{urlPort}`，大小写不敏感。

现稿 3.1 只写“URL / 请求占位符展开、分页计划”，不足以约束实现。尤其是 `{json:...}` 内可能含 `}` 和引号，`{pageFormat:{...}}` 是嵌套占位符，简单正则或 `split` 会解析错。

### 1.3 Selector 语义存在官方文档内部的歧义

- `function` 一节说多个函数用逗号分隔；后文又说用 `.` 链式，从左到右执行。
- `replace("String1", with: "String2")` 的命名参数本身含逗号，直接按逗号切分会破坏参数。
- `selector` 支持用 `+` 连接多个 JSONPath，结果映射到 `$1`、`$2`（6.5+）。
- `$root` 表示从 JSON 根部开始搜索（6.7.1+）。
- `replacement` 为空时默认 `$1`；可用 `|{source:}` 在无匹配时保留原串；还允许数学表达式（评分场景）。
- 函数还包括 `decodeBase64`、`removingPercentEncoding`、`addingPercentEncoding(allowedCharacters)`、`decompressFromBase64`（LZString）、`reversed`、`regexReplacement`。

现稿 3.3 已经提出“先测行为差异”，方向对，但应把上述歧义直接列成 P0 待确认项，而不是笼统地说“未知函数返回 UNSUPPORTED_FEATURE”。`replacement` 的数学表达式还需要一个禁 `eval` 的安全求值器，现稿没有提到。

### 1.4 `flags` 是能力声明的主要来源

官方 Wiki 列出的 flags 至少覆盖：

- 会话：`loginRequired`、`consentRequired`。
- 加载方式：`jsNeededIndex` / `jsNeededDetail` / `jsNeededGallery` / `jsNeededSearch` / `jsNeededTagLink` / `jsNeededPhotoAlbum` / `jsNeededSecondLevelPageGallery` / `jsNeededAll`。
- 请求方式：`postSearch` / `postIndex` / `postDetail` / `postGallery` / `postPhotoAlbum` / `postAll` / `postTagLink`。
- 浏览器行为：`scrollIndex` / `scrollDetail` / `scrollGallery`。
- 字符集：`big5Charset*`、`gbkCharset*`。
- URL 编码：`gbkUrlEncodingAll`。
- 展示与导航：`repeatedThumbnail`、`ignoreDetail`、`userAgentMobile`。
- `displayMode`：`text` / `table` / `collection` / `waterfall` / `tag`，`waterfall` 需要 `coverWidth` / `coverHeight`。

这些不是 P4 的实现细节，而是 P2 必须扫描出来、并转成 `RoutePlan.capabilities` 的输入。现稿 P2 只说“能力扫描”，没有定义扫描结果的数据结构和错误码。

### 1.5 Headers 和 Cookie 的优先级

- Headers（6.3+）优先级：`Rule > Page > Site`。
- Cookie 分两类：内置浏览器获得的 Browser Cookie，以及用户手填、冲突时优先的 Custom Cookie。

现稿 3.4 只写“站点会话标识”，没有覆盖 Custom Cookie，也没有写明 Headers 的三级继承。

### 1.6 第三方“兼容”实现不能作为语义基准

实证检查了两个公开项目：

- `cloud115/yealico`：Flutter 应用，`findings.md` 明确写“当前规则应保持‘受启发但不兼容’的策略”，其自带 schema 是 `version/meta/request/routes/indexRule/detailRule/contentRule`，与官方四类 Rule 不同。
- `jat002/open-yealico`：Web 版，README 写“兼容 Yealico 风格”，但增加了 `handler`、`hitomiLanguage` 等自有扩展。
- `Squarelan/sq-yealico-rules` 的 `v1-gallery-wnacg.json` 使用上述自有 schema，尽管 README 写“Yealico-compatible”。

结论：这些项目可以参考产品形态和工程组织，**不能作为规则语义的验收基准**。兼容性只以官方 Wiki 语义 + 用户实际规则样本 + 真机行为为准。

### 1.7 本机可用的验证条件

- Node `v24.20.0`、npm `11.19.0`、JDK `17.0.13`。
- Android SDK 位于 `~/Library/Android/sdk`，已装 platform `android-31/34/36`、build-tools `30.0.3/31/34/35/36`。
- 有 AVD `RN_Test`（system image `android-36`），当前无真机连接。

因此 P1 可以做模拟器级验收，但“真机兼容”仍应标记为未验证。

## 2. 规则兼容路线：建议的修订

### 2.1 先建 RoutePlan，再写执行器

建议在 `engine` 中固定一个纯函数产物：

```
RuleDocument -> RoutePlan {
  site, pageIndex, routeKind: series | list | detail | gallery,
  urlTemplate, method, headers, charset,
  capabilities: { static, webview, login, consent, post, scroll,
                  gbkUrl, repeatedThumbnail, ignoreDetail },
  selectors: {...},
  pagination: { pageStart, pageStep, pageFormat, totalImages, totalPages },
  unsupported: [{ fieldPath, code, detail }]
}
```

理由：

- 能力扫描、错误提示、调试页、测试快照都消费同一个产物。
- `ignoreDetail`、`pages`、`flags` 的差异在执行前就暴露，不会散落到页面代码。
- 可以在 Node 和 Hermes 上对 RoutePlan 做 golden test，不需要真实网络。

### 2.2 首版规则范围要写死到“页面类型”，不是“功能列表”

建议明确：

- 首版实现 `ListRule`、`DetailRule`、`GalleryRule` 三条静态链路。
- `SeriesRule`、`commentRule`、`searchUrl`：首版识别并返回 `UNSUPPORTED_FEATURE`，不静默忽略；是否实现由 P0 样本决定。`pages` 多页已在 P2 实现页面选择与规则继承。
- `pictureRule` 与 `GalleryRule.image` 两条取图路径都要建模；不能只实现其中一条。
- `ignoreDetail` 必须支持：否则部分站点从列表直接进图库的导航无法成立。

### 2.3 占位符与 Selector 的解析要求

- 占位符解析器按嵌套层级和引号状态扫描，不允许 `split(':')` 或全局正则替换。
- 先实现一种函数链写法（建议 `.` 链式，因为它是官方后文给出的“从左到右”明确语义），另一种在 P0 用真实样本确认后再加；不要同时猜两种。
- `+` 多 JSONPath、`$root`、`|{source:}`、`replace(..., with: ...)`、`addingPercentEncoding(allowedCharacters)` 各自建 fixture。
- `replacement` 的数学表达式只允许数字、括号、四则运算和已提取的 `$n`，用小型求值器，禁止 `eval` / `Function`。
- 未知函数、未知 flag、未知占位符都返回带 `fieldPath` 的结构化错误，不能当作空串。

### 2.4 兼容矩阵改成“规则 × 能力 × 证据”

现稿 6.2 的矩阵只有两行示例，建议固定列：

| 规则（SHA-256 前 8 位） | 站点 | 页面类型 | 能力 | 首版必需 | 离线证据 | Android 证据 | 在线证据 | 状态 | 限制 / 错误码 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

状态只允许：`已支持` / `部分支持` / `不支持` / `待验证`。每个“已支持”必须能链接到 fixture 或在线记录；不能用“函数已实现”代替。

## 3. RN 与原生边界：建议提前验证的 5 项能力

现稿把原生能力集中在 P4，但这 5 项会反向决定 P1 的基座，建议在 P1 用“能力探针”一次性验证，只记录结论，不实现完整功能。

| 能力 | RN 侧预期 | 失效判据 | 原生备选 |
| --- | --- | --- | --- |
| 响应 Set-Cookie 与最终 URL | `fetch` 通常不暴露 `Set-Cookie`，`response.url` 可能为空 | 登录后无法稳定拿到会话；302 后无法确定基址 | Kotlin OkHttp 模块，暴露 cookie 与最终 URL |
| Cookie 在请求 / 图片 / WebView 间共享 | `CookieManager` 与 OkHttp CookieJar 是两套，需要显式同步 | 图片 403、WebView 登录后请求仍未登录 | 原生 CookieJar + `CookieManager` 双向同步 |
| 图片请求头（Referer / UA） | `Image` source 可带 headers，但是否共享 CookieJar 需实测 | 防盗链站点图片全部失败 | 原生图片加载器（Coil/Fresco 配置） |
| GBK / Big5 解码与 GBK URL 编码 | Hermes 的 `TextDecoder` 不支持这些编码；`encodeURIComponent` 固定 UTF-8 | 页面乱码、中文搜索 URL 错误 | 纯 JS 编码表，或原生 `Charset` |
| 大 HTML 解析阻塞 | Hermes 单线程，解析在 JS 线程执行 | 1 MB 页面 > 200 ms 或可感知掉帧 | 原生 Jsoup，或独立 runtime；保持同一契约测试 |

另外三项也应写入探针报告：

- RegExp 特性：命名捕获组、lookbehind、Unicode property escape 在 Hermes 的实际支持情况。
- `atob` / `btoa` / LZString 在 Hermes 的可用性与体积。
- 相对 URL 解析：RN 的 `URL` polyfill 是否满足 `new URL(relative, base)` 的预期。

### 3.1 基座建议：bare RN，而不是 Expo 托管

现稿 2.3 写“默认优先评估 Expo development build”。建议改为：

- **默认 bare React Native + TypeScript**，直接持有 `android/` 和 Kotlin 源码。
- 理由：本项目的三个高风险点（Cookie/OkHttp、图片请求头、WebView 会话）都指向自定义原生配置；Expo 托管模式下这些要通过 config plugin 和 prebuild 维持，改动成本高于收益。
- 如果仍选 Expo：必须 `prebuild` 后提交 `android/`，所有原生改动写成 config plugin，并在 P1 记录“重新 prebuild 后仍可构建”的验证结果。不要把 Kotlin 改动只留在生成目录。

### 3.2 解析阻塞的判定阈值

建议在 P1 选型记录中写死：

- 目标样本最大 HTML 为基准；解析耗时 P95 < 200 ms 且不造成可感知掉帧，可留在 JS 线程。
- 超过阈值：先做分批/惰性字段提取，再考虑原生解析；原生解析必须复用同一组契约 fixture。
- 任何情况下不允许在主线程做无上限的正则或整页 DOM 遍历；对输入长度、分页数、滚动次数设硬上限。

## 4. 阶段依赖：建议改为 P0a / P0b + P1 探针

现稿的 P0 → P1 依赖关系有一个死结：P0 验收要求“每项首版能力能追溯到样本”，但没有样本时 P1 又必须等 P0。建议：

```
P0a 规范与样本清点（可无真实样本完成）
  ├─ 官方语义提炼、待确认项、合成 fixture、兼容矩阵骨架
  └─ 产出：docs/reference/*、docs/rules/*
P0b 真实规则兼容矩阵（需要用户样本）
  └─ 可与 P1 并行；不阻塞工程初始化
P1 工程骨架 + 运行时能力探针
  ├─ 依赖 P0a
  ├─ 产出：可安装 Android 骨架、Node/Hermes golden test、探针报告、选型记录
  └─ 不依赖 P0b，但真实兼容结论仍待 P0b
P2 规则核心 + RoutePlan + 诊断
P3a 静态阅读闭环
P3b 会话/动态闭环（仅在样本需要时，前移 P4 的必要子集）
P4 其余原生能力
P5 回归与交付
```

同时建议：

- P2 的验收增加“RoutePlan 快照”和“错误码表”，不只验证字段结果。
- P3 的验收拆成“静态闭环”和“会话闭环”，避免目标站点需要登录时 P3 永远无法通过。
- P5 的依赖许可证检查前移到 P1 选库时，避免后期替换。
- 每阶段的“未验证项”必须显式列出，不能只在总结里写“基本完成”。

## 5. 验收标准：改成可判定

现稿的验收方向正确，但多数不可判定。建议替换为下列判据。

### P0a

- `docs/reference/yealico-rule-model.md` 覆盖 Site、四类 Rule、Selector 五要素、占位符、flags、headers 优先级、Cookie 两类。
- `docs/rules/open-questions.md` 至少列出：函数链分隔符、`attr` 多属性返回形态、`reversed` 的字符语义、`totalImages` 与 `{page:}` 的边界、`pages` 多页是否首版支持。
- 合成 fixture 能覆盖：CSS、JSONPath、`this`、`$root`、`+`、regex/replacement、`|{source:}`、相对 URL、未知函数、空列表。
- 兼容矩阵骨架存在，所有真实样本行状态为 `待验证`。

### P0b

- 每个目标规则有 SHA-256、来源、授权/脱敏说明。
- 每个“首版必需”能力至少有一个样本证据或官方规范条目。
- 无法确认的语义进入 `open-questions.md`，不得用实现猜测覆盖。

### P1

- `npm test` 通过；Node 与 Hermes 对同一 fixture 的规范化 JSON 输出完全一致。
- Android 模拟器上能打开 dev 页面并执行同一组 fixture；记录设备型号/API、输入大小、耗时。
- 探针报告覆盖第 3 节的 5 项能力，每项有“可用 / 不可用 / 需原生”的结论和证据。
- 选型记录写明：RN 版本、Hermes、解析库、JSONPath 库、存储候选、许可证。
- 没有设备时，明确写“Android 未验证”，P1 不能标记为完全通过。

### P2

- RoutePlan 快照测试通过；`unsupported` 列表对未知 flag/函数/占位符非空。
- 原始规则字节不被改写，导入后哈希一致。
- 分页终止满足至少四条：达到 `maxPages`、连续空页、无新增 `idCode`、URL 重复。
- `fieldPath` 能定位到具体规则字段；错误码稳定，不因 UI 文案变化。

### P3

- 稳定内容 ID 的回退顺序明确：`idCode` → 规范化详情 URL → 规则哈希 + 序号；重复导入不产生重复站点。
- 图片失败重试有上限；离开页面后旧请求取消或结果丢弃。
- 返回、再进入、进程重启三种恢复路径都验证。
- 阅读器有窗口化/预加载上限，长图列表不无限增长。

### P4

- WebView 桥只接受白名单消息类型，校验来源和任务 ID；有拒绝非法消息的测试。
- 登录 → 列表 → 详情 → 图片 → 重启 → 退出登录逐项记录。
- 超时、取消、页面销毁后的任务释放有证据。

### P5

- 每条“已支持”都有离线/在线证据链接；离线和在线结果分开记录。
- 许可证清单、敏感日志清理、数据升级策略三者都有检查记录。

## 6. 对原计划的具体修改建议

建议直接在 `DEVELOPMENT_PLAN.md` 中做这些修改：

1. 1.2 增加 `GalleryRule` 与 `ignoreDetail`，把“详情/章节/图库”写成三条可选链路。
2. 2.3 把“默认优先评估 Expo”改为“默认 bare RN；选 Expo 需 prebuild + 提交 android/”。
3. 3.1 增加 RoutePlan 和能力扫描的输出定义。
4. 3.3 增加 `+` 多 JSONPath、`$root`、`|{source:}`、命名参数、数学表达式的待确认项。
5. 3.4 增加 Custom Cookie 与 Headers 三级优先级。
6. 4 的请求契约增加“最终 URL、Set-Cookie 可见性、字符集、重定向策略”的验证状态。
7. 5 的阶段改为 P0a / P0b / P1 / P2 / P3a / P3b / P4 / P5。
8. 5 的 P1 增加能力探针；P2 增加 RoutePlan 快照和错误码表。
9. 6.2 的矩阵增加规则哈希、页面类型、错误码列。
10. 6.3 给出 200 ms / 1 MB 的初始阈值和超阈值处理路径。
11. 7 增加“官方 Wiki 只引用事实与链接，不复制全文”的合规说明。
12. 8 增加“第三方 Yealico-compatible 项目只作参考，不作语义基准”。

## 7. 本轮建议执行的范围

按“评审确认后从 P0、P1 开始，不一次性生成完整应用”的要求，本轮建议只做：

- P0a：官方规则语义提炼、待确认项、合成 fixture、兼容矩阵骨架。
- P1 第一步：初始化 bare RN + TypeScript 工程，建立 lint / test，跑通 Node 侧最小解析链路。
- P1 第二步：在 Android 模拟器上跑同一组 fixture，产出能力探针报告。
- 不做：完整 UI、登录、WebView、真实站点在线验收、Kotlin 业务模块。

如果用户能提供 3～5 份真实规则样本，P0b 与 P3 的真实兼容验收可以立即补齐；在此之前，所有真实站点结论保持“待验证”。

## 8. 补充：QR 导入（2026-10-20）

用户补充：Yealico 通过扫描二维码添加站点，规则作者也以二维码分发。样本解码为 `Yealico QR Code: v2:<base64>`；base64 解码是 64 bytes 的不透明数据，不是 JSON / URL / 常见压缩，常见 AES/ChaCha 派生密钥也未解出明文。详见 [rules/qr-import.md](rules/qr-import.md)。

对计划的追加调整：

1. 1.2 的导入方式增加 QR，但明确“能扫 ≠ 能导入”。
2. P0 增加 QR 样本清点：前缀、版本、载荷长度、可解性、来源。
3. P2 增加 QR 解析层（URL / 原始 JSON / 自有 scheme）；Yealico `v2:` 无法解码时返回 `UNSUPPORTED_QR_PAYLOAD`，提供粘贴/URL 回退。
4. 相机扫码 UI 在格式门槛通过后引入，不在 P1 加原生相机依赖。
5. 兼容矩阵新增 QR 行；`v2:` 在拿到规则 JSON 对照或官方格式前保持“不支持/阻塞”。

需要用户补充：该 QR 对应的规则 JSON、飞行模式扫描结果、2～3 组 QR + JSON 对照。

作者主页已核查：`https://wc3818290.home.blog/` 的 325 篇公开文章只发布二维码，没有 `.json` / GitHub / Gist / `indexRule` 代码块；禁漫天堂主站与大陆版两张 QR 的载荷前 16 字节相同、后 48 字节不同。详见 [rules/qr-import.md](rules/qr-import.md)。

另一条可行路径：Luckydesigner 教程的实拍截图显示，Yealico 站点菜单有 `Edit` / `Create QR Code`；`Edit` 会打开 Site Rule 编辑器，按 `General Rule` / `Pages` / `Index Page` / `Detail Page` / `Gallery Page` 等标签页展示 URL、selector、function、param、regex、replace。也就是说，**可以通过客户端自己的编辑界面取规则明文，不需要解密二维码**。操作步骤见 [rules/yealico-rule-extraction.md](rules/yealico-rule-extraction.md)。

用户另提供的“导出 JSON”样本仍是加密容器：`{ "encrypted": "v2:<base64>" }`，3840 bytes 高熵、块对齐、无压缩头。已识别为 `UNSUPPORTED_ENCRYPTED_EXPORT`，不当作规则导入。详见 [rules/yealico-export-format.md](rules/yealico-export-format.md)。

2026-10-20 进一步确认：macOS 版 Yealico 的容器 SQLite（`ComiGa.sqlite`）在 `ZSITE` / `ZSITELISTRULE` / `ZSITEPAGE` 等表中直接存规则明文 JSON；已提取 6 个站点，含禁漫 2.26、阿巴基猫 2.4。**规则数据的获取不再依赖 QR/导出解密**；自动扫码导入仍需单独的格式方案。方法与边界见 [rules/yealico-macos-sqlite.md](rules/yealico-macos-sqlite.md)。
