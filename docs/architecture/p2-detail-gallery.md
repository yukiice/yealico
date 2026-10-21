# P2：Detail / Gallery 链路记录

- 记录日期：2026-10-20
- 范围：List 页面选择、DetailRule、GalleryRule、二级页、`totalImages` 推导、翻页 URL 生成与加载编排。
- 状态：**Node/Jest 与 Android RN fetch 均已跑通**；Android 同步自检 13/13，公开阿巴基猫 List/Detail 网络探针 6/6；UI、登录/Cookie 仍未接。

## 1. 已实现

### 1.1 `pages` 页面选择

`RuleDocument.pages` 是一等数组，提取结构为 `RulePage[]`。

- `listRulePages(rule)`：返回稳定的 `{ index, name, pk?, displayMode? }` 列表，`index` 从 0 开始。
- `resolveRulePage(rule, nameOrIndex)`：
  - 页面 URL / `indexRule` / `detailRule` / `galleryRule` / `seriesRule` 覆盖站点默认值；
  - 页面没有提供的 rule 回退到站点级；
  - `flags` / `headers` 合并，页面优先；
  - `displayMode: "default"` 不覆盖站点模式；
  - 返回的 rule 去掉 `pages`，避免递归；
  - 未知页面返回 `MISSING_FIELD`，不静默退回第一页。
- `buildPagePlan(rule, nameOrIndex)`：返回 `{ rule, page, plan }`。调用方必须把 `rule` 传给 `execute*` / `load*`，不要继续用原始站点规则。
- 未选择页面时保留站点级默认规则；不擅自把 `pages[0]` 当首页，因为真实规则第一页可能是登录后的收藏页。

真实禁漫 2.26 的 29 个页面已能列出、按名称选择；`月排行` 的页面 URL 覆盖生效，`indexRule` 正确继承站点级规则。

### 1.2 `executeDetail`

`executeDetail(rule, plan, content, context, options?)` 返回：

```ts
{
  fields: ExtractItem,       // title/cover/author/...
  chapters: ChapterItem[],   // idCode/title/datetime/url
  pictures: string[],        // pictureRule 的图片 URL
  photoAlbumUrl?: string,    // DetailRule.photoAlbumLink 解析结果
  pictureLinks?: string[],   // pictureRule.link 待抓取页
  diagnostics: Diagnostic[]
}
```

行为：

- 顶层字段始终在原始详情页执行。
- `photoAlbumLink` 存在时：
  - 先解析并返回 `photoAlbumUrl`；
  - 未提供 `options.secondaryContent` 时返回 `SECOND_LEVEL_REQUIRED`，不在错误页面执行 chapter/picture；
  - 提供后，`chapterRule` / `pictureRule` 在二级页执行，顶层字段仍来自详情页。
- `pictureRule.link` 存在时：
  - 对每个 item 解析 `link`，返回 `pictureLinks`；
  - `url` 留给 `executePicturePage` 在 link 页执行；
  - `executePicturePage` 在 link 页找不到原 `item` 时回退到页面根节点。
- `totalImages` + `pictureRule.url` 中的 `{page:}`：
  - 从详情页字段读取 `totalImages`；
  - 图片 URL 模板按 page 1..N 展开，不逐页请求；
  - 缺少 `totalImages` 时返回 `MISSING_FIELD`，不把带占位符的字符串当图片；
  - 单次详情最多展开 500 张，超出部分返回 warning，防止异常规则制造巨大数组。
- 章节/图片 URL 始终解析为绝对地址。

### 1.3 `executeGallery`

`executeGallery(rule, plan, content, context, options?)` 返回 `totalPages` / `images` / `secondLevelUrl` / `diagnostics`。

- `galleryRule.secondLevelPageUrl` 先在当前图库页解析：
  - 未提供二级内容时返回 `secondLevelUrl` + `SECOND_LEVEL_REQUIRED`；
  - 提供 `secondaryContent` 后，`totalPages` / `item` / `image` 在二级页执行；
  - 缺少 `selector`、只有 `regex`/`replacement` 的页面级 URL 选择器默认作用于整页（真实 M-ngabz 规则）。
- 二级页解析失败或为空时进入 diagnostics，不伪造成空图库。

### 1.4 加载编排

