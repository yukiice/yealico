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

## 5. 真机详情页：章节接口按 Client Hints 分流

真机 WebView 已设置桌面 UA，实际停在桌面路由 `https://www.mangacopy.com/comic/{slug}`（不是 h5），页面标题也是桌面版。但章节容器是空的：

```html
<div id="default全部" role="tabpanel" class="tab-pane fade show active">
  <ul></ul>
  <ul class="page-all comic-detail-page">...分页控件...</ul>
</div>
```

用调试落盘抓到的 WebView DOM 确认：`.table-default-box .tab-pane.active ul` 内没有章节节点，等待选择器 `...ul a[href*='/chapter/']` 不可能命中。

根因在章节接口 `/comicdetail/{slug}/chapters`：

| 请求头 | 响应 |
| --- | --- |
| 桌面 UA + `Sec-CH-UA-Mobile: ?0` | 200，4898 字节完整加密章节串 |
| 桌面 UA + `Sec-CH-UA-Mobile: ?1` | 200，610 字节受限数据 |

Android WebView 的 `userAgentString` 可设为桌面，但 UA-CH 仍由设备决定（移动），接口因此返回受限数据，页面 JS 解密后没有章节。

已实现：`WebViewRendererModule.shouldInterceptRequest` 只拦截 `/comicdetail/*/chapters`，用桌面 CH 头（`Sec-CH-UA-Mobile: ?0`、`Sec-CH-UA-Platform: "macOS"`、`Sec-CH-UA`、桌面 UA、Referer、Cookie）代发请求，再把响应交给页面 JS 解密。主文档不拦截，避免影响其他站点与登录态。

另外两处配套改动：

- `webviewFetcher` 把 WebView 渲染超时下限提到 30s（桌面详情页渲染约 9s，真机更慢，15s 容易截断）。
- 渲染器超时前把 `document.documentElement.outerHTML` 写到 `files/yelico-last-render.html`（debug 构建），用于真机 DOM 排查。

## 5.1 真机安装验证受阻

vivo 的 `PackageInstallerActivity` 对外部来源 APK 强制显示“安全守护提示”，需要勾选“已了解风险”后继续安装。ADB `input tap`/`swipe` 在复选框上无效果（坐标与窗口焦点已确认正确），`pm install`、`pm install-create/commit` 也会拉起该界面。因此本轮新原生包尚未在真机完成安装验证，章节拦截逻辑目前只有本地构建产物与接口层证据。

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
- 详情 / 章节：桌面渲染 DOM 的规则已修正并用引擎测试验证；章节接口按 UA-CH 分流已定位，拦截方案已实现，待真机装包验证。
- 图库：规则已按新版结构改写，待详情章节可进入后在真机复核。
- 这是规则漂移 + WebView 环境差异，不是 App 的解析或网络缺陷；同一份请求头在本地合成站点上可正常解析。
