# QR 导入格式与兼容性（P0 补充）

- 记录日期：2026-10-20
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

在这三种情况中，只有第 1 种能在不依赖 Yealico 服务的前提下离线兼容；第 2 种需要官方 API；第 3 种需要格式文档或规则明文对照。**没有证据前不猜密钥，也不把“扫码成功”当作“导入成功”。**

## 3. 兼容选项

| 方案 | 可行性 | 代价 | 结论 |
| --- | --- | --- | --- |
| A. 官方/作者提供解码算法或密钥 | 最干净 | 需要授权与格式说明 | 首选，拿到后补 fixture |
| B. 规则作者同时提供规则 JSON | 可立即做 | 依赖分享者习惯 | 作为首版回退 |
| C. 支持 URL / 原始 JSON / 自有 scheme 的二维码 | 可立即做 | 不是 Yealico v2 兼容 | 先做解析层 |
| D. Yealico 客户端 Edit 界面取证 | 可行 | 需要用户截图/复制字段 | iOS-only 可用，见 [yealico-rule-extraction.md](yealico-rule-extraction.md) |
| E. macOS Yealico 容器 SQLite | 可行 | 需要 macOS 版 App | **开发/取证首选**，规则明文已落盘，见 [yealico-macos-sqlite.md](yealico-macos-sqlite.md) |
| F. 逆向 Yealico 客户端提取密钥 | 不确定且合规风险高 | 需要明确授权 | 默认不做 |
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
- Android 自检页 10/10，含 3 条 QR 检查（v2 识别、64 bytes、要求规则 JSON/URL）；**只验证载荷识别，不是相机扫码**。
- 明文取证路径：见 [yealico-rule-extraction.md](yealico-rule-extraction.md)，用 Yealico 站点菜单 → Edit 逐页截图/复制。

尚未实现：

- 相机扫码 UI（需要原生相机/条码模块，属于 P2/P3）。
- 从相册导入二维码图片。
- Yealico v2 的实际解密。
- 扫码后的规则下载、校验、站点落库。

## 5. 对计划的调整

- **P0**：新增“QR 样本与载荷格式”清点项；每个 QR 记录前缀、版本、载荷长度、可解性、来源。
- **P2**：导入层先支持 URL / 原始 JSON / 自有 scheme；Yealico v2 若仍无解码依据，必须报 `UNSUPPORTED_QR_PAYLOAD` 并提供粘贴/URL 回退。
- **P3**：扫码 → 识别 → 导入/明确错误的完整流程；相机模块在格式门槛通过后再引入。
- 兼容矩阵新增 QR 行，状态不能因“能识别前缀”而写成“已支持”。

## 6. 需要补充的输入

1. **优先用 macOS 容器 SQLite 取规则**：`ComiGa.sqlite` 的 `ZSITE`/`ZSITELISTRULE` 等表存明文 JSON；见 [yealico-macos-sqlite.md](yealico-macos-sqlite.md)。
2. **iOS-only 用 Edit 取明文**：扫码后站点菜单 → Edit，按标签页截图/复制字段；步骤见 [yealico-rule-extraction.md](yealico-rule-extraction.md)。
3. **这个二维码对应的规则 JSON**（脱敏即可）。有明文才能判断 v2 是否为可离线解码的加密包。
4. **飞行模式测试**：在 Yealico 中开飞行模式扫描同一二维码，是否仍能添加站点？
   - 仍可添加 → 更可能是本地解密，值得继续找算法；
   - 不可添加 → 更可能是服务端 token，离线兼容不成立。
5. **2～3 组 QR + 规则 JSON 对照**，最好包含一个结构简单的静态站点。
6. 若考虑逆向客户端，需要明确授权与合规边界；默认不做。

作者博客已核查：325 篇公开文章只有二维码，没有 JSON/URL；因此需要作者直接提供规则明文、导出方式或格式说明，或由用户在 Yealico 内找到导出入口。

## 7. 验收标准（QR）

- 扫码/粘贴后，能区分：可导入的 URL/JSON、Yealico v2 不透明载荷、非法载荷。
- 每种失败都有稳定错误码和用户可执行的下一步（粘贴 JSON / 打开规则 URL）。
- 不出现“扫到了但页面空白”“导入成功但站点列表为空”这类假成功。
- 真实 Yealico QR 的兼容结论必须绑定规则 JSON 或原版 App 行为证据。