`loadDetail(rule, plan, fetcher, detailUrl, context, { maxPages })`：

1. 请求详情页；
2. 执行 `executeDetail`；
3. 有 `photoAlbumUrl` 时抓取二级页，再执行 chapter/picture；
4. 有 `pictureLinks` 时顺序抓取图片页，`executePicturePage` 后去重合并；
5. 返回 `pictures`、`urls`、`stopReason`、`diagnostics`。

`loadGalleryPages` 现在对每个图库页：

1. 请求图库页；
2. 解析 `secondLevelPageUrl`；
3. 抓取二级页；
4. 在二级页执行 `totalPages` / 图片规则；
5. 按 `totalPages` 继续第 2..N 页，并重复二级页流程。

`urls` 记录实际请求顺序（包括二级页）；`pages` 仍只统计图库页数。

RN/Android 侧由 `createFetchRuleFetcher` 适配：

- 把 `RuleRequest` 转为 `fetch` 的 method/headers/body；
- 默认 15s 超时，使用 `AbortController`；
- 返回最终 URL、状态码、响应头和文本；
- 默认 `credentials: include`，为后续 Cookie 会话保留入口；
- 不绑定 RN，可在 Node 用注入的 fake fetch 测试。

自检页提供手动“运行真实规则网络探针”：只请求阿巴基猫公开 `update_history`，用真实 `pages` 规则走 `loadListPages`，再取第一条 `idCode` 走 `loadDetail`，不自动访问成人站点。

### 1.5 翻页 URL

`buildPageUrls(template, context, maxPages)`：

- 从 page=1 开始展开 `{page:...}` / `{pageFormat:...}`。
- 重复 URL 终止（`duplicate`）。
- 空 URL 终止（`empty`）。
- 硬上限 200 页（`maxPages`）。
- 返回 `{ urls, diagnostics, stopReason }`。

`buildGalleryPageUrls(chapterUrl, totalPages, context, maxPages)`：

- 用 `totalPages` 限制页数；`totalPages` 缺失时只取第 1 页。
- 仍受 200 页硬上限保护。

注意：**“无新增内容”属于业务级终止，必须在调用方按图片/条目去重判断**；URL 层只负责重复/空/上限。

## 2. 真实规则验证

### 禁漫天堂 2.26

- 29 个页面配置可枚举；`月排行` 按名称选择，页面 URL 覆盖、站点 rule 继承。
- Detail：2 个 chapter，`idCode` 为 `123` / `456`。
- chapter URL 保留：
  `https://jm18c-dfg.cc/photo/123{pageFormat:?page={page:}}`
- 展开后：
  - `https://jm18c-dfg.cc/photo/123`
  - `https://jm18c-dfg.cc/photo/123?page=2`
  - `https://jm18c-dfg.cc/photo/123?page=3`
- Gallery：`totalPages=3`，2 张 `data-original` 图片，相对图片绝对化。
- 未在线抓取成人站点；全部使用合成 HTML。

### 阿巴基猫 2.4

- `buildPagePlan(rule, "最近更新")` 选中真实页面规则。
- 对 `update_history` 合成页提取 2 条；完整真实页此前记录 118 条、0 诊断。
- 第 118 条是无链接空段落；是否过滤需与原版 Yealico 对照。

### 拷貝漫畫

- `detailRule.photoAlbumLink` 从 `.alert-body-input` 的 `value` 解析：
  `comic%2Fabc` → `https://www.mangacopy.com/comicdetail/abc/chapters`
- 未提供二级页时返回 `SECOND_LEVEL_REQUIRED`，不误用详情页图片规则。

### M-ngabz

- `GalleryRule.secondLevelPageUrl` 没有 `selector`，只有 regex/replacement。
- 页面级选择器按整页 HTML 执行，能从脚本常量生成：
  `https://comicbz.com/m456/chapterimage.ashx?...`
- 未抓取真实站点；使用合成 script 验证。

### Android API 36 + Hermes（2026-10-21）

- APK 使用 Temurin 17 构建，`assembleDebug` 成功。
- Metro 冷启动后，App 同步自检 **13/13** 通过；新增 `pages: selected url`、`pages: page rule items`、`totalImages: expanded pictures`。
- 手动网络探针 **6/6** 通过：
  - 阿巴基猫 `update_history` 第 1 页抓取成功；
  - `loadListPages` 返回 70 条；
  - 第一条详情页抓取成功；
  - `loadDetail` 得到 4 张图片、`cover=yes`；
  - 列表与详情均 0 error diagnostics。
