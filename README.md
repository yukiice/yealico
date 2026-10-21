# Yealico Android（RN + 按需原生）

面向 Android 的规则驱动图片 / 漫画阅读器，目标是在声明支持的功能范围内运行用户已有的 Yealico 站点规则，而不是要求用户重写扩展。

当前处于 **P2 引擎完成、P3 站点导入/管理/列表接入中**：Android 公开站点 List/Detail、漫画柜在线 Detail/Gallery、WebView、站点导入 UI、本地持久化和站点页面/列表已跑通；详情/阅读器 UI、登录/Cookie 仍未完成，不承诺全部规则兼容。

站点导入领域层（JSON/URL/QR raw JSON、去重、删除）已完成；相机扫码和 Yealico QR v2 解码是**必须但延后**的功能，当前不能用阿巴基猫二维码直接添加站点。

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

- 运行 5 组合成 fixture（列表、图库、JSON、不支持能力、QR 载荷）+ pages/totalImages，显示 13 项 PASS/FAIL。
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
- [QR 导入格式](docs/rules/qr-import.md)
- [macOS 容器规则提取](docs/rules/yealico-macos-sqlite.md)
- [Yealico 导出 JSON 格式](docs/rules/yealico-export-format.md)
- [用 Yealico 客户端取规则明文](docs/rules/yealico-rule-extraction.md)
- [兼容矩阵](docs/rules/compat-matrix.md)
- [P1 基线与验证记录](docs/architecture/p1-baseline.md)
- [P2 Detail/Gallery 链路](docs/architecture/p2-detail-gallery.md)

## 已知限制

- UI：站点导入/列表/删除、页面选择和列表页已实现；详情、阅读器、翻页尚未实现。
- WebView 已能渲染并取 DOM，但还没有产品化阅读器/导航；登录、consent、Cookie 共享、图片请求头尚未实现。
- Android 验证了阿巴基猫公开 List/Detail、漫画柜在线 Detail/首图；分页/阅读器未接，禁漫等真实 Detail/Gallery 未在 Android 执行。
- QR 导入：JSON/URL/QR raw JSON 已有导入领域层；Yealico `v2:` 仍只识别、未解码，相机扫码 UI 未实现。二维码是必须功能，验收见 [P3 站点导入](docs/architecture/p3-site-import.md)。
- `+` 多 JSONPath、`$root` 完整语法、数学表达式 replacement、GBK/Big5 尚未实现或验证。
- 真实规则来自作者 `wc3818290`，只在私有仓库/本地测试使用；不要公开再分发。
- 不实现访问控制绕过；规则与远程页面按不可信输入处理。

## 许可证

MIT，见 [LICENSE](LICENSE)。
