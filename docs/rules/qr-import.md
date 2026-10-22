# QR 导入格式与兼容性（P0 补充）

- 记录日期：2026-10-20
- 功能状态：**导入领域层、相机扫码、站点持久化已完成；Yealico v2 解码未完成**（2026-10-22 更新）。
- 样本：用户提供的 `6DA1253174569835C4C45D113675AEA3.jpg`
- 画面上标注：`禁漫天堂` / `jm18c-dfg.cc` / `2.26@wc3818290`
- 关联：[规则语义基线](../reference/yealico-rule-model.md)、[待确认项](open-questions.md)、[兼容矩阵](compat-matrix.md)

## 1. 解码结果

用外部工具（`sips` 转 PNG + `jsQR`）解码样本二维码，得到：

```
Yealico QR Code: v2:ImJpWmDcnxYVUFVnmJTeQGK+gxDqQ54aXbjfZZYW95uwfyG8ZZieqthW0YRHnOrYWtbM6vtu+l/vxEh4XrmCdg==
```

结构：

| 部分 | 值 |
| --- | --- |
| 固定前缀 | `Yealico QR Code:` |
| 版本 | `v2` |
| 载荷编码 | Base64 |
| Base64 解码后长度 | 64 bytes |
| 前 16 字节（hex） | `2262695a60dc9f16155055679894de40` |

注意：`jsQR` 只用于一次性取证，不是应用运行时依赖。

### 1.1 作者来源核查（2026-10-20）

- 作者主页：`https://wc3818290.home.blog/`，确认是 Yealico 规则分享博客。
- 禁漫天堂文章：`https://wc3818290.home.blog/2023/10/26/yealico%e7%ab%99%e7%82%b9%e8%a7%84%e5%88%99%ef%bc%9a%e7%a6%81%e6%bc%ab%e5%a4%a9%e5%a0%82/`。
- 文章内有两张二维码原图：主站 `img_e5c32a107f18-1.jpg`、大陆版 `img_7a990a8631e5-1.jpg`；**大陆版与用户提供的样本完全一致**。
- 主站载荷：`Yealico QR Code: v2:ImJpWmDcnxYVUFVnmJTeQJD6x0fbWBTXHgnHmaPH8p4W9et2fH04qTzTg9Q5ZHZ2VETeIcoDOne9VLYnWfDGCQ==`（64 bytes）。
- 两组载荷前 16 字节完全相同：`2262695a60dc9f16155055679894de40`；后 48 字节不同。
- 扫描作者 325 篇公开文章：0 个 `.json` / GitHub / Gist 链接，0 个 `indexRule` / `listRule` 代码块；作者只发布二维码图片。
- 结论：无法从作者博客取得规则 JSON 或 URL，也没有公开的生成/解密说明。

### 1.2 2026-10-22 复核

- 用 macOS Vision（`VNDetectBarcodesRequest`）重新解码用户提供的同一张大陆版图片，payload 与 §1 完全一致，确认样本未变。
- 真机（release 包）点击“扫码导入”能拉起 Google Code Scanner、识别该二维码并回传 64 字节载荷，随后按预期报 `UNSUPPORTED_QR_PAYLOAD`：**扫码链路可用，限制在 v2 格式本身**。
- 对照数据：两样本均 64 字节，前 16 字节相同；XOR 后仅前 16 字节为 0，其余 48 字节高熵。
- 该站点规则 JSON 约 22 KB，不可能装进 64 字节，进一步支持“载荷是引用/token，不是规则包”的判断。

## 2. 载荷不是可直接读取的规则

已尝试并排除：

- JSON 直接解析：失败（含非 UTF-8 字节）。
- zlib / gzip / bz2 / lzma / Brotli / zstd：全部失败。
- LZString：`decompressFromBase64` 等返回乱码，不是规则文本。
- 常见派生密钥的 AES-GCM / AES-CBC / AES-ECB / ChaCha20-Poly1305：没有解出 JSON、URL 或 `Yealico` 明文。
- 简单重复 XOR：只得到不可读字节，不是有效明文。
- 主站/大陆版双载荷的 16 字节公共前缀：尝试 57,570 组“作者/规则版本/域名/App 名”组合密钥，覆盖 AES-CBC/GCM/CTR/ECB 与 PBKDF2 派生，仍未得到有效明文。

因此当前结论是：**v2 载荷是 Yealico 私有的不透明数据**，可能是：

1. 客户端本地可解的加密载荷（密钥在 Yealico 客户端内）；
2. 服务端 token（App 扫描后向服务端换取规则）；
3. 带签名/版本信息的私有二进制包。

### 1.3 2026-10-22 定论：载荷是 CloudKit 引用，密钥不在客户端

上面三种可能已经收敛为第 2 种。完整机制：

```text
v2 二维码（64 字节）
  ↓ 本地 AES 解密（密钥不在客户端，见下）
{"recordName": "Site.<UUID>"}      ← 59 字节，PKCS7 后正好 64 字节
  ↓ 联网“激活” + CloudKit 查询
规则数据
  ↓
SQLite（明文落库）
```

