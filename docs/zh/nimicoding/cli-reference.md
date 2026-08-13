# Nimi Coding CLI 参考

公开集成面是 `nimicoding` CLI。机器 Consumer 必须同时处理命令退出状态与
JSON product；空结果不表示其显式声明范围之外也完整或 clean。

在仓库根目录通过 `pnpm exec nimicoding ...` 调用 workspace 精确固定的软件
包。全局 `PATH` 中的 binary 不是受支持的可用性检查。下表为简洁起见省略
此前缀。

| 用途 | 命令 |
| --- | --- |
| 编写与准入 | `authority fmt`、`authority check`、`authority compile` |
| 检查仓库使用 | `authority anchors`、`authority consumers`、`authority terms`、`authority closed-sets` |
| 定位与读取 | `authority discover`、`authority query`、`authority context` |
| 关系导航 | `authority refs`、`authority path`、`authority subgraph` |
| 分析与审查变更 | `authority diff`、`authority change-candidates`、`authority impact`、`authority audit`、`authority review` |
| 读取有界实现 context（0.6+） | `code context` |
| 查询显式代码与 authority 关联（0.6.1+） | `code authority` |
| 仓库集成 | `start`、`sync`、`doctor`、`clear` |

有界命令需要显式正数限制，例如 `--max-units`、`--max-edges` 和
`--max-bytes`。如果完整结果超出预算，命令应拒绝，而不是发布被截断且可能
影响阻断判断的结果。

`change-candidates` 只返回 caller-selected channels 的确定性召回理由，不做语义
裁决。`audit` 只报告 configured graph 与 exact lexical violations。`review`
把业务语义和 implementation conformance 固定为 `not_evaluated`。

`code context` 接受一个明确的 TypeScript 或 TSX 文件、顶层 symbol、tsconfig
和 byte budget。它返回 root-direct outbound 静态 context，不包含 inbound
impact、runtime dispatch 或完整任务 context。

`code authority` 扫描可选的保留独立物理行。TypeScript、TSX、Go 和 Rust 使用：

```text
// @nimi-authority: <exact-authority-id>
// @nimi-deprecated: <exact-authority-id>
```

Python 使用对应的 `# @nimi-authority: ...` 与 `# @nimi-deprecated: ...`。
Scanner 有意不证明语言注释语境：多行字符串中的精确保留物理行也会被识别。
不含 `@` 的旧格式不会被识别。

Authority 标记只应放在少量关键语义 owner 附近，不应覆盖机械 helper 或测试。
Deprecated 标记记录开发者已经通过直接 authority 证据或真实产品失败确认的
判断；完成 hard cut 时直接删除。标记查询不会评价未标注代码，也不证明
declaration ownership、实现一致性或 hard cut 已全部完成。

`code context` 需要 Nimi Coding 0.6.0 或更高版本；保留 marker 合同需要
0.6.1，本 workspace 精确固定 0.6.1。

`start` 只初始化文档列出的受管内容。`sync` 检查或更新这些精确内容，`doctor`
检查软件包与受管内容是否兼容。这些命令不会拦截 AI 任务、安装强制前置检查、
验证实现一致性或拥有任务状态。

Nimi 的 guarded shortcut 位于根 `package.json`。Authority authoring 要求以
`.nimi/methodology/authority-authoring.yaml` 为准，不要把命令配方复制进
另一份配置或 workflow artifact。

## 来源依据

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
