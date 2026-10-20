# P2：Detail / Gallery 链路记录

- 记录日期：2026-10-20
- 范围：DetailRule 的 chapterRule/pictureRule、GalleryRule 的图片与总页数、翻页 URL 生成。
- 状态：**Detail/Gallery + 分页编排已通过真实禁漫 2.26 规则的合成页验证**；UI、pages/二级图片仍待做。

## 1. 已实现

### executeDetail

`executeDetail(rule, plan, html, context)` 返回：

```ts
{
  fields: ExtractItem,       // title/cover/author/... 
  chapters: ChapterItem[],   // idCode/title/datetime/url
  pictures: string[],        // pictureRule 的图片 URL
  diagnostics: Diagnostic[]
}
```

行为：

- 顶层字段在 detail 文档根上执行。
- `chapterRule.item` 逐项执行 `idCode` / `title` / `datetime` / `url`。
- `chapterRule.url` 保留 `{pageFormat:...}` 模板，不在 P2 提前展开；由 `buildPageUrls` 生成第 1..N 页。
- `pictureRule.item` + `pictureRule.url` 提取图片；`link`（二级页）明确报 `UNSUPPORTED_FEATURE`，不静默。
- 章节/图片 URL 始终解析为绝对地址。

### 翻页 URL

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

### 网络编排（可注入 fetcher）

`loadListPages` / `loadGalleryPages` 接受：

```ts
interface RuleFetcher {
  fetch(request: RuleRequest): Promise<RuleResponse>;
}
```

- `loadListPages(rule, plan, fetcher, context, { maxPages })`
- `loadGalleryPages(rule, plan, fetcher, chapterUrlTemplate, context, { maxPages })`

行为：

- 顺序请求，保持页面顺序。
- List 按 `idCode`（无则 title+cover）去重；Gallery 按图片 URL 去重。
- 第 2 页起无新增内容 → `noNewItems`；重复 URL → `duplicate`；HTTP 非 2xx/异常 → `NETWORK_ERROR`。
- `maxPages` 硬上限，返回 `{ pages, urls, stopReason, diagnostics }`。
- 不依赖 RN/fetch；Cookie、字符集、超时、取消由适配器实现。

## 2. 真实规则验证

### 禁漫天堂 2.26（合成 HTML，不抓取成人站点）

- Detail：2 个 chapter，`idCode` 为 `123` / `456`。
- chapter URL 保留：
  `https://jm18c-dfg.cc/photo/123{pageFormat:?page={page:}}`
- 展开后：
  - `https://jm18c-dfg.cc/photo/123`
  - `https://jm18c-dfg.cc/photo/123?page=2`
  - `https://jm18c-dfg.cc/photo/123?page=3`
- Gallery：`totalPages=3`，2 张 `data-original` 图片。
- 图片字段没有写 `absoluteUrl`，仍被解析为 `https://jm18c-dfg.cc/img/1.jpg`。

### 阿巴基猫 2.4

- `List: recently` 对 `update_history` 提取 118 条、0 诊断。
- 第 118 条是无链接空段落；是否过滤需与原版 Yealico 对照。

## 3. 真实规则暴露并已修复的兼容点

| 问题 | 处理 |
| --- | --- |
| 命名规则的 `name`/`index` 被当成选择器 | 只在根规则层跳过；嵌套 `tagRule.name` 仍正常校验 |
| `{domain:}` 出现在 regex 中 | 在 regex/replacement 展开前替换为域名 |
| `cover/image` 没有 `absoluteUrl` | 对 URL 字段默认解析相对地址 |
| `attr` 多属性被拼接 | 改为按顺序取第一个非空（禁漫 `data-original, src`） |
| `{pageFormat:?page={page:}}` 里的 `?` 被当成查询串 | URL 路径拆分改为括号/引号感知 |
| 空 `galleryUrl` / `loginUrl` 报 INVALID_RULE | 转换为空值时忽略 |

## 4. 仍未实现

- `pages` 多页面选择；当前 RoutePlan 仍报 `UNSUPPORTED_PAGES`。
- `pictureRule.link` / `photoAlbumLink` / `secondLevelPageUrl` 二级页。
- `totalImages + {page:}` 自动推导图片 URL。
- List 翻页的 UI/业务去重策略（`loadListPages` 已提供引擎层）。
- WebView、登录、Cookie、图片请求头。
- `ignoreDetail`、`repeatThumbnail`、`displayMode=tag`。
- Android 上执行真实规则。
- 超时、取消、字符集解码适配器。

## 5. 测试

- `__tests__/detail.test.ts`：合成 Detail/Gallery、chapter URL 模板、翻页重复/上限、URL 字段、attr fallback。
- `__tests__/load.test.ts`：`loadListPages` 顺序/去重/`noNewItems`、`loadGalleryPages` 总页数/去重、HTTP 错误。
- `__tests__/real-rules.test.ts`：真实禁漫 2.26 的 detail/gallery 合成页；真实阿巴基 `List: recently`。
- 当前 Jest：6 个 suite、30 个用例。

## 6. 下一步

1. 实现 `pages` 选择与每页独立规则。
2. 支持 `pictureRule.link` / `photoAlbumLink` / `secondLevelPageUrl`。
3. 支持 `totalImages + {page:}`。
4. 把 `loadListPages` / `loadGalleryPages` 接到 Android 适配器与真实规则 selftest。
5. UI：站点列表、详情、阅读器。