证据：

- 二进制里 `{"recordName": "` 紧邻 `Yealico QR Code: ` 与 `Yealico Site Rule`；
- 明文长度完全吻合：`{"recordName": "`(16) + `Site.`+UUID(41) + `"}`(2) = 59 字节，PKCS7 后 64 字节 = 密文长度；
- 两个样本前 16 字节相同，因为明文首块都是 `{"recordName": "`；
- SQLite `ZSITE.ZRECORDNAME` 存的是 `Site.<UUID>`，与推定的明文格式一致；
- `recordID` 是 NSKeyedArchiver 的 `CKRecordID`，含 `zoneName=Site-Zone`、`ownerName=__defaultOwner__`；
- entitlements：`iCloud.work.cmbook.ComiGa`、CloudKit、Production；
- 错误文案：`To activate this QR Code, please ensure that the network is available.`（错误码 -1/-2/-3）。

**这解释了飞行模式现象**：v2 二维码需要联网激活，不是纯离线格式。

**密钥搜索记录（全部为 0 命中）**：

| 尝试 | 规模 | 结果 |
| --- | --- | --- |
| 字符串候选（长度 16/24/32） | 1,354 个 | 无 |
| 二进制全部 16 字节窗口（AES-128-ECB） | 7,028,129 个 | 无 |
| 二进制全部 32 字节窗口（AES-256-ECB） | 7,028,113 个 | 无 |
| hex/base64 解码候选（376 个文件） | 772 个 | 无 |
| 明文首块变体（带/不带空格、含 `Site.`） | 4 种 | 无 |

因为 ECB 首块与“CBC + IV=0”的首块等价，上表也覆盖了 IV 为零的 CBC 情况。
**结论：对称密钥不在客户端二进制或资源中，v2 解码必须服务端参与。**

CloudKit 访问特性（实测）：

- `records/lookup`（按 recordName 精确查询）→ **200，无需任何凭证**；
- `records/query`（枚举）→ **401 AUTHENTICATION_FAILED**。

即：只有拿到二维码（内含 recordName）的人能查到那一条规则，无法批量抓取——这正是“分享”的语义。
但本地 `ZRECORDNAME` 是用户私有库副本，在 public 库中是 `NOT_FOUND`，所以光有本地记录名无法反查。

### 1.4 2026-10-22 抓包验证

用 Clash 控制接口（`/tmp/verge/verge-mihomo.sock`）监控真实扫码时的网络行为。

方法：每 0.5 秒轮询 `/connections`，记录每个活动连接的目标域名 + 时间戳；同时用 `lsof` 记录 ComiGa 的 socket 活动。

**扫码窗口内新出现的域名只有两个**：

```text
14:46:15  gateway.icloud.com       ← CloudKit 网关
14:46:30  125.88.187.168           ← 站点 CDN
```

其余均为持续存在的长连接（网易系 App、百度等）与系统 iCloud 同步（`mask.icloud.com`、`setup.icloud.com`、`metrics.icloud.com`、`time.apple.com`）。

**关键结论**：

- **没有任何 Yealico 自建服务器参与** —— 扫码流程只与 Apple 的 CloudKit 通信；
- 因此解密**不依赖**第三方服务端，理论上应在本地完成；
- 但本地密钥搜索全部失败（§1.3），形成无法解释的矛盾。

**额外排除**：

- 载荷的 base64 / hex / base64url / 前 16 字节 hex / `Site.`+hex 五种编码直接作为 recordName 查询 CloudKit，均为 `NOT_FOUND`——载荷不是直接可用的记录名。
- 容器内其他位置也查过：`work.cmbook.ComiGa.plist`（含 `userRole` 字段，测试后非密钥）、`CloudKit/cloudd_db/db`（仅 CloudKit 内部表，无规则数据）。
- App 容器共 305 个文件，已扫描 376 个文件（含框架/资源），均未找到可用密钥。

在这三种情况中，只有第 1 种能在不依赖 Yealico 服务的前提下离线兼容；第 2 种需要官方 API；第 3 种需要格式文档或规则明文对照。**没有证据前不猜密钥，也不把“扫码成功”当作“导入成功”。**

## 3. 兼容选项

| 方案 | 可行性 | 代价 | 结论 |
| --- | --- | --- | --- |
| A. 官方/作者提供解码算法或密钥 | 最干净 | 需要授权与格式说明 | 首选，拿到后补 fixture |
| B. 规则作者同时提供规则 JSON | 可立即做 | 依赖分享者习惯 | 作为首版回退 |
| C. 支持 URL / 原始 JSON / 自有 scheme 的二维码 | 可立即做 | 不是 Yealico v2 兼容 | 先做解析层 |
| D. Yealico 客户端 Edit 界面取证 | 可行 | 需要用户截图/复制字段 | iOS-only 可用，见 [yealico-rule-extraction.md](yealico-rule-extraction.md) |
| E. macOS Yealico 容器 SQLite | 可行 | 需要 macOS 版 App | **开发/取证首选**，规则明文已落盘，见 [yealico-macos-sqlite.md](yealico-macos-sqlite.md) |
| F. 逆向 Yealico 客户端提取密钥 | **已尝试，不可行** | 全量搜索 1,400 万+ 候选均为 0 命中 | 密钥不在客户端，见 §1.3 |
| G. 伪造“已兼容” | 不可接受 | 用户会拿到空结果 | 禁止 |

