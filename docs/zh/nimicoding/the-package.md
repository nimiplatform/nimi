# 软件包

`@nimiplatform/nimi-coding` 是独立软件包。它把 Nimi Coding 方法论与契约投影到
宿主仓库，并提供确定性 CLI 检查。

## Nimi 准入表面

在 Nimi 仓库中，这个包被准入用于：

- 软件包管理的 `.nimi/config/**`、`.nimi/contracts/**` 与 `.nimi/methodology/**` 治理文件；
- 经过宿主边界保护的一致性检查与 doctor；
- canonical spec 构建契约和生成审计验证；
- taxonomy、placement、table family、projection edge 与 tracked output 校验；
- 确定性的规范治理和 AI 治理门禁。

项目持有 `.nimi/spec/**`。`.nimi/local/**` 下的本地证据用于复核，不能自行提升为
语义真相。

## 执行上限

软件包不持有 Nimi 的任务计划、进度、委派、重试、等待、恢复或完成状态。它不启动
嵌套宿主，也不选择宿主下一步。Codex App 或其他已准入外部宿主端到端持有这些能力。

## 软件包与项目所有权

| 表面 | Owner |
| --- | --- |
| 软件包源码与发布 | `@nimiplatform/nimi-coding` 仓库 |
| Package-canonical 文件 | Nimi Coding 软件包 |
| 已声明的宿主专用内容 | Nimi host，受软件包同步规则约束 |
| 产品权威 | Nimi `.nimi/spec/**` |
| 项目检查 | Nimi scripts 与已准入 package validators |
| 任务执行 | 当前外部宿主 |
| 本地证据 | 项目本地，非语义真相 |

## 来源依据

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/contracts/surface-taxonomy.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/surface-taxonomy.schema.yaml)
