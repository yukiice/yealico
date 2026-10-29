# P3：站点导入与管理

- 记录日期：2026-10-21
- 状态：**领域层、站点管理 UI、本地持久化、页面/列表、详情展示、单页阅读器、阅读进度和调试页已实现，并完成 Android 模拟器全链路验收；二维码导入已于 2026-10-22 移除**
- 关联：[开发计划](../DEVELOPMENT_PLAN.md)、[QR 研究结论](../rules/qr-import.md)

## 1. 已实现

`src/app/ruleImport.ts` 提供统一导入链路：

- `importRuleText(payload)`：粘贴/文件 JSON；
- `importRuleFromUrl(url, fetcher)`：规则 URL；
- `SiteRepository`：内存站点列表、重复检测、删除。

支持两种规则输入：

1. 提取结构 `{ meta, urls, rules, pages, ... }` → `toRuleDocument`；
2. 项目 `RuleDocument` JSON。

每次导入保留：

- 原始规则文本；
- 简单稳定 ID（不是安全哈希）；
- `RoutePlan` 和诊断；
- 来源（paste/url）与来源 URL。

测试：`__tests__/rule-import.test.ts`，覆盖提取规则、普通 RuleDocument、URL 导入、重复站点、删除、非法 JSON/HTTP 错误。

### Android UI 与持久化

- `SiteManager` 提供规则 JSON/URL 输入、导入、站点列表和删除；
- Android `SiteStore` 原生模块使用 SharedPreferences 保存整份库；格式已从裸 `StoredSite[]` 升级为 `{ version: 2, sites, progress }`，旧数据读取时自动迁移；
- 已在模拟器验证：URL 导入成功、强制停止/重开后站点仍在、删除后重开为空；列表/详情/章节/阅读器/调试页的验收细节见 [Android 验收记录](p3-android-verification.md)；
- 无原生模块时（如 Jest）回退到进程内存，不阻塞 UI 测试；
- 站点列表可进入 `SiteWorkspace`，完成页面选择、列表、详情与阅读。

### 站点 → 页面 → 列表

- 点击站点进入 `SiteWorkspace`；
- 有 `pages` 的站点显示页面选择，默认优先“最近更新”或带 `indexRule` 的页面；
- 使用 `buildPagePlan` / `loadListPages` 加载第一页列表；
- 展示标题、idCode，列表加载/空结果/错误和返回；
- 静态规则可直接用；需要 WebView 的列表页会选择对应 renderer。

### 列表 → 详情

- 点击列表项按 `detailUrl + {idCode}` 生成详情 URL；
- `DetailScreen` 使用 `loadDetail`，按计划选择普通 fetch 或原生 WebView fetcher；
- 展示标题、封面、作者、简介、章节列表和 Aba 的图片列表；
- 章节行可点，进入 `ReaderScreen` 单页阅读器，详见 [P3 章节图库阅读器](p3-reader.md)。

### 章节 → 阅读器

- 章节点击把 `ChapterItem.url` 模板交给 `loadGalleryPages`；
- 阅读器按页预算拉取（首次 4 页，可继续加载到 `totalPages`）；
- 单页翻页，有加载、失败重试和当前图之后 2 张预加载；
- 图片请求带规则头，缺 Referer 时补站点根地址；
- 阅读进度按 `siteId + chapterKey` 持久化，重启后可恢复，详见 [P3 章节图库阅读器](p3-reader.md#15-阅读进度)。

### 调试页

- 站点页顶部「调试」按钮进入；
- 展示规则来源/哈希/原文长度、能力声明、阻断项；
- 按列表/详情/图库三个阶段记录结果数量、诊断与请求地址；
- URL 与诊断文本脱敏（敏感 query 参数、userinfo），详见 [P3 调试页](p3-debug.md)。

## 2. 现在还不能做什么

- 没有章节连读、连续滚动/双页模式；
- 没有登录、consent、Cookie 共享（P4）；
- 没有 Yealico `{"encrypted":"v2:..."}` 导出解密，导入时会明确报 `UNSUPPORTED_ENCRYPTED_EXPORT`；
- 支持的规则能力以 [兼容矩阵](../rules/compat-matrix.md) 为准，未验证项不宣称兼容。

## 3. 二维码导入已移除（2026-10-22）

Yealico `v2:` 二维码不是规则包，而是 CloudKit 引用：64 字节 = 16 字节固定 IV + 48 字节 AES-CBC 密文，明文为 `Site.<UUID>`；密钥不在客户端（1,400 万+ 候选、PBKDF2 326,100 次派生均 0 命中），扫码必须联网激活。因此扫码链路没有可用终点，即使识别成功也无法在本地得到规则。

已移除：

- Android `QrScanner` 原生模块与 `play-services-code-scanner` 依赖；
- `src/platform/qrScanner.ts` 与站点页的「扫码导入」按钮；
- `src/engine/qr.ts`、`parseQrPayload`、`importRuleFromQr`、`UNSUPPORTED_QR_PAYLOAD`。

保留粘贴规则 JSON 与规则 URL 导入。需要从 Yealico 取规则明文时，走 [QR 研究结论](../rules/qr-import.md) 中的 macOS 容器 SQLite 或客户端 Edit 路径。

## 4. release 构建的明文 HTTP 限制

- Android release 变体 `usesCleartextTraffic=false`（`AndroidManifest.xml` 的占位符由 RN Gradle 插件按变体填充），因此 **release 包只能导入 `https://` 规则 URL**。
- `http://` 规则 URL 在 release 包中会报：

  ```text
  NETWORK_ERROR: Network request failed: <url> (http:// 在 Android release 构建默认被禁止，请改用 https://)
  ```

- debug 变体允许明文，P3 验收使用的 `http://10.0.2.2:8000` 属于调试链路，不代表 release 行为。
- 若将来需要局域网明文规则源，应通过 `network_security_config` 精确放行特定地址，不要全局打开 cleartext。

## 5. 下一步顺序

1. 章节连读、连续滚动/双页；
2. 登录 / Cookie / consent（P4）；
3. 用真实规则样本补兼容矩阵与在线验收。