## 4. 当前实现

`src/engine/qr.ts` 提供纯函数 `parseQrPayload`：

- 识别 `Yealico QR Code: vN:<base64>`。
- v2 返回 `kind: 'yealico-v2'`、版本、字节数，并产生 `UNSUPPORTED_QR_PAYLOAD`；**不尝试解密**。
- 支持：
  - 原始规则 JSON（对象）；
  - `http(s)://` 规则 URL；
  - `yealico://import?url=...` / `?rule=...`。
- 未知/非法载荷统一返回 `UNSUPPORTED_QR_PAYLOAD`，不静默空结果。
- 测试：`__tests__/qr.test.ts`，覆盖 v2 opaque、双载荷 16 字节前缀/48 字节差异、URL、JSON、自定义 scheme、非法 base64。
- 导入领域层：`src/app/ruleImport.ts` 已把原始 JSON/URL/QR raw JSON 接到 `SiteRepository`；`v2:` 仍明确报 `UNSUPPORTED_QR_PAYLOAD`。
- Android 自检页 10/10，含 3 条 QR 检查（v2 识别、64 bytes、要求规则 JSON/URL）；**只验证载荷识别，不是相机扫码**。
- 明文取证路径：见 [yealico-rule-extraction.md](yealico-rule-extraction.md)，用 Yealico 站点菜单 → Edit 逐页截图/复制。

已实现（2026-10-22）：

- 相机扫码 UI：原生 `QrScanner` 模块调用 Google Code Scanner（系统扫码界面，不申请 CAMERA 权限）；无 GMS/Play Store 设备的回退提示见 [p3-site-import.md](../architecture/p3-site-import.md#7-扫码实现与限制)。

尚未实现：

- 从相册导入二维码图片。
- Yealico v2 的实际解密。
- 扫码后的规则下载、校验、站点落库（v2 载荷是引用，不是规则本体）。

## 5. 对计划的调整

- **P0**：新增“QR 样本与载荷格式”清点项；每个 QR 记录前缀、版本、载荷长度、可解性、来源。
- **P2**：导入层先支持 URL / 原始 JSON / 自有 scheme（领域层已完成）；Yealico v2 若仍无解码依据，必须报 `UNSUPPORTED_QR_PAYLOAD` 并提供粘贴/URL 回退。
- **P3**：扫码 → 识别 → 导入/明确错误的完整流程；相机模块在格式门槛通过后再引入。**QR 是必须功能，不是可选项。**
- 兼容矩阵新增 QR 行，状态不能因“能识别前缀”而写成“已支持”。

## 6. 需要补充的输入

1. **优先用 macOS 容器 SQLite 取规则**：`ComiGa.sqlite` 的 `ZSITE`/`ZSITELISTRULE` 等表存明文 JSON；见 [yealico-macos-sqlite.md](yealico-macos-sqlite.md)。
2. **iOS-only 用 Edit 取明文**：扫码后站点菜单 → Edit，按标签页截图/复制字段；步骤见 [yealico-rule-extraction.md](yealico-rule-extraction.md)。
3. **这个二维码对应的规则 JSON**（脱敏即可）。有明文才能判断 v2 是否为可离线解码的加密包。
4. ~~**飞行模式测试**：在 Yealico 中开飞行模式扫描同一二维码，是否仍能添加站点？~~
   **已完成（2026-10-22）**：飞行模式下扫码报“网络错误”，与二进制里的 `To activate this QR Code, please ensure that the network is available.` 完全对应。
   结合 §1.3 的密钥搜索（全量 0 命中），结论是 **v2 解码需要服务端参与，离线兼容不成立**。
5. **2～3 组 QR + 规则 JSON 对照**，最好包含一个结构简单的静态站点。
6. 若考虑逆向客户端，需要明确授权与合规边界；默认不做。

作者博客已核查：325 篇公开文章只有二维码，没有 JSON/URL；因此需要作者直接提供规则明文、导出方式或格式说明，或由用户在 Yealico 内找到导出入口。

## 7. 验收标准（QR）

- 扫码/粘贴后，能区分：可导入的 URL/JSON、Yealico v2 不透明载荷、非法载荷。
- 每种失败都有稳定错误码和用户可执行的下一步（粘贴 JSON / 打开规则 URL）。
- 不出现“扫到了但页面空白”“导入成功但站点列表为空”这类假成功。
- 真实 Yealico QR 的兼容结论必须绑定规则 JSON 或原版 App 行为证据。
