# P3：Android 验收记录

- 记录日期：2026-10-21
- 设备：`emulator-5554`（AVD `RN_Test`），Android SDK 36，1080×2400
- 方式：Metro dev server + `react-native run-android`，用 `adb shell input tap` / `uiautomator dump` 逐步驱动，按屏幕文本断言
- 状态：**导入 → 列表 → 详情 → 章节 → 阅读器 → 调试页全链路跑通；阅读器图片加载因规则选择器漂移未成功；阅读进度未能在真机复现**

## 1. 通过的项

| 步骤 | 证据 |
|---|---|
| URL 导入 | 导入 `http://10.0.2.2:8000/aba.json`，UI 显示「已导入 阿巴基猫 あばき猫 (wc3818290.home.blog)」 |
| 站点持久化 | `am force-stop` 后重启，两个站点仍在列表里（重复两次） |
| 列表加载 | 阿巴基猫「最近更新」：调试页记录 `items=70 pages=1` |
| 详情 | `chapters=0 pictures=4 urls=1`，页面渲染标题、简介、图片区 |
| 漫画柜 WebView 列表 | 列表渲染出「2099 Alpha / 漫威僵尸-战区」等条目 |
| 详情章节 | `章节 (1)` + 「第01卷 · 阅读 · 916672」可点 |
| 阅读器打开 | 进入 `第01卷`，显示 `暂无图片 · 已载 0 页` + 「重新加载」 |
| 调试页 | 规则来源/哈希/原文长度、能力串、阻断项、阶段记录按新到旧排列 |
| 脱敏 | 阅读器报错里的 `&amp;m=somwbCWkrsmGioLKBdzZAw` 显示为 `&amp;m=***` |

## 2. 真机才暴露的两个问题

### 2.1 error 横幅吞掉了已解析的列表（已修）

阿巴基猫声明了 `searchUrl`，`buildRoutePlan` 因此产生：

```text
ERROR UNSUPPORTED_FEATURE @ searchUrl — search is not implemented in v1
```

`SiteWorkspace` 原来把「有没有 error 级诊断」当成「能不能展示内容」，于是：

- 调试页显示 `items=70`，说明 70 条已经解析出来；
- 界面却只有一行错误，列表完全不渲染。

引擎里真正阻断执行的只有 `NEEDS_WEBVIEW / NEEDS_LOGIN / NEEDS_CONSENT`（`blockingDiagnostics`），`UNSUPPORTED_FEATURE` 只是提示。修复方式是把判断改成“有内容就展示内容、诊断只做横幅”，落在 `src/app/presentation.ts` 的 `contentState`，`SiteWorkspace` / `DetailScreen` 共用。

### 2.2 阅读器报错把图床签名直接上屏（已修）

漫画柜章节页 WebView 超时后，诊断详情里带了真实图片地址：

```text
https://eu1.hamreus.com/.../2099_ALPHA_0.jpg.webp?e=1793771509&m=somwbCWkrsmGioLKBdzZAw
```

原来只有调试页调用脱敏，`errorText`（列表/详情/阅读器的横幅）是原样拼接。修复：

- `errorText` 统一过 `sanitizeText`；
- `sanitizeText` 兼容真实诊断的两种脏形态：HTML 转义的 `&amp;` 分隔符、`|` 拼接的候选值；
- 增加“值形态”识别：长度 ≥ 20 且大小写混合的参数值按签名处理（`m=...` 这种名字看不出问题的参数也能遮住）。

## 3. 仍存在的问题

- **漫画柜章节图片没取到**：`wait=#manga>img` 在 15s 内未命中，错误文本里已经能看到 `imgs=2`，说明页面里确实有图，但选择器与现行页面结构不符（兼容矩阵里已记录「当前图片 selector 已改版」）。这是规则兼容问题，不是阅读器逻辑问题。
- **阅读进度没能在真机验证**：进度只在图片加载成功后写入，上面这条导致没有写入时机。Jest 覆盖仍然有效，但「杀进程后恢复到第 N 张」缺真机证据。
- **`|||` 拼接、无 `=` 的 token 未脱敏**：例如 `...webp|||sGIEwtLn`。这类值没有参数名可依据，按值形态判断又会误伤 `mangaFile` 这类字段名，暂不处理。

## 4. 开发环境注意

- 本机没有 Watchman，Metro 的文件监听会漏掉工具写入的改动：**改完源码要重启 Metro**，否则模拟器拿到的是旧 bundle（本次排查中先看到的是提交前的 bundle，`grep contentState` 为 0）。
- 真机验证脚本化的前提是坐标稳定；页面文案一变，`adb shell input tap` 的坐标就要重新从 `uiautomator dump` 里取。
