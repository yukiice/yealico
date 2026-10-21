# P3：站点导入与二维码（必须功能）

- 记录日期：2026-10-21
- 状态：**领域层、站点管理 UI、Android 本地持久化和页面/列表页已实现；相机扫码、Yealico QR v2 解码、详情/阅读器未完成**
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
- Android `SiteStore` 原生模块使用 SharedPreferences 保存站点 JSON；
- 已在模拟器验证：URL 导入成功、强制停止/重开后站点仍在、删除后重开为空；
- 无原生模块时（如 Jest）回退到进程内存，不阻塞 UI 测试；
- 当前没有阅读器入口，站点列表只是导入/管理闭环。

### 站点 → 页面 → 列表

- 点击站点进入 `SiteWorkspace`；
- 有 `pages` 的站点显示页面选择，默认优先“最近更新”或带 `indexRule` 的页面；
- 使用 `buildPagePlan` / `loadListPages` 加载第一页列表；
- 展示标题、idCode，列表加载/空结果/错误和返回；
- 静态规则可直接用；需要 WebView 的列表页目前会明确报 `NEEDS_WEBVIEW`，尚未接 WebView list fetcher。

## 2. 现在还不能做什么

- 没有相机扫码、相册二维码解析；
- 没有 Yealico `v2:` 解密；
- 没有 `{"encrypted":"v2:..."}` 解密；
- 没有详情和阅读器；需要 WebView 的列表页尚未自动切换 renderer。

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
