# comicbz / M-ngabz 适配记录（2026-11-03）

- 规则：`artifacts/yealico-rules/site-5-M-ngabz-comicbz.com.json`
- 站点：`http://comicbz.com`（同时支持 https）
- 设备：vivo V2245A / Android 15

## 1. 站点结构

首页是服务端 HTML，作品链接形如 `/1032bz/`；列表的“更新時間/人氣/上架時間”页签走 JSON API：

```text
http://comicbz.com/manga-list/mangabz.ashx?action=getclasscomics&pageindex=1&pagesize=21&tagid=0&status=0&sort=2
```

响应以 `{"UpdateComicItems":[...]}` 开头，字段为 `Title`、`Author[0]`、`ShowPicUrlB`、`UrlKey`、`LastUpdateTime`。

规则 `rules.index` 用 JSONPath（`$.UpdateComicItems`、`$.Title` 等），`pages` 里“首頁”另有 HTML `listRule`。

详情页 `/{idCode}/` 是静态 HTML，章节列表在 `#chapterlistload>a`，每项：

```html
<a href="/m532477/" title="試看">第5話 試看 <span>（19P）</span></a>
```

章节页 `/m{mangaId}/` 不再下发 `MANGABZ_VIEWSIGN`，旧的 `chapterimage.ashx` 二级页规则失效。图片改为移动版页面 JS 解包内联 `eval(...)` 后写入 `#cp_img>img`，URL 形如：

```text
https://image.comicbz.com/2/1032/92036/1_1132.jpg?cid=92036&key=...&type=1&uk=...
```

## 2. 规则改动

- `meta.flags`：加 `jsNeededDetail`，让详情/图库走 WebView。
- 删除 `gallery.secondLevelPageUrl`：页面已无 `MANGABZ_VIEWSIGN`，旧正则生成不了图片接口。
- `gallery.httpHeaders`：保留 iPhone UA；引擎现在会把它合并进图库请求头，WebView 也用它作为渲染 UA。
- `chapterRule.title` 正则改为 `(.+?)\s*[（(]\d+P[）)]`，兼容半角 `(19P)` 与全角 `（19P）`。

## 3. 引擎/渲染器修复

1. **JSONPath 数组展开**：`$.UpdateComicItems` 选中数组本身时，`selectNodes` 展开为多个节点，否则 item 会被当成一个数组。
2. **WebView 等待选择器过滤 JSONPath**：`waitSelector` 只接受 CSS 选择器；`$.UpdateComicItems` 传给 `querySelector` 会抛错并超时。
3. **`gallery.httpHeaders` 生效**：`parseHttpHeaders` 解析 JSON 字符串/对象，合并到图库页请求头。
4. **WebView 按请求头设置 UA**：`render` 增加 `userAgent` 参数，章节页用 iPhone UA 才能渲染出 `#cp_img>img`（桌面 UA 是空容器）。
5. **JSON 页面解包**：WebView 会把 JSON 包成 `<pre>`，`outerHTML` 不是原始 JSON；渲染器和 `webviewFetcher` 都会解包回原始文本，JSONPath 才能解析。
6. **`$1|{source:}` 语义**：匹配成功时只取 `$1`，失败才回退原值；之前会把原值拼接到结果，导致章节标题重复两遍。

## 4. 真机结果

- 列表：“更新時間”页签显示 10+ 部作品（丝与铠、邻家天使…、宵待步行等），`idCode` 正常。
- 详情：标题、作者、简介、封面、章节 (5) 正常。
- 阅读器：第 4 話显示 `1 / 26 图`，图片正常加载。
- release 包（debug keystore 签名）下列表、详情、封面、阅读器同样正常，不依赖 Metro。

## 5. release 适配

release 构建默认禁止明文，除了把规则 URL 切到 https，还处理了封面：

- 列表/详情/搜索的 `cover` 规则加 `regex: ^http://(.+)$`、`replacement: https://$1|{source:}`，把 `http://cover.comicbz.com/...` 升级为 https（不匹配时回退原值）。
- 章节图片本身就是 `https://image.comicbz.com/...`，无需转换。

## 6. 已知限制

- 规则 URL 已全部切到 `https://`，release 构建可直接使用（列表 API / 详情 / 章节页 https 均验证 200）。
- 图片签名 URL 对 UA 不敏感（桌面/无 UA 都返回 200），但页面渲染必须用移动 UA。
- 章节页图片数量依赖移动版 JS，桌面 UA 下 `#cp_img` 为空。

## 7. P5 回归（真机 release 包）

- 快速退出重进：第 4 話 → 返回详情 → 再进入，进度保持 `1 / 32 图`，无崩溃。
- 断网：飞行模式下已缓存图片仍显示（RN Image 缓存），没有白屏；未缓存的图片失败路径未复现。
- 长列表：comicbz 单部作品章节较少，长列表回归仍依赖漫画柜 650 章样本（当前 403 不可达）。
