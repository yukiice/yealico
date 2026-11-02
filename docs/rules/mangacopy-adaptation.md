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

## 3. 详情页仍不兼容

规则等待 `ul.table-all a`，新版页面不存在该结构，WebView 报：

```text
NETWORK_ERROR: WebView render timed out after 15000ms
```

章节列表可能由异步 API 渲染。需要重新提取 `detailRule`（或改为 API 规则）；图库规则同样要按新版结构复核。

## 4. 结论

- 列表链路已可用：`jsNeededIndex` + WebView + 桌面请求头。
- 详情 / 章节 / 图库需要新版规则，当前规则只覆盖旧版结构。
- 这是规则漂移，不是 App 的解析或网络缺陷；同一份请求头在本地合成站点上可正常解析。
