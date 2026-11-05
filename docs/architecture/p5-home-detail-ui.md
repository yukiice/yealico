# P5 首页与详情页 UI 改版

参考设计稿：`https://app.pen.dev/s/MsztWKoxNDH7kuMKe89OEqduhXsuyB2232MtL8rYl5A`（只覆盖首页、详情页两屏）。

## 主题

- 新增 `src/app/theme.ts`：白底、浅灰表面、粉色强调 `#F06D8C`。
- 首页、详情页改为浅色；站点管理、阅读器、调试页仍是原先的深色界面。

## 首页（站点页列表态）

`src/app/SiteWorkspace.tsx`：

- 顶部站点名 + 调试入口。
- 胶囊搜索框（`site-search-input`），回车搜索，右侧 `×` 清空并恢复列表。
- 分类 tabs 直接映射规则 `pages`（comicbz 为上架時間/人氣/首頁/分類/更新時間），选中项粉色文字 + 下划线；搜索时 tabs 不高亮。
- 3 列封面网格：`FlatList numColumns={3}`，封面 3:4，标题最多 2 行（`minHeight` 对齐），副标题显示 `idCode`。
- 底部悬浮导航 `src/app/BottomNav.tsx`：发现 / 收藏 / 历史 / 我。
  - 发现：列表。
  - 收藏：空态占位（暂无数据模型）。
  - 历史：当前站点的阅读进度（`progress.list()`）。
  - 我：站点信息 + 「站点管理」+「调试」。
- 详情页底部导航通过 `onNavigate` 回到列表并切换 tab。

## 详情页

`src/app/DetailScreen.tsx`：

- 顶部封面大图（300 高），左上返回、右上刷新（刷新会清掉 10 分钟详情缓存并重新请求）。
- 标题、作者。
- 「章节 / 浏览」双 pill，默认「浏览」；选中态粉底白字，另一个粉描边。
  - 浏览：简介（`detail.fields.desc/description`）、标签（`tag/tags`，有才显示）。
  - 章节：前 30 章直接列出，超过 30 章显示「查看全部 N 章」进入带过滤的章节选择器。
- 阅读器、章节过滤、进度恢复逻辑保持不变。

## 导航外壳

`src/app/SiteManager.tsx` 选中站点后改用全屏 `Modal` 渲染 `SiteWorkspace`，避免首页被外层「Yealico / 站点 / 自检」深色壳包住；同时把状态栏切成深色文字。

## 验证

- `npm run typecheck`、`npm run lint`、24 suites / 129 tests 通过。
- 真机（vivo V2245A，debug + Metro）：
  - 首页网格、搜索框、分类 tabs、底部导航正常。
  - 详情页封面、章节/浏览切换、简介、28 章列表正常。
  - 章节 → 阅读器（第 28 話，1/34 图）→ 返回详情 → 返回首页链路正常。

## 未做

- 设计稿中的评分、心形、标签云、「您可能还喜欢」推荐、收藏数据：当前规则没有对应字段，未做假数据。
- 站点管理、自检、阅读器、调试页未改为浅色主题。
- 底部导航的收藏仍是空态。
