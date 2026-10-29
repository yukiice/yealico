# P3：章节 → 图库 → 阅读器

- 记录日期：2026-10-21
- 范围：详情页章节入口、`loadGalleryPages` 的界面编排、连续滚动阅读、页预算、图片预加载与失败重试。
- 状态：**连续滚动、章节连读与跨章进度已在 Android 模拟器验收（2026-10-29）**，见 [Android 验收记录](p3-android-verification.md#8-连续滚动验收2026-10-29)。

## 1. 已实现

### 1.1 章节入口

`DetailScreen` 的章节行从纯展示改成 `Pressable`：

- 点击后记录**章节索引**，由 `ReaderScreen` 按 `chapters[chapterIndex]` 渲染；详情页本身保持挂载，返回即回到详情；
- `chapter.url` 为空（`chapterRule` 没解析出地址）时按钮 `disabled`，并显示“缺少章节地址”而不是静默失败；
- 章节列表仍只渲染前 30 条，超出部分提示条数。

`ChapterItem.url` 是规则里的**模板**，例如 `https://www.manhuagui.com/comic/123/456.html#p={page:1}`；`executeDetail` 只做相对地址解析，不展开 `{page:}`。这一点由 `__tests__/reader.test.ts` 直接断言，阅读器把原样模板交给 `loadGalleryPages`。

### 1.2 ReaderScreen（连续滚动）

`src/app/ReaderScreen.tsx` 的结构：

```text
ReaderScreen
  ├─ useMemo fetcher = createRuleFetcherForPlan(plan)   // 与列表/详情同一套 renderer 选择
  ├─ loadGalleryPages(rule, plan, fetcher, chapter.url, ctx, { maxPages: budget })
  ├─ ScrollView 竖向排列已加载图片，图片按实际宽高比撑开
  ├─ 滚动时用 dominantIndex 判定“当前读到第几张”
  ├─ 页预算：INITIAL_PAGE_BUDGET = 4，PAGE_BUDGET_STEP = 4
  └─ Image.prefetch 预热当前图之后的 2 张
```

图片高度：`onLoad` 读取 `nativeEvent.source` 的宽高，按 `width / height` 设置 `aspectRatio`；尺寸未知前用 `DEFAULT_ASPECT_RATIO = 0.7` 占位，加载后自动替换。比固定一屏一张更适合长条漫画。

状态机：

| 状态 | 表现 |
|---|---|
| 加载中 | “正在加载章节图片…” |
| 加载失败 / error 诊断 | 红字原因 + “重新加载”按钮 |
| 有图 | 连续图片 + `当前 / 总数` + 已载页数 |
| 单张图片失败 | 该图位置显示“这一张加载失败” + “重试这一张”（换 key 重建 `Image`） |

### 1.3 页预算、自动加载与预加载

`loadGalleryPages` 一次会把整个章节的页面都拉完，直接用在阅读器上对几十页的章节是几十个并发请求。这里用预算换可控性：

- 首次只请求 `maxPages = 4`；
- 向下滚动到距内容底部 400px 以内时，自动按 `nextPageBudget` 追加 4 页；同时保留“继续加载（n/m 页）”按钮作为显式入口；
- 恢复进度时，首次预算直接拉到覆盖恢复点，最多 `MAX_RESTORE_BUDGET = 40` 页，避免进入章节后停在错误位置；
- `totalPages` 未知时**不显示**继续加载——`buildGalleryPageUrls` 在总数未知时固定只生成 1 页，这个按钮点了也不会有新内容；
- 图片预加载只预热紧邻的 `PRELOAD_AHEAD = 2` 张，失败静默忽略，不影响阅读。

自动加载用 `loadingMore` ref 防重入；加载完成（`pages`/`images` 变化）后复位。

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
- 写入时机：恢复完成后，滚动导致主导图片索引变化才写；位次/总数/地址都没变时直接跳过，不重写整库。
- 恢复时机：进入章节先读 `index`，首次预算拉到覆盖它；等目标图片的布局就绪后滚到该图顶部。恢复完成前不写盘，避免把临时位次覆盖成真实进度。
- 界面反馈：阅读器显示“已恢复上次进度：第 N 张”（首次手动拖动后清除）；详情页章节行显示“已读 N / M 张”；站点页顶部显示“上次读到《章节》第 N 张”。

**进度模型**：只存“第几张图”，不存图内像素偏移。滚动位置以**视口上缘所在的图片**为准；滚到内容绝对底部时强制认最后一张。换设备、换字号、图片高度变化都不会让进度漂到别的图。

### 1.6 诊断文本收敛

`errorText` 原来在 `SiteWorkspace` 和 `DetailScreen` 各有一份，阅读器是第三个调用方，抽到 `src/app/diagnostics.ts`。行为不变：只取 `severity === 'error'` 的前 3 条。

### 1.7 章节连读

- 阅读器接收完整 `chapters` 与当前 `chapterIndex`，顶部显示“第 N / M 章”。
- 底部常驻“‹ 上一章 / 下一章 ›”，点击切换章节；第一张时上一章禁用，最后一章时下一章禁用。
- 本章还有未加载页时“下一章”禁用并提示“本章还有未加载页，点「继续加载」”，避免跳过内容。
- 切换通过 `key={chapterIndex}` 重建 `ReaderScreen`，每个章节各自按已有进度恢复，不会把上一章的位置写进下一章。
- `dominantIndex` 是纯函数，`__tests__/reader.test.ts` 覆盖图块命中、布局缺失和越界回退。

## 2. 取舍与已知边界

- **“继续加载”会重发前几页**：预算重跑整段 `loadGalleryPages`，前几页是重复请求。换来的是不用改引擎的分页编排；图片按 URL 去重，不会重复显示。
- **没有双页 / RTL**：只有竖向连续滚动。
- **没有章节目录跳转**：只在相邻章节间连读，长章节列表仍只展示前 30 条；没有目录/跳章选择器。
- **进度不保留图内偏移**：长图滚到一半退出，回来会回到该图顶部。要保留页内位置需要引入偏移比例，并处理换设备后的漂移。
- **`totalPages` 缺失的站点只加载第 1 页**：漫画柜这类“首图页直出全部 image”的规则正好覆盖；但真正的多页画廊如果规则缺 `totalPages`，阅读器只能看到第一页的图像。
- **`loadGalleryPages` 是串行请求**：章内页之间没有并发，页数多时首屏会慢，后续要改成按页懒加载。
- **部分图床图片会加载失败**：漫画柜章节存在 `图片加载失败`，请求已带规则头和 Referer，属于图床侧限制；失败占位可单张重试。

## 3. 测试

`__tests__/reader.test.ts`（9 个用例）和 `__tests__/reading-progress.test.ts`（11 个用例）：

- `dominantIndex`：滚动偏移命中图块、跳过未布局图、超过全部图时回退最后一张、空布局回退 0；
- `preloadTargets`：只取当前图之后、窗口越界与负数索引；
- `canLoadMorePages`：总页数已知/未知/已到顶；
- `nextPageBudget`：按步长推进但不超过总数；
- `imageHeaders`：补 Referer、大小写不同不覆盖、空域名不补；
- 端到端：`executeDetail` 产出 `chapter.url` 模板 → `loadGalleryPages` 展开 `#p=1` / `#p=2` → 两张图按顺序去重；
- 进度：`idCode` 优先于 URL、旧格式迁移、脏数据丢弃、envelope 往返、upsert 去重、无变化不写、缺稳定 ID 不存、删站点/删章节、单站点上限裁剪（时间戳相同时按写入顺序）、章节行文案。

当前整体：**22 个 suite、112 个用例**；`npm run typecheck`、`npm run lint` 通过。

## 4. 还没做

- 双页 / RTL 阅读模式；
- 章节目录跳转：当前只在相邻章节间连读，章节列表仍只展示前 30 条；
- 图片磁盘缓存与内存上限；
- 图内偏移恢复（当前只恢复到图片顶部）。
