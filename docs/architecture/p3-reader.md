# P3：章节 → 图库 → 阅读器

- 记录日期：2026-10-21
- 范围：详情页章节入口、`loadGalleryPages` 的界面编排、单页阅读模式、页预算、图片预加载与失败重试。
- 状态：**Jest 覆盖已跑通；Android 真机/模拟器未验收**（本轮只做了 Node/Jest 验证）。

## 1. 已实现

### 1.1 章节入口

`DetailScreen` 的章节行从纯展示改成 `Pressable`：

- 点击后把 `ChapterItem` 交给 `ReaderScreen`，详情页本身保持挂载，返回即回到详情；
- `chapter.url` 为空（`chapterRule` 没解析出地址）时按钮 `disabled`，并显示“缺少章节地址”而不是静默失败；
- 章节列表仍只渲染前 30 条，超出部分提示条数。

`ChapterItem.url` 是规则里的**模板**，例如 `https://www.manhuagui.com/comic/123/456.html#p={page:1}`；`executeDetail` 只做相对地址解析，不展开 `{page:}`。这一点由 `__tests__/reader.test.ts` 直接断言，阅读器把原样模板交给 `loadGalleryPages`。

### 1.2 ReaderScreen

`src/app/ReaderScreen.tsx` 的结构：

```text
ReaderScreen
  ├─ useMemo fetcher = createRuleFetcherForPlan(plan)   // 与列表/详情同一套 renderer 选择
  ├─ loadGalleryPages(rule, plan, fetcher, chapter.url, ctx, { maxPages: budget })
  ├─ 单页展示：一张图 + 上一张 / 下一张
  ├─ 页预算：INITIAL_PAGE_BUDGET = 4，PAGE_BUDGET_STEP = 4
  └─ Image.prefetch 预热当前图之后的 2 张
```

状态机：

| 状态 | 表现 |
|---|---|
| 加载中 | “正在加载章节图片…” |
| 加载失败 / error 诊断 | 红字原因 + “重新加载”按钮 |
| 有图 | 单页图片 + `当前 / 总数` + 已载页数 |
| 图片本身失败 | 半透明遮罩 + “重试这一张”（换 key 重建 `Image`） |

### 1.3 页预算与受控预加载

`loadGalleryPages` 一次会把整个章节的页面都拉完，直接用在阅读器上对几十页的章节是几十个并发请求。这里用预算换可控性：

- 首次只请求 `maxPages = 4`；
- `totalPages` 已知且 `pages < totalPages` 时显示“继续加载（n/m 页）”，按 `nextPageBudget` 追加 4 页；
- `totalPages` 未知时**不显示**继续加载——`buildGalleryPageUrls` 在总数未知时固定只生成 1 页，这个按钮点了也不会有新内容；
- 图片预加载只预热紧邻的 `PRELOAD_AHEAD = 2` 张，失败静默忽略，不影响阅读。

### 1.4 图片请求头

`imageHeaders(rule, domain)` 在规则 `headers` 基础上补一个站点根 Referer：

- 规则没给 Referer 时补 `https://{domain}/`，图床常见的防盗链场景能过；
- 规则已给小写 `referer` 也认，不重复覆盖；
- 章内页请求仍走 `loadGalleryPages` 自己的 `requestFor`，两套头互不干扰。

### 1.5 阅读进度

进度跟着站点库一起落盘，不另开原生存储（`SiteStore` 只有一个固定 key）。

- 领域层：`src/app/readingProgress.ts`
  - `progressKeyFor(chapter)`：优先 `chapterRule.idCode`，缺失时退回章节 URL；两者都没有就不保存。
  - `ReadingProgressRepository`：按 `(siteId, chapterKey)` upsert，`latestForSite` 取站点最近一条，单站点最多 `MAX_ENTRIES_PER_SITE = 50` 条。
  - `parseSiteLibrary` / `serializeSiteLibrary`：新版 envelope 为 `{ version: 2, sites, progress }`，同时兼容旧版的裸 `StoredSite[]`。
- 写盘路径：`ReadingProgressRepository.onChange` → `SiteManager.persist()` → `SiteStorage.save()`；删站点时连带 `removeSite`。
- 写入时机：只在用户真正翻页后写；位次/总数/地址都没变时直接跳过，不重写整库。
- 恢复时机：进入章节先读 `index`，但页预算可能只拉了 4 页——未到位时只改显示下标（`restoreTarget`），不写盘，避免把“受限加载的临时位次”覆盖成真实进度；图片够了才落位。
- 界面反馈：阅读器显示“已恢复上次进度：第 N 张”；详情页章节行显示“已读 N / M 张”；站点页顶部显示“上次读到《章节》第 N 张”。

### 1.6 诊断文本收敛

`errorText` 原来在 `SiteWorkspace` 和 `DetailScreen` 各有一份，阅读器是第三个调用方，抽到 `src/app/diagnostics.ts`。行为不变：只取 `severity === 'error'` 的前 3 条。

## 2. 取舍与已知边界

- **“继续加载”会重发前几页**：预算重跑整段 `loadGalleryPages`，前几页是重复请求。换来的是不用改引擎的分页编排；图片按 URL 去重，不会重复显示。
- **只有一种阅读模式**：单页翻页。连续滚动、双页、RTL 未做。
- **章节间不连读**：读完一章回到详情，没有“下一章”。
- **进度只记章内位置**：记录的是“第几张图”，不是滚动偏移；改成连续滚动模式后需要重新定义。
- **`totalPages` 缺失的站点只加载第 1 页**：漫画柜这类“首图页直出全部 image”的规则正好覆盖；但真正的多页画廊如果规则缺 `totalPages`，阅读器只能看到第一页的图像。
- **`loadGalleryPages` 是串行请求**：章内页之间没有并发，页数多时首屏会慢，后续要改成按页懒加载。

## 3. 测试

`__tests__/reader.test.ts`（6 个用例）和 `__tests__/reading-progress.test.ts`（11 个用例）：

- `preloadTargets`：只取当前图之后、窗口越界与负数索引；
- `canLoadMorePages`：总页数已知/未知/已到顶；
- `nextPageBudget`：按步长推进但不超过总数；
- `imageHeaders`：补 Referer、大小写不同不覆盖、空域名不补；
- 端到端：`executeDetail` 产出 `chapter.url` 模板 → `loadGalleryPages` 展开 `#p=1` / `#p=2` → 两张图按顺序去重；
- 进度：`idCode` 优先于 URL、旧格式迁移、脏数据丢弃、envelope 往返、upsert 去重、无变化不写、缺稳定 ID 不存、删站点/删章节、单站点上限裁剪（时间戳相同时按写入顺序）、章节行文案。

当前整体：**21 个 suite、106 个用例**；`npm run typecheck`、`npm run lint` 通过。

## 4. 还没做

- 章节连读、章节间跳转；
- 连续滚动 / 双页模式；
- 阅读进度只在 Jest 验证；Android 上因为漫画柜章节选择器漂移、图片没加载成功，没有写入进度的时机，见 [Android 验收记录](p3-android-verification.md)；
- 图片磁盘缓存与内存上限。
