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

## 安装与清理

只用真机验收，不用模拟器。标准流程一步完成：

```bash
npm run android:release                          # 构建 release → 安装到唯一就绪真机 → 删除 APK
npm run android:release -- --serial <序列号>     # 多台真机时指定目标
```

脚本 `scripts/android-release.mjs` 的行为：

1. 用 `adb devices` 找已授权（`device`）的真机；没有就绪设备、或有多台但未指定 `--serial` 时直接失败，不会猜设备。
2. 在 `android/` 下执行 `./gradlew assembleRelease`。
3. `adb install -r` 覆盖安装（保留站点规则与阅读进度）。
4. **安装成功后**删除 `android/app/build/outputs/apk` 下所有 `.apk`，并打印清理清单。

构建或安装失败时保留 APK，便于排查；只清理安装成功的那一次。手动补清理用 `npm run apk:clean`。保留 Gradle 增量缓存，不整目录 `clean`，避免每次全量编译。

原有手动方式（仅调试用）：

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## 已验证范围（release 真机）

- **comicbz / M-ngabz**：列表、详情、封面、阅读器图片全部正常，站点规则已切 https
- **mangacopy**：列表 10 部、详情章节（限流窗口内）；图库待复测
- **漫画柜**：规则此前在线 PASS（650 章 / 18 页 / 阅读器出图），当前网络 403，未复测

## 已知限制

- mangacopy 章节接口对 IP 频率敏感，触发后约 1 小时恢复；详情页已加 10 分钟缓存，减少重复请求
- release 构建禁止明文 HTTP，规则里的 URL 与封面需要是 https
- 章节页图片依赖移动版 JS，规则通过 `gallery.httpHeaders` 指定移动 UA
