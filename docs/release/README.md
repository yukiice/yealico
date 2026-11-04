# Android 构建与交付

## 产物

- release APK：`android/app/build/outputs/apk/release/app-release.apk`
- debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`（需 Metro 或已打包 bundle）
- 最低系统：Android 7.0（minSdk 24），当前测试机 Android 15 / SDK 35

## 构建

```bash
cd android
./gradlew assembleRelease   # 含 Hermes bundle，不依赖 Metro
```

签名目前是 debug keystore（内部测试包），正式发布见 [signing.md](signing.md)。

## 安装

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

覆盖安装会保留站点规则与阅读进度。

## 已验证范围（release 真机）

- **comicbz / M-ngabz**：列表、详情、封面、阅读器图片全部正常，站点规则已切 https
- **mangacopy**：列表 10 部、详情章节（限流窗口内）；图库待复测
- **漫画柜**：规则此前在线 PASS（650 章 / 18 页 / 阅读器出图），当前网络 403，未复测

## 已知限制

- mangacopy 章节接口对 IP 频率敏感，触发后约 1 小时恢复；详情页已加 10 分钟缓存，减少重复请求
- release 构建禁止明文 HTTP，规则里的 URL 与封面需要是 https
- 章节页图片依赖移动版 JS，规则通过 `gallery.httpHeaders` 指定移动 UA
