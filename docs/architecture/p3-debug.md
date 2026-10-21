# P3：调试页

- 记录日期：2026-10-21
- 范围：当前规则与能力展示、阶段记录、结果数量、脱敏诊断。
- 状态：**Jest 覆盖已跑通；Android 真机未验收**。至此 P3 清单全部完成。

## 1. 为什么需要它

规则引擎的失败大多是“静默的”：选择器没命中就是空列表，`totalPages` 缺失就是只拉一页。只看 UI 的“列表为空”无法区分三种情况——站点真的空、规则写错了、能力被阻断。调试页把这三者分开：

| 信息 | 回答的问题 |
|---|---|
| 规则来源 / 哈希 / 原文长度 | 我装的到底是哪一版规则 |
| `describeCapabilities` | 规则声明了哪些能力（static / webview / charset…） |
| `blockingReasons` | 哪些能力缺失会让执行直接失败 |
| 阶段记录 + 结果数量 | 卡在列表、详情还是图库，解析出多少条 |
| 诊断（脱敏） | 具体哪个 `fieldPath` 出错、HTTP 状态或异常文本 |

## 2. 结构

```text
SiteWorkspace
  ├─ debug = useRef(new DebugSession())     // 每站点一份，内存态
  ├─ 顶部「调试」按钮 → DebugScreen
  └─ 向下透传 debug → DetailScreen → ReaderScreen
```

三个阶段各自在加载成功后写入一条记录：

- 列表：`{ items, pages }` + `built.plan.unsupported` + `result.diagnostics`
- 详情：`{ chapters, pictures, urls }`
- 图库：`{ images, pages, totalPages? }`

`DebugSession` 保留最近 20 条，最新在前；`list()` 返回副本，调用方改不动内部状态。

## 3. 脱敏

规则里可能带 `token`、`sign`、`Cookie` 或内嵌账号，调试页是给别人看截图的重灾区，所以分两层处理：

- `sanitizeUrl`：去掉 URL 里的 `user:pass@`，把敏感 **query 参数的值**替换成 `***`；
- `sanitizeText`：诊断详情里的裸查询串同样处理；
- `formatDiagnostic`：`ERROR MISSING_FIELD @ galleryRule.image — …`。

参数名用**完全匹配**的敏感词表，不用“包含 key”这类宽松规则：

- `keyword=猫` 不脱敏（不是密钥，脱敏就没法排查搜索页）；
- 早期版本把 `code` 也列进敏感词，会误伤部分站点的章节码参数，已移除。

path 和 hash 一律保留——`#p=7` 这类页码正是定位问题所需的。

原始 URL 只存在内存里，脱敏发生在展示层；`list()` 拿到的仍是原始值。

## 4. 测试

`__tests__/debug-report.test.ts`（10 个用例）：

- 敏感参数脱敏、非敏感参数保留（含 `keyword` 不被误伤）；
- path / hash 不动、空串、userinfo 剥离；
- 自由文本中的裸查询串脱敏；
- 诊断格式化（带/不带 detail）；
- 能力摘要、阻断项只取 `severity === 'error'`；
- 会话上限与“最新在前”、`list()` 返回副本、`clear()`。

当前整体：**19 个 suite、98 个用例**；`npm run typecheck`、`npm run lint` 通过。

## 5. 还没做

- 调试页只在 Jest 验证，Android 上没跑过；
- 没有导出/复制报告（需要 Clipboard 原生能力）；
- 不展示每个选择器的命中数，只展示阶段级数量；
- 不记录耗时（`loadListPages` 已有 `urls`，加时间戳是下一步）。
