# Release 签名配置

当前 `android/app/build.gradle` 的 release 仍用 debug keystore 签名，只适合内部测试，不能发布到应用商店。

## 1. 生成 keystore

在仓库外或 `android/` 下执行（keystore 不要提交）：

```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore yealico-release.keystore \
  -alias yealico \
  -keyalg RSA -keysize 2048 -validity 10000
```

## 2. 配置本地属性

在 `android/gradle.properties`（不提交）加入：

```properties
YEALICO_RELEASE_STORE_FILE=../yealico-release.keystore
YEALICO_RELEASE_STORE_PASSWORD=你的 store 密码
YEALICO_RELEASE_KEY_ALIAS=yealico
YEALICO_RELEASE_KEY_PASSWORD=你的 key 密码
```

## 3. 修改 build.gradle

`android/app/build.gradle` 的 `signingConfigs` 增加：

```gradle
release {
    if (project.hasProperty('YEALICO_RELEASE_STORE_FILE')) {
        storeFile file(YEALICO_RELEASE_STORE_FILE)
        storePassword YEALICO_RELEASE_STORE_PASSWORD
        keyAlias YEALICO_RELEASE_KEY_ALIAS
        keyPassword YEALICO_RELEASE_KEY_PASSWORD
    }
}
```

`buildTypes.release` 的 `signingConfig` 改为 `signingConfigs.release`，并保留：

```gradle
minifyEnabled enableProguardInReleaseBuilds
proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
```

## 4. 构建

```bash
cd android
./gradlew assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`。

## 5. 校验

```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

确认证书指纹不是 `CN=Android Debug`。
