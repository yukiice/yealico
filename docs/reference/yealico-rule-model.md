# Yealico 规则语义基线（P0a）

- 依据：官方 Site Rule Wiki（`https://yealico.app/site-rule-wiki/`，页面标注 update 2026-02-28）与其中标注的版本号 5.4.1～7.1.1。
- 本文是**语义提炼**，不是官方文档副本；引用时保留来源链接，不复制原文段落。
- 用途：P1/P2 的规则模型、RoutePlan、fixture 和兼容矩阵都以本文为基线。
- 未确认项集中记录在 [`open-questions.md`](../rules/open-questions.md)，不得用实现猜测覆盖。

## 1. 术语

| 术语 | 含义 |
| --- | --- |
| Site | 一份规则文件的顶层，描述一个站点 |
| Rule | 某类页面的提取规则：`seriesRule` / `indexRule`（List） / `detailRule` / `galleryRule` |
| Selector | 规则的最小提取单元，五要素：`selector`、`function`、`param`、`regex`、`replacement` |
| Placeholder | URL 模板中的 `{...}`，在请求前展开 |
| Flag | Site 或 Page 上的能力/行为声明，例如 `jsNeededDetail` |
| RoutePlan | 本项目新增的中间产物：规则 → 可执行计划 + 能力需求 + 不支持项 |

## 2. Site 层

官方语义中的 Site 字段：

| 字段 | 说明 | 首版处理 |
| --- | --- | --- |
| `name` | 站点名 | 必须 |
| `domain` | `{domain:}` 的替换值（6.5+） | 支持 |
| `displayMode` | `text` / `table` / `collection` / `waterfall` / `tag` | 首版支持 `text`、`collection`；其余识别但降级 |
| `loginUrl` | 登录页 | 识别，P4 使用 |
| `indexUrl` | 列表页 URL 模板 | 必须 |
| `detailUrl` | 详情页 URL 模板，通常含 `{idCode:}` | 必须 |
| `galleryUrl` | 图库页 URL 模板，通常含 `{cidCode:}` | 必须（若样本使用 GalleryRule） |
| `searchUrl` | 搜索页模板，含 `{keyword:}` | 识别，首版不实现 |
| `seriesRule` | Series 页规则（ListRule） | 识别，首版不实现 |
| `indexRule` | 默认 ListRule | 必须 |
| `detailRule` | 默认 DetailRule | 必须 |
| `galleryRule` | 默认 GalleryRule | 必须（若样本使用） |
| `pages` | 多页面配置，可覆盖 displayMode / flags / URL / rule，用 `relListRuleIndex` 关联 | 支持；`resolveRulePage` 按名称/索引选择并继承站点默认值 |
| `flags` | 能力声明 | 必须扫描 |
| HTTP headers | 6.3+；优先级 Rule > Page > Site | 必须按优先级合并 |

## 3. 四类 Rule

### 3.1 ListRule（`indexRule` / `seriesRule`）

| Selector | 说明 |
| --- | --- |
| `text` | 6.7.0；若设置，作为最终解析数据 |
| `item` | 选出列表项的集合；后续字段都限制在单个 item 内 |
| `idCode` | 唯一 ID，替换 `detailUrl` 的 `{idCode:}` |
| `title` / `cover` / `coverWidth` / `coverHeight` | 标题、封面、封面尺寸 |
| `largeImage` | 大图 URL |
| `Video` | 视频 URL |
| `category` / `author` / `uploader` / `published` / `datetime` / `rating` | 元数据 |
| `totalImages` | 图片总数；与 `pictureRule.url` 的 `{page:}` 组合时按 1..N 展开 |

### 3.2 DetailRule

- 通用字段与 ListRule 相同。
- `totalImages`：详情页图片总数；已接入 `pictureRule.url` 的 `{page:}` 展开。
- `photoAlbumLink`：二级页面；设置后 `pictureRule` / `chapterRule` / `videoRule` 作用于该链接页（已实现 detail 二级页编排）。
- `tagRule`：`item`、`name`、`url`。
- `pictureRule`：`item`、`thumbnail`、`url`、`link`。
  - `url` 在定义了 `link` 时，作用于 link 指向的页面。
  - `url` 结果若以 `web:` 开头，用 WebView 加载（6.7.0）。
- `chapterRule`：`item`、`idCode`、`title`、`datetime`、`url`；`idCode` 替换 `{cidCode:}`，是书签记录所必需。
- `commentRule`：`item`、`avatar`、`username`、`datetime`、`content`。

### 3.3 GalleryRule

