# P3：站点导入与二维码（必须功能）

- 记录日期：2026-10-21
- 状态：**领域层、站点管理 UI、本地持久化、页面/列表、详情展示、单页阅读器、阅读进度和调试页已实现，并完成 Android 模拟器全链路验收；相机扫码、QR v2 解码未完成**
- 关联：[开发计划](../DEVELOPMENT_PLAN.md)、[QR 导入格式](../rules/qr-import.md)

## 1. 已实现

`src/app/ruleImport.ts` 提供统一导入链路：

- `importRuleText(payload)`：粘贴/文件 JSON；
- `importRuleFromUrl(url, fetcher)`：规则 URL；
- `importRuleFromQr(payload, fetcher)`：QR 原始 JSON / URL / 自有 scheme；
- `SiteRepository`：内存站点列表、重复检测、删除。

支持两种规则输入：

1. 提取结构 `{ meta, urls, rules, pages, ... }` → `toRuleDocument`；
2. 项目 `RuleDocument` JSON。

每次导入保留：

- 原始规则文本；
- 简单稳定 ID（不是安全哈希）；
- `RoutePlan` 和诊断；
- 来源（paste/url/qr）与来源 URL。

测试：`__tests__/rule-import.test.ts`，覆盖提取规则、普通 RuleDocument、v2 QR 明确拒绝、URL/QR 导入、重复站点、删除、非法 JSON/HTTP 错误。

### Android UI 与持久化

- `SiteManager` 提供规则 JSON/URL 输入、导入、站点列表和删除；
- Android `SiteStore` 原生模块使用 SharedPreferences 保存整份库；格式已从裸 `StoredSite[]` 升级为 `{ version: 2, sites, progress }`，旧数据读取时自动迁移；
- 已在模拟器验证：URL 导入成功、强制停止/重开后站点仍在、删除后重开为空；列表/详情/章节/阅读器/调试页的验收细节见 [Android 验收记录](p3-android-verification.md)；
- 无原生模块时（如 Jest）回退到进程内存，不阻塞 UI 测试；
- 当前没有阅读器入口，站点列表只是导入/管理闭环。

### 站点 → 页面 → 列表

- 点击站点进入 `SiteWorkspace`；
- 有 `pages` 的站点显示页面选择，默认优先“最近更新”或带 `indexRule` 的页面；
- 使用 `buildPagePlan` / `loadListPages` 加载第一页列表；
- 展示标题、idCode，列表加载/空结果/错误和返回；
- 静态规则可直接用；需要 WebView 的列表页目前会明确报 `NEEDS_WEBVIEW`，尚未接 WebView list fetcher。

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

- 没有相机扫码、相册二维码解析；
- 没有 Yealico `v2:` 解密；
- 没有 `{"encrypted":"v2:..."}` 解密；
- 没有章节连读、连续滚动/双页模式；需要 WebView 的列表/详情/图库已自动切换 renderer。

所以当前是**可测试的导入领域层**，不是可交付的“扫码添加站点”功能。

## 3. 二维码功能定位

二维码导入是**必须交付功能**，但延后到导入/站点管理闭环稳定之后。

未来 QR 解码器不需要改导入规则：

```text
相机/相册 -> QR payload
  -> parseQrPayload
  -> 原始 JSON / 规则 URL / 自有 scheme
  -> importRuleText / importRuleFromUrl / importRuleFromQr
  -> SiteRepository.add
```

Yealico `v2:` 如果仍然无法离线解码，必须返回明确错误并引导：

- 粘贴规则 JSON；
- 打开规则 URL；
- 从 macOS SQLite / Yealico Edit 获取明文。

不能把“识别了二维码”显示成“添加成功”。

## 4. QR 必须功能的验收

- 扫描阿巴基猫公开二维码，能把站点加入列表；
- 重复扫描同一二维码，返回 `DUPLICATE_SITE`，不产生重复项；
- 扫描非法二维码，返回稳定错误码和可执行回退；
- Yealico v2 若未解码，显示 `UNSUPPORTED_QR_PAYLOAD`，不能出现空站点；
- 扫描规则 URL / 原始 JSON 二维码，走同一导入链路；
- 站点加入后可进入列表/详情/阅读链路（依赖 P3 UI）。

在上述验收完成前，QR 状态保持 `待验证/阻塞`，不能标记“已支持”。

## 5. 下一步顺序

1. 站点列表进入页面/详情/阅读器（P3 下一段）；
2. 相机扫码 + 相册导入；
3. Yealico v2 格式/密钥取证；
4. QR 端到端验收。

## 6. release 构建的明文 HTTP 限制

- Android release 变体 `usesCleartextTraffic=false`（`AndroidManifest.xml` 的占位符由 RN Gradle 插件按变体填充），因此 **release 包只能导入 `https://` 规则 URL**。
- `http://` 规则 URL 在 release 包中会报：

  ```text
  NETWORK_ERROR: Network request failed: <url> (http:// 在 Android release 构建默认被禁止，请改用 https://)
  ```

- debug 变体允许明文，P3 验收使用的 `http://10.0.2.2:8000` 属于调试链路，不代表 release 行为。
- 若将来需要局域网明文规则源，应通过 `network_security_config` 精确放行特定地址，不要全局打开 cleartext。

## 7. 扫码实现与限制

- 原生 `QrScanner` 模块使用 Google Code Scanner（系统扫码 UI），**不申请 CAMERA 权限**，也不自己管理 CameraX 生命周期。
- 它依赖 Play Services 的按需 Barcode UI 模块。没有 GMS、或模块无法下载的设备会走 `SCAN_FAILED`，JS 侧映射为：
  `当前设备无法使用系统扫码（需要 Google Play Services），请改用粘贴 JSON 或 https:// 规则 URL`
- 模拟器 `trip_avd`（android-35 **google_apis** 镜像，GMS 24.23.35）实测报
  `Waiting for the Barcode UI module to be downloaded.`：该镜像不含 Play Store，
  按需模块无法下载，所以扫码 UI 不会拉起。**真机（完整 GMS + Play Store）待验证**。
- 扫码得到的 payload 进入 `importRuleFromQr`，与粘贴/URL 共用导入链路；`v2:` 仍返回 `UNSUPPORTED_QR_PAYLOAD`，不会显示成导入成功。
- 若后续要覆盖无 GMS 设备：改用 bundled ML Kit barcode-scanning + CameraX 自建预览，或 ZXing + CameraX，两套都需要自己实现相机预览与分析循环。
