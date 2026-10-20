# Yealico Android（RN + 按需原生）

面向 Android 的规则驱动图片 / 漫画阅读器，目标是在声明支持的功能范围内运行用户已有的 Yealico 站点规则，而不是要求用户重写扩展。

当前处于 **P1 完成、P2 Detail/Gallery + 分页编排进行中**。已完成合成 fixture 在 Node 与 Android 模拟器上的一致结果，并已从 macOS Yealico 容器提取 6 条真实规则（含禁漫 2.26、阿巴基猫 2.4）；真实在线验收、pages/二级页和 UI 仍待完成，不承诺全部规则兼容。

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

`App.tsx` 是 P1 自检页，不是产品 UI：

- 运行 5 组合成 fixture（列表、图库、JSON、不支持能力、QR 载荷），显示 10 项 PASS/FAIL。
- 显示 20 次重复的解析耗时基线。
- 明确标注“合成 fixture，仅验证规则引擎；不代表真实站点兼容”。

开发循环提示：改动 `src/engine` 后，Metro 对新增文件的监听可能滞后；请重启 Metro（`--reset-cache`），必要时执行 `adb shell pm clear com.yealico` 清除旧 bundle。

## 目录

```
android/                 Android 工程（仅 Android；未生成 ios/）
src/engine/              规则模型、RoutePlan、占位符、选择器、执行器、URL
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

- 仅静态 ListRule / GalleryRule；详情章节、分页循环、WebView、登录、Cookie、图片加载尚未实现。
- QR 导入：已识别 Yealico `v2:` 前缀与 64 字节 opaque 载荷，但未解码；当前只支持 URL / 原始 JSON 的解析层，相机扫码 UI 未实现。详见 [QR 导入格式](docs/rules/qr-import.md)。
- `+` 多 JSONPath、`$root` 完整语法、数学表达式 replacement、GBK/Big5 尚未实现或验证。
- 没有真实 Yealico 规则样本，真实兼容性全部为 `待验证`。
- 不实现访问控制绕过；规则与远程页面按不可信输入处理。

## 许可证

MIT，见 [LICENSE](LICENSE)。
