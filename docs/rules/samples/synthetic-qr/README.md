# 合成样本：Yealico QR v2

- 性质：用户提供的真实二维码载荷，仅用于识别与失败路径测试。
- 内容：`Yealico QR Code: v2:<base64>`；base64 解码为 64 bytes 不透明数据。
- 用途：
  - 验证前缀/版本/base64 识别；
  - 验证 `UNSUPPORTED_QR_PAYLOAD`，防止把“扫到了”误判成“可导入”；
  - 不包含规则 JSON，不测试解密。
- 详细分析：[qr-import.md](../../qr-import.md)
