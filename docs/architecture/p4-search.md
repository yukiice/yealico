# P4 站点内搜索

## 背景

P1–P3 只支持列表/详情/图库；`buildRoutePlan` 对 `searchUrl` 直接报 `UNSUPPORTED_FEATURE`，搜索框也不存在。P4 补齐「用规则里的 `searchUrl` + `searchRule` 做站内搜索」的最小链路。

## 引擎

`src/engine/load.ts` 新增 `loadSearch(rule, plan, fetcher, keyword, context, options)`：

- `rule.searchUrl` 缺失 → `MISSING_FIELD`（与详情/图库的缺字段处理一致）。
- `keyword.trim()` 为空 → 直接返回空结果，`complete=true`，不发请求。
- 默认 `maxPages = 1`，只取搜索第一页。
- 把 `keyword` 注入 `searchContext`，`{keyword:}` 占位符由 `buildPageUrls` 展开。
- 解析规则优先 `rule.searchRule`，缺省回退 `rule.indexRule`，复用 `executeList`。
- 结果按 `listKey` 去重，返回 `LoadedListResult`。

`src/engine/plan.ts` 不再为 `searchUrl` 产生 `UNSUPPORTED_FEATURE`；`scanUrl` 仍会扫描 `searchUrl` 里的占位符，未知占位符继续报 `UNKNOWN_PLACEHOLDER`。

`src/engine/index.ts` 导出 `loadSearch`。

## UI

`src/app/SiteWorkspace.tsx`：

- 页签下方新增搜索行：`TextInput`（`testID="site-search-input"`）+ 搜索按钮（`testID="site-search-submit"`）。
- 输入框回车或点按钮都会把 `searchInput` 写入 `searchKeyword`，触发重新加载。
- 有 `searchKeyword` → `loadSearch(..., {maxPages: 1})`；清空 → 回到 `loadListPages(..., {maxPages: 1})`。
- 调试页 label：搜索时记为 `搜索：<keyword>`。
- 空状态与加载文案随搜索态切换（`正在搜索…` / `没有匹配的作品`）。

## 测试

- `__tests__/search.test.ts`：关键词展开 + `searchRule` 解析、缺 `searchUrl` 报 `MISSING_FIELD`。
- `__tests__/engine.test.ts`：golden 里 `searchUrl` 的 `UNSUPPORTED_FEATURE` 期望已移除，只保留 `seriesRule`。
- `docs/rules/samples/synthetic-unsupported` 的 `expected-plan.json` 与 README 同步更新，`fixtures.generated.ts` 由 `node scripts/sync-fixtures.mjs` 重新生成。

## 限制

- 只取搜索第一页，未做分页/翻页。
- 搜索页若依赖 JS 渲染，`loadSearch` 没有显式传 `waitForSelector`，走 WebView 默认等待与 30s 超时；真实站点是否可用需要在可达站点上验证。
- UI 分支目前只有 typecheck/lint/引擎测试覆盖，尚未加 UI 单测；真机已验证 comicbz 搜索，见下文。

## 真机验证（comicbz）

- 设备 vivo V2245A，debug 包 + Metro。
- 搜索 `BLACK` 返回 9 部作品，标题、idCode（`48853bz` 等）正常。
- 搜索页按 UA 分流：桌面 `.mh-item`、移动 `.manga-item`；规则用逗号选择器同时覆盖。
- `function: text` 现在会 `trim()`，否则 HTML 缩进会让标题看起来居中。
- 页签 `ScrollView` 加 `flexGrow: 0`，修复空结果时页签被拉伸的问题。

## 未覆盖

- 搜索分页（只取第 1 页）。
- 中文关键词只能用真实输入法验证（`adb input text` 不支持中文）。
- 搜索页依赖 WebView 的站点未验证。