- `secondLevelPageUrl`：二级页面；设置后 `pictureRule` / `videoRule` 作用于该链接页（已实现 gallery 二级页编排；允许省略 `selector`）。
- `totalPages`：当前图库页的总页数。
- `item`：当前页图片集合；省略时 `image` 的 selector 直接作为图片集合（漫画柜 1.7 形态）。
- `image`：单张图片 URL；直接集合模式下缺少 `function/param` 时默认取 `src` / `data-src` / `data-original`。
- `videoRule`：与 pictureRule 同构。

**注意**：`GalleryRule` 不是 `DetailRule.pictureRule` 的别名。两者的页面来源、分页字段和导航位置不同，必须分别建模。

### 3.4 SeriesRule

- 顶层 Series 页到 List 页的规则，本质是 ListRule。
- 首版不实现；能力扫描必须识别并返回 `UNSUPPORTED_SERIES`，不能静默当作首页。

## 4. Selector 执行语义

### 4.1 五要素

| 要素 | 语义 |
| --- | --- |
| `selector` | CSS3；JSONPath（5.4.1+）；`$root` 前缀表示从 JSON 根开始（6.7.1+）；`this` 表示当前节点 |
| `function` | 取值函数；空值表示包含当前元素的完整 HTML |
| `param` | `attr` 的属性名；支持逗号分隔多属性，按顺序取第一个非空（fallback） |
| `regex` | 至少一个捕获组；结果用 `$1`、`$2`… 引用 |
| `replacement` | 替换模板；为空时默认 `$1`；可用 `|{source:}` 在无匹配时保留原串；允许数学表达式（评分场景） |

### 4.2 取值函数

官方列出的函数：

| 函数 | 说明 | 首版 |
| --- | --- | --- |
| `html` | 当前元素内部 HTML | 是 |
| `text` | 去标签后的纯文本 | 是 |
| `attr` | 由 `param` 指定属性；多属性按顺序取第一个非空 | 是 |
| 空 / nil | 包含当前元素自身的 HTML | 是 |
| `decodeBase64` | Base64 解码（6.7.0） | 是（需 Hermes 验证 `atob`） |
| `removingPercentEncoding` | 去除百分号编码（6.7.0） | 是 |
| `addingPercentEncoding(allowedCharacters)` | 百分号编码，可选允许字符集（6.7.0） | 是 |
| `replace("a", with: "b")` | 字符串替换（6.8.2） | 是 |
| `decompressFromBase64` | Base64 + LZString 解压（6.14.5） | 是（纯 JS 库） |
| `reversed` | 反转字符串（7.1.1） | 是（字符语义待确认） |
| `regexReplacement` | 立即执行当前 Selector 的 regex/replacement（7.1.1） | 是 |

官方文档同时出现两种链式写法：

- “多个函数用逗号分隔”；
- “多个函数用 `.` 从左到右连接”。

这是文档内部歧义，列入 `open-questions.md` Q1。首版先实现一种，另一种在 P0b 用真实样本确认后再加，不能同时猜。

### 4.3 多 JSONPath

- `selector` 支持用 `+` 连接多个 JSONPath（6.5+），结果对应 `$1`、`$2`…。
- 空值、越界、数组与标量的组合形态未在 Wiki 中说明，列入 Q7。

### 4.4 执行顺序

建议固定为：

```
定位节点 -> function 取值 -> regex 捕获 -> replacement 合成 -> trim/绝对化
```

理由：`regexReplacement` 需要引用当前 Selector 的 regex/replacement，顺序不能反过来。`trim` 和绝对 URL 归一化是本项目新增的显式步骤，不是官方函数，需在规则模型中标为扩展。

## 5. URL 占位符

| 占位符 | 语义 | 版本 |
| --- | --- | --- |
| `{page:start:step}` / `{page:1}` | 分页参数；省略 step 时为 1 | — |
| `{pageFormat:{page:...}}` | 首页不带分页信息 | — |
| `{idCode:}` | ListRule item 的唯一 ID | — |
| `{cidCode:}` | chapterRule item 的唯一 ID | — |
| `{keyword:}` | 搜索关键词 | — |
| `{json:...}` | URL 末尾带 JSON body，方法自动切 POST | 6.11 |
| `{domain:}` | Site.domain | 6.5 |
| `{urlPath:n}` | 路径段；0 为主机；支持负数；`*` 为全部段 | 7.1.1 |
| `{urlQuery:key}` | 查询参数值 | 7.1.1 |
| `{urlQuery:key|default}` | 带默认值 | 7.1.1 |
| `{urlQuery:*}` | 全部查询串 | 7.1.1 |
| `{urlScheme}` / `{urlHost}` / `{urlPort}` | URL 组成 | 7.1.1 |

