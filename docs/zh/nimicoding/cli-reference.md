# Nimi Coding CLI 参考

公开集成面是 `nimicoding` CLI。机器 Consumer 必须同时处理命令退出状态与
JSON product；空结果永远不隐含完整或 clean。

| 用途 | 命令 |
| --- | --- |
| 编写与准入 | `authority fmt`、`authority check`、`authority compile` |
| 定位与读取 | `authority discover`、`authority query`、`authority context` |
| 关系导航 | `authority refs`、`authority path`、`authority subgraph` |
| 变更审查 | `authority diff`、`authority impact`、`authority audit`、`authority review` |
| 仓库集成 | `start`、`sync`、`doctor`、`clear` |

有界命令需要显式正数限制，例如 `--max-units`、`--max-edges` 和
`--max-bytes`。如果完整结果超出预算，命令应拒绝，而不是发布被截断且可能
影响阻断判断的结果。

Nimi 的 guarded shortcut 位于根 `package.json`。Authority authoring 要求以
`.nimi/methodology/authority-authoring.yaml` 为准，不要把命令配方复制进
另一份配置或 evidence 文件。

## 来源依据

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
