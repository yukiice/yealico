# 规则语义待确认项（P0a）

- 目的：把“官方文档没有写死、或文档内部不一致”的语义集中管理，避免实现者凭直觉补全。
- 规则：**未确认项不得在代码里静默猜测**。首版可以选一个默认行为，但必须在这里记录默认值、证据来源和切换成本。
- 关闭条件：有真实规则样本、官方说明或原版 Yealico 行为截图之一，并在“证据”列填写。
- 关联：[规则语义基线](../reference/yealico-rule-model.md)、[兼容矩阵](compat-matrix.md)。

| 编号 | 问题 | 影响 | 首版默认 | 验证方式 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | `function` 多函数到底用逗号还是 `.` 连接？文档两处说法不一致 | 函数链解析器 | 先实现 `.` 链式；逗号形式识别但报 `UNSUPPORTED_FUNCTION_SYNTAX` | 真实样本；原版 Yealico 截图 | 待补 | 未确认 |
| Q2 | `replace("a", with: "b")` 的命名参数如何与逗号分隔共存？ | 函数参数解析 | 括号/引号感知扫描；`with:` 作为命名参数 | 单元 fixture | 待补 | 未确认 |
| Q3 | `attr` 的 `param` 用逗号分隔多个属性时，返回拼接串、数组，还是第一个非空？ | 字段结果形态 | 按顺序取第一个非空（fallback）；禁漫 2.26 的 `data-original, src` 已验证 | 真实规则：禁漫 cover/image | [compat-matrix.md](compat-matrix.md) | 已确认 |
| Q4 | `reversed` 按 UTF-16 单元、码点还是扩展字形簇反转？ | 文本结果 | 按码点（`[...str].reverse()`） | fixture：emoji、组合字符 | 待补 | 未确认 |
| Q5 | `totalImages` + `pictureRule.url` 的 `{page:}`：页码从 1 还是 0 开始？step 默认多少？总数与页数不一致时怎么办？ | 是否需要逐页请求 | 已按从 1 开始、step 1 实现；单次上限 500，超出告警 | 真实样本 | 合成 fixture + 真实规则提取 | 已实现，待样本确认 |
| Q6 | `pages` 多页站点首版是否必须支持？ | 数据模型与导航 | 已实现 `resolveRulePage` / `buildPagePlan`；未选择时保留站点默认规则 | P0b 样本统计 | `__tests__/pages.test.ts` + 真实禁漫 29 页 | 已实现 |
| Q7 | `selector` 用 `+` 连接多个 JSONPath 时，`$1`/`$2` 的顺序、空值和数组形态？ | JSONPath 执行器 | 按书写顺序；空值为空串；数组按索引展开 | fixture | 待补 | 未确认 |
| Q8 | `{urlPath:0}` 是否包含端口？尾部斜杠是否算一段？ | URL 派生 | 只返回主机名；空段忽略 | fixture | 待补 | 未确认 |
| Q9 | `{urlQuery:key|default}` 的 default 本身含 `|` 时如何切分？ | 占位符解析 | 只按第一个 `|` 切分，其余作为默认值 | fixture | 待补 | 未确认 |
| Q10 | `{json:...}` 内的 `}`、引号、转义如何界定结尾？ | 请求构造 | 括号/引号感知；只在顶层 `}` 结束 | fixture | 待补 | 未确认 |
| Q11 | `replacement` 的数学表达式支持哪些运算符和函数？ | 评分字段 | 数字、括号、`+ - * /`、`$n`；禁用 `eval` | fixture | 待补 | 未确认 |
| Q12 | `$root` 与 CSS 混用时，`$root` 只对 JSONPath 生效还是也影响 CSS？ | 选择器上下文 | 只对 JSONPath 生效 | 真实样本 | 待补 | 未确认 |
| Q13 | `text` 函数是否折叠空白、是否保留 `<br>` 换行？ | 标题/作者字段 | 折叠连续空白，`<br>` 转空格 | fixture | 待补 | 未确认 |
| Q14 | 空 `function` 返回的是 `outerHTML` 还是 `innerHTML`？ | HTML 字段 | `outerHTML`（官方“包含自身”表述） | fixture | 待补 | 未确认 |
| Q15 | Hermes 的 RegExp 是否支持命名捕获组、lookbehind、Unicode property escape？ | 正则兼容 | 先探测；不支持则在 RoutePlan 报 `UNSUPPORTED_REGEX` | P1 探针 | 待补 | 未确认 |
| Q16 | `totalPages` 与 `{page:}` 的关系：是“总页数”还是“最后页码”？ | Gallery 分页 | 总页数；页码从 1 开始 | 真实样本 | 待补 | 未确认 |
| Q17 | 字符集优先级：HTTP header、BOM、`gbkCharset*` flag、meta charset 谁优先？ | 解码正确性 | flag > header > BOM > meta > UTF-8 | P1 探针 + 样本 | 待补 | 未确认 |
| Q18 | `gbkUrlEncodingAll` 是否影响所有 URL 参数，还是只影响搜索关键词？ | URL 编码 | 影响所有中文参数 | 真实样本 | 待补 | 未确认 |
| Q19 | 分页终止：无新增 `idCode`、连续空页、URL 重复、达到上限，哪个优先？ | 无限请求保护 | 四者任一触发即停；记录触发原因 | fixture | 待补 | 未确认 |
| Q20 | 稳定内容 ID：`idCode` 为空或不唯一时，回退到什么？ | 阅读进度关联 | `idCode` → 规范化详情 URL → 规则哈希 + 序号 | 设计评审 | 待补 | 未确认 |
| Q21 | `displayMode` 缺省值是什么？`waterfall` 缺 coverWidth/Height 时的降级顺序？ | 列表渲染 | `collection`；尺寸缺失降级 `collection` | 原版截图 | 待补 | 未确认 |
| Q22 | `loginRequired` + `consentRequired` 同时存在时，先登录还是先同意？ | P4 流程 | 先 consent，再 login | 真实样本 | 待补 | 未确认 |
| Q23 | Headers 的 `Rule > Page > Site` 中，Rule 指具体 Rule 对象上的 headers 还是页面级？ | 请求头合并 | 具体 Rule > page > site；大小写不敏感 | 真实样本 | 待补 | 未确认 |
| Q24 | `ignoreDetail` 时，`galleryUrl` 的 `{cidCode:}` 从哪来？ | 导航拓扑 | 用列表项 `idCode` 代替；若无则报 `UNSUPPORTED_IGNORE_DETAIL` | 真实样本 | 待补 | 未确认 |
| Q25 | `pictureRule.link` 定义了二级页时，`url` 在二级页执行，`thumbnail` 在原页执行？ | 取图链路 | 已实现 `link` → `url` 二级链路；`thumbnail` 仍未实现 | 真实样本 | `__tests__/second-level.test.ts` | 部分实现，待样本确认 |
| Q26 | `item` 等字段是否允许字符串简写（如 `"item": "li.item"`）？ | 规则读取与兼容 | 接受字符串简写为 `{selector}`；对象形式优先 | 真实样本 | 待补 | 未确认 |
| Q27 | JSONPath 的 `..`、`[?(...)]`、切片、联合是否首版支持？ | JSONPath 执行器 | 不支持，报 `UNSUPPORTED_JSONPATH`；需要时再实现受限子集 | 真实样本 | 待补 | 未确认 |
| Q28 | Yealico QR `v2:` 载荷如何解码？密钥/算法在客户端还是服务端？ | QR 导入 | 已关闭：v2 是 CloudKit 引用，密钥不在客户端，扫码必须联网；功能与解析层已移除 | 密钥搜索全量 0 命中 + 抓包只有 gateway.icloud.com + 飞行模式失败 | [qr-import.md](qr-import.md) | 已关闭（不可离线解码） |
| Q29 | Yealico 导出的 `{"encrypted":"v2:..."}` 如何解密？QR 是否提供密钥？ | 导出/导入 | 识别为加密导出并报 `UNSUPPORTED_ENCRYPTED_EXPORT`；不猜密钥 | 同规则 QR + 导出 + Edit 明文三件套；跨设备导入 | [yealico-export-format.md](yealico-export-format.md) | 不影响主路径 |
| Q30 | macOS Yealico 容器 schema 是否随版本变化？ | 规则提取 | 当前 7.2.4 已验证；升级后重新核对列名 | 版本升级 | [yealico-macos-sqlite.md](yealico-macos-sqlite.md) | 未确认 |

## 关闭流程

1. 新增证据：在 `docs/rules/evidence/` 放脱敏样本或截图说明，记录采集日期、规则哈希、来源。
2. 更新本表“证据”和“状态”。
3. 若默认行为需要改变，先补 fixture，再改实现；不允许只改代码不改文档。