要求：

- 占位符大小写不敏感。
- `{pageFormat:{...}}` 是嵌套结构，`{json:...}` 内可能含 `}`、引号和转义；解析器必须是括号/引号感知的扫描器，禁止 `split(':')` 或全局正则替换。
- `{urlPath:0}` 返回主机（不含端口？待确认，Q8）。
- `{urlQuery:key|default}` 的 default 若含 `|`，如何切分？列入 Q9。

## 6. Flags

| 类别 | flags | 首版 |
| --- | --- | --- |
| 会话 | `loginRequired`、`consentRequired`（6.13） | 识别；P4/P3b 实现 |
| WebView | `jsNeededIndex` / `jsNeededDetail` / `jsNeededGallery` / `jsNeededSearch` / `jsNeededTagLink` / `jsNeededPhotoAlbum` / `jsNeededSecondLevelPageGallery` / `jsNeededAll` | 识别；P4 实现，P2 返回 `NEEDS_WEBVIEW` |
| POST | `postSearch` / `postIndex` / `postDetail` / `postGallery` / `postPhotoAlbum` / `postAll` / `postTagLink` | 支持（与 `{json:}` 一致） |
| 滚动 | `scrollIndex` / `scrollDetail` / `scrollGallery`（6.14.1） | 识别；仅 WebView 模式有意义 |
| 字符集 | `big5Charset*` / `gbkCharset*` | 支持（P1 验证解码能力） |
| URL 编码 | `gbkUrlEncodingAll` | 支持（P1 验证编码能力） |
| 展示 | `repeatedThumbnail` | 识别；首版可降级为普通缩略图 |
| 导航 | `ignoreDetail` | 必须支持：列表 → 图库，跳过详情 |
| UA | `userAgentMobile` | 支持 |

能力扫描的输出必须是结构化的 `capabilities`，不能只保留原始 flags 字符串。示例：

```
RoutePlan.capabilities = {
  static: boolean,
  webview: boolean,
  login: boolean,
  consent: boolean,
  post: boolean,
  charset: 'utf-8' | 'gbk' | 'big5' | ...,
  gbkUrlEncoding: boolean,
  ignoreDetail: boolean,
  repeatedThumbnail: boolean,
  scroll: boolean
}
```

## 7. Headers 与 Cookie

- Headers 优先级：`Rule > Page > Site`；同名键高层覆盖低层。
- Cookie 两类：
  - Browser Cookie：内置浏览器访问站点时获得；
  - Custom Cookie：用户手填，冲突时优先。
- 规则引擎不直接持有原始 Cookie；页面和引擎只持有 `sessionId`（见主计划 3.4）。

## 8. 首版实现范围（P0a 结论）

| 能力 | 首版 | 理由 |
| --- | --- | --- |
| 静态 HTML + CSS | 是 | 核心链路 |
| JSONPath + `$root` | 是 | 官方 5.4.1+，样本可能使用 |
| `+` 多 JSONPath | 是（若 P0b 样本需要；否则识别并报错） | 官方 6.5+ |
| ListRule / DetailRule / GalleryRule | 是 | 三条取图链路 |
| `pictureRule` + `totalImages` / `{page:}` | 是 | 已实现模板展开；页码/step 仍待真实样本确认 |
| pages 多页 | 是 | 已实现页面选择与规则继承 |
| SeriesRule / search / comments | 否，识别并报错 | 首版范围控制 |
| WebView / login / consent | 否，P4/P3b | 需要样本证明 |
| GBK / Big5 | 是 | 官方 flags，且影响解码与 URL |
| LZString / Base64 函数 | 是 | 纯 JS 可移植 |
| 数学表达式 replacement | 是（受限求值器） | 评分场景 |
| `displayMode: waterfall` | 否，降级 | 需要 coverWidth/Height |

## 9. 对实现的硬性要求

1. 规则原文只读保留，导入后计算 SHA-256；不得用不可逆转换覆盖原字段。
2. 所有未知字段、未知函数、未知 flag、未知占位符进入 `unsupported[]`，带 `fieldPath` 和错误码。
3. 不允许 `eval` / `new Function` 执行导入字符串；数学表达式用白名单求值器。
4. 同一规则在 Node 与 Hermes 的结果必须一致；差异记录为缺陷，不用环境分支掩盖。
5. 解析器对输入大小、分页数、滚动次数设硬上限。
