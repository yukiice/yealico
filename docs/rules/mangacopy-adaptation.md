# mangacopy 规则适配现状（2026-11-02）

- 规则：`artifacts/yealico-rules/site-2-拷貝漫畫-mangacopy.com.json`（macOS 容器提取）
- 站点：`https://www.mangacopy.com`
- 设备：vivo V2245A / Android 15，真机 + 局域网规则源

## 1. 站点已改为前端渲染

`/comics?ordering=-datetime_updated&offset=0&limit=50` 的静态 HTML 里，作品项只是 `<script>` 中的模板字符串（`exemptComic_Item`、`exemptComicItem-txt`），不是真实 DOM 节点。静态 fetch + CSS 选择器会得到 `EMPTY_RESULT`。

解决：给规则 `meta.flags` 加 `jsNeededIndex`，引擎按 `jsNeeded*` 判定 `webview=true`，列表改走 WebView。真机验证列表可显示前 10 项（有點黏人的假小子女友、異世界夫婦再戀譚等）。

## 2. 请求头要求

站点对移动 UA 返回移动版页面；桌面 UA 才包含规则期望的结构。App 的 `createFetchRuleFetcher` 现在默认补桌面 Chrome `User-Agent`、`Accept`、`Accept-Language`，规则显式头优先（大小写不敏感）。

真机验证：用本地 echo 服务器接收请求，确认 App 实际发送的是桌面 UA + `text/html` Accept + `zh-CN` 语言头。

## 3. 详情页新版结构（桌面渲染 DOM）

用 Chrome headless 抓渲染后的详情页，真实结构是：

```html
<div class="table-default-box">
  <div class="tab-content">
    <div id="default全部" class="tab-pane fade show active">
      <ul>
        <a href="/comic/{path_word}/chapter/{uuid}" title="1-..."><li>1-...</li></a>
      </ul>
    </div>
  </div>
</div>
```

规则已改为：

- `chapterRule.item`：`.table-default-box .tab-pane.active ul a[href*='/chapter/']`
- `chapterRule.title`：`li` 文本
- `chapterRule.idCode`：`this` 的 `href`，`regex: chapter/([^/?#]+)`，`replacement: $1`
- `chapterRule.url`：`this` 的 `href`（绝对化）

用 Jest + 渲染后 DOM 跑引擎，12 章全部解析出 `idCode` / `title` / `url`，无错误诊断。

同时删除失效的 `detailRule.photoAlbumLink`：它匹配 `.alert-body-input`，新版页面不存在，会误生成 `https://www.mangacopy.com/comicdetail/{slug}/chapters` 二级页；该接口返回加密字符串（`{"results":"mpqD..."}`），不是可解析 chapters JSON。

## 4. 图库新版结构（桌面渲染 DOM）

章节页渲染后：

```html
<div class="container comicContent">
  <ul class="comicContent-list comic-size-1">
    <li><img data-src="https://sy.mangafunb.fun/.../xxx.jpg.c1500x.jpg" src=".../loading.jpg" class="lazyload"></li>
  </ul>
</div>
<span class="comicIndex">1</span>/<span class="comicCount">3</span>
```

规则已改为：

- `galleryRule.item`：`ul.comicContent-list li img`
- `galleryRule.image`：`this` 的 `data-src, src`

旧规则 `div.disData` + `class` 替换已被取代。该章节样例解析出 3 张图。

## 5. 真机详情页仍超时（未解决）

真机 WebView 详情页报：

```text
NETWORK_ERROR: WebView render timed out after 15000ms
manga=no | imgs=2 | wait=.table-default-box .tab-pane.active ul a[href*='/chapter/']
```

定位过程：

- 移动 UA 抓取详情页得到 Vue 2 + Vant 的移动版 SPA（`chapterList`、`chapterItem`），章节节点 `<div class="chapterItem"><span>1-...</span></div>`，`id=""`、无 `href`，章节 URL 只在 Vuex/点击事件里。
- 桌面 UA 抓取同一 URL 得到桌面版结构（第 3 节），说明站点按运行环境给两套渲染。
- WebView 已设置桌面 `userAgentString`，但 Android WebView 的 Client Hints（`navigator.userAgentData.mobile`）仍为 true；实验过 UA-CH 覆盖脚本 + 主文档请求拦截注入 + `useWideViewPort`，真机仍超时，已回滚这些原生改动，避免影响其他站点。
- 因此当前规则在桌面渲染路径正确，但真机 WebView 走移动版路径时拿不到章节 `href`。

下一步可选方案：

1. 在 WebView 内执行自定义 JS，读取移动版 Vuex/组件数据里的章节列表，注入 DOM 后再解析。
2. 适配移动版 API（`copyh5` bundle 中的 `/api/v3/*` 接口），用 JSONPath 规则提取。
3. 由原生层用桌面请求头抓 HTML，再 `loadDataWithBaseURL` 渲染，绕开 Client Hints。

## 6. 规则更新机制修复

`SiteWorkspace` 之前直接用 `site.rule`（导入时的规则快照）；替换存储里的 `raw` 后，`plan` 仍是旧的（例如 `webview=0`）。现在改为用 `site.raw` 重新解析：

```ts
const rule = useMemo(() => {
  const rebuilt = importRuleText(site.raw, site.source).site;
  return rebuilt?.rule ?? site.rule;
}, [site.raw, site.rule, site.source]);
```

这样规则文件更新后，站点无需重新导入也能按新规则构建 plan。

## 7. 结论

- 列表链路可用：`jsNeededIndex` + WebView + 桌面请求头，真机已验证。
- 详情 / 章节：桌面渲染 DOM 的规则已修正并用引擎测试验证；真机 WebView 的移动版渲染路径仍未打通。
- 图库：规则已按新版结构改写，待详情章节可进入后在真机复核。
- 这是规则漂移 + WebView 环境差异，不是 App 的解析或网络缺陷；同一份请求头在本地合成站点上可正常解析。
