# 合成样本：JSONPath

- 性质：**合成 fixture**，不代表真实站点。
- 覆盖：JSON 响应解析、JSONPath `$.data.titles[*]`、`item` 选出字符串节点、`this` + `text`。
- 输入：`response.json` + `rule.json`。
- 基准：`expected.json`。
- 约束：
  - 结果顺序必须与数组顺序一致。
  - 本 fixture **不测试** `$root`、`+` 多 JSONPath、JSON 对象上的 `attr`；这些语义见 `open-questions.md` Q7/Q12，需先确认。
