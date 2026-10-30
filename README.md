# Yealico Android（RN + 按需原生）

面向 Android 的规则驱动图片 / 漫画阅读器，目标是在声明支持的功能范围内运行用户已有的 Yealico 站点规则，而不是要求用户重写扩展。

当前处于 **P2 引擎完成、P3 站点导入/管理/列表/详情/阅读已跑通**：Android 公开站点 List/Detail、漫画柜在线 Detail/Gallery、WebView、站点导入 UI、本地持久化、页面/列表、详情展示、连续滚动阅读器、章节连读和阅读进度恢复已跑通；登录/Cookie 尚未完成，不承诺全部规则兼容。

站点导入（JSON/URL、去重、删除）已完成；二维码导入已移除——Yealico `v2:` 是 CloudKit 引用，密钥不在客户端，无法离线解码。规则明文需从客户端 Edit 或 macOS 容器 SQLite 取得，见 [QR 研究结论](docs/rules/qr-import.md)。

## 技术基线

- React Native 0.83.10 + TypeScript
- Hermes / Android，minSdk 24，compileSdk 36
- 规则解析：htmlparser2 9 + css-select 5 + domutils 3（CJS）
- 受限 JSONPath（自实现，支持路径/索引/通配，不支持过滤与递归下降）
- 自实现 URL 解析与相对路径归一化（不依赖 RN 的 `URL` polyfill）

## 环境要求

- Node.js >= 20.19（当前验证：24.20）
- JDK 17
- Android SDK 36、build-tools 36、NDK 27.1
- 已启动的模拟器或真机

`android/local.properties` 需指向本机 SDK，例如：

```properties
sdk.dir=/Users/<you>/Library/Android/sdk
```

## 常用命令

```bash
npm install
npm run fixtures   # docs/rules/samples -> src/engine/fixtures.generated.ts
npm run rules:sync # artifacts/yealico-rules/site-3 -> Android 网络探针规则
npm run lint
npm run typecheck
npm test -- --runInBand
npm start          # Metro
npm run android    # 构建并安装 debug 包
```

首次 Gradle 构建可显式指定 JDK：

```bash
cd android
JAVA_HOME=/path/to/jdk-17 ./gradlew assembleDebug --no-daemon
```

## 当前自检页

`App.tsx` 是开发自检页，不是产品 UI：

- 运行 4 组合成 fixture（列表、图库、JSON、不支持能力）+ pages/totalImages，显示 10 项 PASS/FAIL。
- 手动“真实规则网络探针”：用阿巴基猫公开规则走 `loadListPages` → 第一条 `loadDetail`，只访问公开博客。
- 手动“WebView 规则探针”：本地 JS 页面等待 `.chapter-list`，再用漫画柜形态的 `chapterRule` 解析。
- 手动“漫画柜在线探针”：详情页章节列表 + 第一页图库；当前站点图库 selector 已改版，探针使用兼容 selector。
- 显示 20 次重复的解析耗时基线。
- 明确标注“合成 fixture，仅验证规则引擎；网络探针不代表全部真实站点兼容”。

开发循环提示：改动 `src/engine` 后，Metro 对新增文件的监听可能滞后；请重启 Metro（`--reset-cache`），必要时执行 `adb shell pm clear com.yealico` 清除旧 bundle。

## 目录

```
android/                 Android 工程（仅 Android；未生成 ios/）
src/engine/              规则模型、RoutePlan、占位符、选择器、执行器、URL
src/platform/            RN fetch 适配器、原生 WebView renderer、探针
docs/reference/          官方规则语义提炼
docs/rules/samples/      合成 fixture（唯一来源）
docs/rules/open-questions.md  语义待确认项
docs/rules/compat-matrix.md   兼容矩阵
docs/architecture/       阶段基线与运行时记录
```

## 文档

- [开发计划](docs/DEVELOPMENT_PLAN.md)
- [计划评审](docs/DEVELOPMENT_PLAN_REVIEW.md)
- [规则语义基线](docs/reference/yealico-rule-model.md)
- [待确认项](docs/rules/open-questions.md)
- [QR 研究结论（扫码链路已移除）](docs/rules/qr-import.md)
- [macOS 容器规则提取](docs/rules/yealico-macos-sqlite.md)
- [Yealico 导出 JSON 格式](docs/rules/yealico-export-format.md)
- [用 Yealico 客户端取规则明文](docs/rules/yealico-rule-extraction.md)
- [兼容矩阵](docs/rules/compat-matrix.md)
- [P1 基线与验证记录](docs/architecture/p1-baseline.md)
- [P2 Detail/Gallery 链路](docs/architecture/p2-detail-gallery.md)
- [P3 章节图库阅读器](docs/architecture/p3-reader.md)
- [P3 调试页](docs/architecture/p3-debug.md)
- [P3 Android 验收记录](docs/architecture/p3-android-verification.md)

## 已知限制

- UI：站点导入/列表/删除、页面选择、列表、详情展示、连续滚动与双页阅读（含右到左）、章节连读、阅读进度和调试页已实现。
- WebView 已能渲染并取 DOM，阅读器已接入单章节画廊；登录、consent、Cookie 共享尚未实现，图片请求只补了规则头与默认 Referer。
- Android 验证了阿巴基猫公开 List/Detail、漫画柜 WebView 列表/详情/章节；导入→列表→详情→章节→连续滚动→章节连读→进度落盘→冷重启恢复→调试页已在模拟器跑通，详见验收记录。
- 二维码导入已移除（2026-10-22）：Yealico `v2:` 是 CloudKit 引用，离线不可解码；相机扫码、QR 解析层与原生依赖均已删除，导入只保留粘贴 JSON 与规则 URL。研究结论与取明文路径见 [QR 研究结论](docs/rules/qr-import.md)。
- `+` 多 JSONPath、`$root` 完整语法、数学表达式 replacement、GBK/Big5 尚未实现或验证。
- 真实规则来自作者 `wc3818290`，只在私有仓库/本地测试使用；不要公开再分发。
- 不实现访问控制绕过；规则与远程页面按不可信输入处理。

## 许可证

MIT，见 [LICENSE](LICENSE)。
