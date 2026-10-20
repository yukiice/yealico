# Yealico Edit 实拍样本：阿巴基猫（2026-10-20）

- 来源：用户提供的 4 张 Yealico 规则编辑界面截图（其中两张重复）。
- 站点：`阿巴基猫 あばき猫` / `wc3818290.home.blog`
- 规则版本：`2.4@wc3818290`
- 性质：**第一条真实规则取证样本**。截图只覆盖“通用规则”和“Pages”上半部分，规则定义尚未取得，因此不能标记为兼容。

## 1. 已确认字段

### 通用规则

| 编辑器字段 | 值 |
| --- | --- |
| 站点名称 | `阿巴基猫 あばき猫` |
| 域名 | `wc3818290.home.blog` |
| 图标 | `https://{domain:}/wp-content/uploads/2022/01/cropped-e4b88be8dbdb.webp` |
| 原网页的章节顺序 | 升序 |
| 登录地址 | 空 |
| Browser Cookie | 空 |
| Flags | 空 |
| 作者 | `wc3818290` |
| 作者网站 | `https://wc3818290.home.blog` |
| 版本 | `2.4@wc3818290` |

### Pages

| 编辑器字段 | 值 |
| --- | --- |
| 页面名称 | `最近更新` |
| Flags | `default` |
| 系列页 URL / 规则 / 显示模式 | 空 / 默认 / 默认 |
| 列表页 URL | `https://{domain:}/update_history/` |
| 列表页规则 | `List: recently` |
| 列表页 Display Mode | `Text` |
| 详情页 URL | 空（截图被截断，需确认下方是否还有值） |

## 2. 公开页面核对

`https://wc3818290.home.blog/update_history/` 是公开的 WordPress 静态页面：

- 页面标题：`更新历史 – Update History – 阿巴基猫 あばき猫`
- 列表条目位于 `p.wp-block-paragraph`，每条包含：
  - 形如 `[10/05]` 的日期前缀
  - 一个 `<a href="...">标题</a>`
  - 一段更新说明
- 当前页面有 **117 个带链接的段落**，69 个唯一链接。
- 示例：
  - `10/05 | Manga Raw 漫画 Me(mangaraw.best) | https://wc3818290.home.blog/2024/12/01/...`
  - `10/05 | 85PO | https://wc3818290.home.blog/2024/11/24/...`
  - `09/16 | パイパンコン | https://wc3818290.home.blog/2026/01/07/...`

### 候选规则（不是 Yealico 实际规则）

根据页面结构，`List: recently` 很可能接近：

```json
{
  "item": { "selector": "p.wp-block-paragraph" },
  "idCode": { "selector": "a", "function": "attr", "param": "href" },
  "title": { "selector": "a", "function": "text" },
  "published": {
    "selector": "this",
    "function": "text",
    "regex": "\\[([0-9/]+)\\]",
    "replacement": "$1"
  }
}
```

**这只是结构推断**，不能替代 Yealico 编辑器里的 `List: recently` 定义。实际规则可能：
- 用不同的 `item` 选择器；
- 用 `regex` 截取 href 的最后一段作为 `idCode`；
- 对日期做不同的处理；
- 配置了详情页/图库页；
- 有 `ignoreDetail` 或其他 flags。

## 3. 仍缺少的字段

要重建可执行规则，至少还需要：

1. `规则` 下拉 `List: recently` 的完整定义：
   - `Item`
   - `ID Code`（selector / function / param / regex / replace）
   - `Title`
   - `Cover` / `Author` / `Rating` / `Published` / `Datetime`（有则截）
2. `Pages` 下半部分：
   - 详情页 URL / 规则 / 显示模式
   - 图库页 URL / 规则 / 显示模式
   - 搜索页 / Tag Link Page / Extra Rules（如果存在）
3. 顶部其他标签页（如果可横向滚动）：
   - Series Page / Index Page / Detail Page / Gallery Page 等
4. 该规则是否有章节、图片、分页字段；如果没有，明确记录“无”。
5. 页面列表的 `规则` 是否是命名规则；如果是，命名规则的完整字段。

## 4. 下一步截图

按优先级：

1. 点 `规则` 下拉里的 `List: recently`，截取打开的规则编辑器（重点）。
2. `Pages` 向下滚动，分别截取详情页、图库页、搜索页等。
3. 顶部标签栏向左滑，截取所有标签页。
4. 如果 `规则` 有多个命名规则，逐个截取。
5. 保持 `Browser Cookie` 为空；不要提供账号/Cookie。

## 5. 拿到后的验证

- 把截图字段重建为 `RuleDocument`，先跑 `buildRoutePlan`，确认没有未知函数/字段。
- 用公开的 `update_history` HTML 跑 `executeList`，与 Yealico 显示结果对照。
- 这个规则是作者自己的 WordPress 站点，静态、无登录、页面小，适合作为 P0b 的第一条真实样本。
- 通过后再处理禁漫天堂这类复杂规则。
