# macOS Yealico 容器规则提取

- 记录日期：2026-10-20
- 目标：不逆向、不解密 QR，直接从本机 Yealico 的本地数据库读取已解密的规则 JSON。
- 结论：**可行**。macOS 版 Yealico 把站点规则以明文 JSON 存在 SQLite 中；`ZISENCRYPTED=1` 只是导入来源标记，不代表规则列被加密。

## 1. 环境与位置

| 项 | 值 |
| --- | --- |
| App | `/Applications/Yealico.app` |
| bundle id | `work.cmbook.ComiGa` |
| App 版本 | 7.2.4 |
| 容器 | `~/Library/Containers/work.cmbook.ComiGa` |
| 数据库 | `Data/Library/Application Support/ComiGa/ComiGa.sqlite` |
| 数据库大小 | 约 340 KB（另有 WAL/SHM） |

App 包是 `WrappedBundle -> Wrapper/ComiGa.app` 的 iOS-on-Mac 包装；容器对当前用户可读。

## 2. 规则相关表

| 表 | 用途 |
| --- | --- |
| `ZSITE` | 站点元数据、URL 模板、默认 index/detail/gallery/series/search/tag 规则 JSON |
| `ZSITELISTRULE` | 命名 ListRule（如 `List: recently`、`List: Home`） |
| `ZSITEDETAILRULE` | 命名 DetailRule |
| `ZSITEGALLERYRULE` | 命名 GalleryRule |
| `ZSITESERIESRULE` | 命名 SeriesRule |
| `ZSITEPAGE` | 页面配置，含 URL 模板、display mode、flags，以及 `ZLISTRULE`/`ZDETAILRULE`/`ZGALLERYRULE`/`ZSERIESRULE` 外键 |

关键列：

- `ZSITE.ZINDEXRULEJSON`
- `ZSITE.ZDETAILRULEJSON`
- `ZSITE.ZGALLERYRULEJSON`
- `ZSITE.ZSERIESRULEJSON`
- `ZSITE.ZSEARCHRULEJSON`
- `ZSITE.ZTAGSEARCHRULEJSON`
- 命名规则表的 `ZJSONSTRING`

这些列的值是**明文 JSON 字符串**，可以直接 `json.loads`。

## 3. 提取器

脚本：`scripts/extract_yealico_rules.py`

```bash
python3 scripts/extract_yealico_rules.py
# 或指定站点
python3 scripts/extract_yealico_rules.py --site-pk 1
# 输出到指定目录
python3 scripts/extract_yealico_rules.py --out artifacts/yealico-rules
```

行为：

- 以 `mode=ro` 只读打开数据库。
- 只查询站点元数据、URL、规则 JSON、命名规则、页面引用。
- **不查询** `ZCOOKIE`、`ZCUSTOMCOOKIE`、`ZUSER`、收藏、历史、搜索历史、下载任务等个人数据。
- 输出 `artifacts/yealico-rules/site-<pk>-<name>-<domain>.json`，包含：
  - `meta`：名称、域名、版本、作者、displayMode、flags
  - `urls`：index/detail/gallery/search
  - `loginUrl`、`headers`
  - `rules`：index/detail/gallery/series/search/tagSearch/extra
  - `namedRules`：命名 List/Detail/Gallery/Series 规则
  - `pages`：页面配置，已把外键解析成对应规则 JSON

`artifacts/yealico-rules/` 已加入 `.gitignore`，避免把作者规则或个人数据误提交。

## 4. 提取结果

当前本机 6 个站点：

| PK | 站点 | 域名 | 版本 |
| --- | --- | --- | --- |
| 1 | →禁漫天堂 | `jm18c-dfg.cc` | 2.26@wc3818290 |
| 2 | 拷貝漫畫 | `mangacopy.com` | 2.15@wc3818290 |
| 3 | 阿巴基猫 あばき猫 | `wc3818290.home.blog` | 2.4@wc3818290 |
| 4 | →禁漫天堂（重复） | `jm18c-dfg.cc` | 2.26@wc3818290 |
| 5 | Māngabz | `comicbz.com` | 2.1@wc3818290 |
| 6 | 漫画柜 简体 | `www.manhuagui.com` | 1.7@wc3818290 |

### 禁漫天堂 2.26

- `ZINDEXRULEJSON`: item、idCode、title、cover、category、author、likes
- `ZDETAILRULEJSON`: `chapterRule`、`tagRule`、`published`、`author`、`category`、`desc`
- `ZGALLERYRULEJSON`: `item`、`image`、`totalPages`
- `ZSERIESRULEJSON`、`ZSEARCHRULEJSON`、`ZTAGSEARCHRULEJSON`: 有内容，但首版未实现
- `ZFLAGS` 为空；`displayMode` 为 `tag, collection, default, default`
- RoutePlan：`static=true`，无 `INVALID_RULE`/`UNKNOWN_FIELD`；29 个 `pages` 可枚举；未支持 `searchUrl`、`seriesRule`、`displayMode=tag`

### 阿巴基猫 2.4

- 默认 index/detail/search 规则存在，gallery 为空
- 命名规则 `List: recently`：
  ```json
  {
    "item": { "selector": ".entry-content p" },
    "title": { "selector": "this", "function": "text", "regex": "\\](.+)" },
    "datetime": { "selector": "this", "function": "text", "regex": "\\[(.+)\\]" },
    "idCode": {
      "selector": "a",
      "function": "attr",
      "param": "href",
      "regex": "{domain:}\\/(.+)\\/"
    }
  }
  ```
- 对 `https://wc3818290.home.blog/update_history/` 执行：118 条，0 诊断。
  - 117 条带链接；第 118 条是无链接空段落。
  - 是否过滤空项需要与原版 Yealico 对照，不能擅自改语义。

## 5. 验证

- `toRuleDocument` 已把提取结构转成项目 `RuleDocument`。
- `__tests__/real-rules.test.ts`：
  - 禁漫 2.26：index/detail/gallery 存在；RoutePlan 无 `INVALID_RULE`/`UNKNOWN_FIELD`。
  - 阿巴基猫：`List: recently` 对真实结构 HTML 提取 2 条，日期与 idCode 正确。
- 本地提取文件存在时运行；不存在则跳过，避免把作者规则提交进仓库。
- 当前 Jest：4 个 suite、22 个用例。

## 6. 这说明什么

- **规则的“解密过程”确实在 Yealico 内，但解密的产物以明文存在本地 SQLite。** 对开发/兼容性验证，不需要拿到密钥或 hook 客户端。
- QR/加密导出仍是终端用户分发格式；要让 Android 用户自动导入，仍需 QR 解码或让用户粘贴 JSON/URL。**但“理解并使用作者的规则”已经不再被 QR 加密阻塞。**
- 这条路径只适用于 macOS 版 Yealico；iOS 用户仍可用 Edit 界面或备份。

## 7. 限制与合规

- 数据库 schema 随 Yealico 版本变化；升级后需重新核对列名。
- 提取出的规则版权属于作者 `wc3818290`；仅在本地兼容性测试使用，不随仓库分发，不公开再发布。
- 不读取 Cookie、账号、收藏、历史、下载任务；这些不是规则的一部分。
- 不用这条路径绕过付费功能、站点访问控制或 DRM。
