# 用 Yealico 客户端取规则明文（iOS）

- 目的：不逆向、不解密二维码，利用 Yealico 自带的规则编辑器，把已扫码导入的规则字段取出来。
- 依据：Luckydesigner 教程《如何获取 Yealico 规则以及自制科普教程》（2021-12-25）中的实拍截图：
  `https://www.luckydesigner.space/how-to-create-yealico-app-rules/`
- 关键截图：
  - 站点菜单：`Edit` / `Update` / `Create QR Code` / `Delete`
  - Site Rule 编辑器：`General Rule`、`Pages`、`Series Page`、`Index Page`、`Detail Page`、`Gallery Page`、`Search Page`、`Tag Link Page`、`Extra Rules`
  - Index Page 字段：`Item`、`Function`、`Param`、`Regex`、`Replace`
- 说明：截图来自 2021 年版本；当前版本入口文字可能变化，但“站点菜单 → Edit/编辑”这条路径值得先试。

## 1. 操作步骤

### 实拍进度

- 2026-10-20 已取得第一条真实样本：`阿巴基猫` / `wc3818290.home.blog` 的通用规则与 Pages 上半部分；规则定义仍缺。已确认字段、候选选择器和补图清单见 [evidence/2026-10-20-yealico-edit-aba.md](evidence/2026-10-20-yealico-edit-aba.md)。
- 后续：macOS 版 Yealico 的 SQLite 已直接提供明文规则，`List: recently` 已提取并跑通。优先使用 [macOS 容器规则提取](yealico-macos-sqlite.md)；下面的 Edit 截图法适合只用 iOS 设备的情况。

1. 在 Yealico 中扫描规则二维码，完成导入。
2. 回到站点列表，找到刚导入的站点，点右侧三点菜单。
3. 选择 **Edit**（编辑）。不要选 `Create QR Code`：它只会重新生成加密二维码，拿不到明文。
4. 编辑器顶部有多个标签页，逐个进入并截图/复制：
   - `General Rule`：Site Name、Series URL、Series Display Mode、Index URL、Index Display Mode、Detail URL、Gallery URL、Search URL、Search Display Mode、Tag Display Mode。
   - `Pages`：多页面配置、relListRuleIndex 等。
   - `Series Page` / `Index Page`：Item、ID Code、Title、Cover、Author、Rating 等字段的 selector / function / param / regex / replace。
   - `Detail Page`：totalImages、tagRule、pictureRule、chapterRule、commentRule、photoAlbumLink。
   - `Gallery Page`：totalPages、item、image、secondLevelPageUrl。
   - `Search Page` / `Tag Link Page` / `Extra Rules`：首版不一定支持，但先记录，避免漏能力。
5. 每个标签页如果内容超过一屏，分多张截图，保证字段名和值都完整。
6. 如果输入框支持长按/全选/复制，优先复制文本；截图作为兜底。
7. 把截图或复制的文本发回来，不要附带账号、Cookie、密码。

## 2. 截图要求

- 保留字段名和输入框内容，不要只截值。
- 不要裁掉标签页标题；否则无法判断字段属于哪个 Rule。
- 高分辨率原图优先；聊天工具压缩后可能看不清正则。
- 同一个站点一次发完，避免不同版本混在一起。
- 先取一个结构简单的静态站点，确认流程可行，再取禁漫天堂这类复杂规则。

## 3. 字段到本项目模型的映射

| Yealico 编辑器 | 本项目 |
| --- | --- |
| General Rule | `Site`：`name`、`domain`、`displayMode`、`indexUrl`、`detailUrl`、`galleryUrl`、`searchUrl`、`headers`、`flags` |
| Pages | `Site.pages`；已映射为 `RulePage[]`，可用 `resolveRulePage` / `buildPagePlan` 选择 |
| Series Page | `seriesRule`；首版识别但可能不实现 |
| Index Page | `indexRule`（ListRule） |
| Detail Page | `detailRule`；含 `pictureRule` / `chapterRule` / `tagRule` |
| Gallery Page | `galleryRule` |
| Search Page / Tag Link Page / Extra Rules | 首版记录，按能力矩阵决定支持范围 |

## 4. 能拿到什么、不能拿到什么

能拿到：

- 站点 URL 模板、选择器、函数、参数、正则、替换模板。
- 页面类型、展示模式、分页/章节相关字段。
- 足以重建规则 JSON，并用本项目的 RoutePlan 做离线验证。

不能保证：

- 一次截图覆盖所有滚动内容；需要用户配合补图。
- 复杂规则可能有隐藏字段或多页配置，截图容易漏。
- 如果当前版本移除了 Edit，或字段不可复制，只能退回“作者提供 JSON / 抓包 / 备份”路线。

## 5. 取证后的验收

1. 按字段重建 JSON，保留原始顺序和未知字段。
2. 用 `buildRoutePlan` 扫描：未知函数/字段/占位符必须报错，不能静默。
3. 用真实页面离线 HTML 跑 `executeList` / `executeGallery`，与 Yealico 显示结果对照。
4. 只有“真实规则 + 真实页面 + 双端结果一致”才算兼容，不用截图本身宣称兼容。

## 6. 安全与合规

- 只读取用户自己设备上、自己导入的规则。
- 不读取 Yealico 的账号、Cookie、Keychain 或其它站点数据。
- 不逆向 App Store 二进制，不绕过 TLS pinning。
- 规则 JSON 可能包含站点地址和选择器，分享前确认不含个人凭证。
