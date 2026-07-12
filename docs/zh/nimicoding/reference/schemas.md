# Schemas

Nimi 使用 Nimi Coding 契约完成真相重建、权威复核、确定性证据检查与规范结构
验证。这些契约描述宿主必须产出什么、门禁必须检查什么，不记录宿主任务进度。

## 规范重建结果

路径：`.nimi/contracts/spec-reconstruction-result.yaml`

| 字段组 | 要求 |
| --- | --- |
| 必备摘要 | 生成路径、审计引用、placement report、覆盖摘要、未解决与推断数量、状态、摘要、验证时间 |
| 状态 | `reconstructed`、`partial` 或 `blocked` |
| 完成条件 | 规范树就绪、必备文件有效、placement 有效、审计条目完整、未解决缺口明确 |
| 本地性 | 结果仅供本地复核，不能成为产品权威 |

## 文档规范审计结果

路径：`.nimi/contracts/doc-spec-audit-result.yaml`

| 字段 | 要求 |
| --- | --- |
| `compared_paths` | 实际比较的路径 |
| `finding_count` | 发现数量 |
| `status` | `aligned`、`drift_detected` 或 `blocked` |
| `summary` | 基于证据的结果摘要 |
| `verified_at` | 验证时间 |

## 高风险准入证据

路径：`.nimi/contracts/high-risk-admission.schema.yaml`

每条准入都要包含变更、disposition、时间、权威复核 owner、摘要和来源决策契约。
准入记录只是本地证据，不能创建或推进宿主状态，也不能成为产品权威。

## Prompt 契约

路径：`.nimi/contracts/prompt.schema.yaml`

受治理 handoff 要声明任务目标、权威读取、已确认状态、硬约束、必达结果、非目标、
所需检查、最终输出格式和阻塞升级规则。外部宿主自行决定如何执行这个有边界的请求。

## 宿主结果契约

路径：`.nimi/contracts/worker-output.schema.yaml`

结果要报告 findings、实现摘要、变更文件、实际运行的检查，以及剩余缺口或风险。
可选区块承载权威影响、已选决策、guard 行为与剩余阻塞。

## 验收契约

路径：`.nimi/contracts/acceptance.schema.yaml`

验收顺序是权威对齐、证据充分性、disposition。Disposition 只能是 `complete`、
`partial` 或 `deferred`；缺失的必备结果不能被包装成成功。

## 规范结构契约

| 契约 | 用途 |
| --- | --- |
| `table-family.schema.yaml` | 定义允许的语义表族，以及权威表中禁用的执行状态字段 |
| `placement-contract.schema.yaml` | 验证规范的权威放置位置 |
| `projection-edge.schema.yaml` | 验证权威到投影的边 |
| `domain-admission.schema.yaml` | 验证域准入记录 |
| `tracked-output-admission.schema.yaml` | 验证 tracked generated outputs |
| `surface-taxonomy.schema.yaml` | 分类 canonical 与 support 表面 |

## 禁用反模式

路径：`.nimi/contracts/forbidden-shortcuts.catalog.yaml`

目录拒绝最小子集真相、legacy alias、compatibility shim、双读双写、伪成功、
仅 happy path 闭合、按时间分层、应用局部影子真相，以及静默重开 owner 边界。

## 来源依据

- [`.nimi/contracts/spec-reconstruction-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-reconstruction-result.yaml)
- [`.nimi/contracts/doc-spec-audit-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/doc-spec-audit-result.yaml)
- [`.nimi/contracts/high-risk-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/high-risk-admission.schema.yaml)
- [`.nimi/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/prompt.schema.yaml)
- [`.nimi/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/worker-output.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
- [`.nimi/contracts/table-family.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/table-family.schema.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