- 证据：`artifacts/p2-aba-detail.png`。
- 未在 Android 上执行禁漫 Detail/Gallery，也未做登录/Cookie 在线验收。

## 3. 真实规则暴露并已修复的兼容点

| 问题 | 处理 |
| --- | --- |
| 命名规则的 `name`/`index` 被当成选择器 | 只在根规则层跳过；嵌套 `tagRule.name` 仍正常校验 |
| `{domain:}` 出现在 regex 中 | 在 regex/replacement 展开前替换为域名 |
| `cover/image` 没有 `absoluteUrl` | 对 URL 字段默认解析相对地址 |
| `attr` 多属性被拼接 | 改为按顺序取第一个非空（禁漫 `data-original, src`） |
| `{pageFormat:?page={page:}}` 里的 `?` 被当成查询串 | URL 路径拆分改为括号/引号感知 |
| 空 `galleryUrl` / `loginUrl` 报 INVALID_RULE | 转换为空值时忽略 |
| `pages` 被一律报 `UNSUPPORTED_PAGES` | 改为 `resolveRulePage` / `buildPagePlan` |
| `secondLevelPageUrl` 省略 `selector` 被判非法 | 页面级 URL 选择器默认 `this` + 整页 |
| `photoAlbumLink` 在详情页直接跑图片规则 | 返回 `SECOND_LEVEL_REQUIRED`，由 `loadDetail` 抓二级页 |
| `pictureRule.link` 被当普通图片选择器 | 返回 `pictureLinks`，由 `loadDetail` 逐页执行 |
| `totalImages` + `{page:}` 被当普通 URL | 按 1..N 展开，缺总数时告警 |

## 4. 仍未实现

- Android 上只验证了阿巴基猫公开 List/Detail；禁漫等真实 Detail/Gallery 未在 Android 执行。
- UI：站点列表、页面选择、详情、阅读器、翻页。
- WebView、登录、consent、Cookie、图片请求头。
- `videoRule`、`commentRule`、`seriesRule`、`searchUrl`、`displayMode=tag`。
- `web:` 图片用 WebView 加载。
- 禁漫等成人站点不做未授权在线抓取；阿巴基猫公开页已作为网络探针。
- 超时、取消、字符集解码、图片加载缓存。
- `pages` 的 headers 优先级只实现了 site + page；具体 Rule 对象级 headers 仍待真实样本。
- `totalImages` 的页码起点/step 仍按 Q5 默认假设，未用真实样本确认。

## 5. 测试

- `__tests__/pages.test.ts`：页面枚举、名称/索引选择、URL/rule/flags/headers 覆盖、未知页面、页面规则执行。
- `__tests__/second-level.test.ts`：`photoAlbumLink`、`pictureRule.link`、`GalleryRule.secondLevelPageUrl`。
- `__tests__/load-second-level.test.ts`：`loadDetail` 三级链路、`loadGalleryPages` 每页二级页。
- `__tests__/total-images.test.ts`：模板展开、无 item、缺 `totalImages` 告警。
- `__tests__/real-rules.test.ts`：禁漫页面选择、拷貝漫畫 `photoAlbumLink`、M-ngabz 无 selector 的 `secondLevelPageUrl`。
- 当前 Jest：**12 个 suite、52 个用例**；`npm run typecheck`、`npm run lint` 通过。
- `__tests__/rule-fetcher.test.ts`：fetch 转换、Headers、超时。
- `__tests__/network-selftest.test.ts`：真实阿巴基猫规则 + mock fetcher 的 `loadListPages`。

## 6. 下一步

1. 把 `loadDetail` / `loadGalleryPages` 接到 UI；fetch 适配器已就绪。
2. UI：站点页面列表 → 列表 → 详情 → 阅读器。
3. 用真实样本确认 `totalImages` 页码/step、`photoAlbumLink` 的 chapter 位置、`pictureRule.link` 的 thumbnail 语义（Q5/Q25）。
4. 视需要补 `videoRule`、`commentRule`、`seriesRule`、`searchUrl`。
