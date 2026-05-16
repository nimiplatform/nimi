# CLI Surface

`nimicoding` CLI 是 Nimi Coding 的包边界。它把包自有的方法论写入项目，校验生成的 `.nimi/**` 真相层，向外部 AI 宿主输出交接 payload，记录本地 closeout 证据，并为高风险工作执行 topic / wave / packet 关卡。

CLI 不写产品代码，不作为包内 AI runtime 调用 provider，不拥有调度，也不运行自主 agent loop。执行属于已准入宿主；CLI 负责契约边界。

每个命令的字段级参考见 [参考 → CLI 命令](/zh/nimicoding/reference/cli-commands)。

## 命令分类

| 分类 | 命令 |
| --- | --- |
| Bootstrap 与 seed 同步 | `start`、`start --host <host>`、`clear`、`sync`、`doctor` |
| Skill 交接与 closeout | `handoff --skill ...`、`closeout --skill ...`、`closeout --from ...` |
| Topic 生命周期 | `topic create`、`topic status`、`topic validate`、`topic wave ...`、`topic packet freeze`、`topic worker dispatch`、`topic audit dispatch`、`topic result record`、`topic remediation open`、`topic overflow continue`、`topic hold`、`topic resume`、`topic closeout ...`、`topic true-close-audit`、`topic decision-review` |
| Topic runner | `topic run-next-step`、`topic run-ledger ...`、`topic-runner step`、`topic-runner run` |
| Sweep audit | `sweep audit plan`、`sweep audit chunk ...`、`sweep audit ledger build`、`sweep audit remediation-map build`、`sweep audit finding resolve`、`sweep audit closeout summary`、`sweep audit status` |
| Sweep design | `sweep design intake`、`packet-build`、`packet-build-batch`、`auditor-prompt`、`result-ingest`、`ledger-validate`、`finalize`、`wave-plan`、`fix-topic` |
| 高风险执行关卡 | `admit-high-risk-decision`、`ingest-high-risk-execution`、`review-high-risk-execution`、`decide-high-risk-execution` |
| 机械工件校验器 | `validate-execution-packet`、`validate-orchestration-state`、`validate-prompt`、`validate-worker-output`、`validate-acceptance` |
| 规范与治理校验器 | `validate-spec-tree`、`validate-spec-audit`、`validate-spec-governance`、`classify-spec-tree`、`generate-spec-migration-plan`、`validate-placement`、`validate-table-family`、`validate-projection-edges`、`validate-guidance-bodies`、`validate-domain-admission`、`validate-tracked-output-admission`、`generate-spec-derived-docs`、`validate-ai-governance`、`blueprint-audit` |

每一类都受强类型契约约束。新增命令家族是包权威变更，不是便利别名。

## Bootstrap

### `nimicoding start`

`start` 创建或恢复项目本地的 `.nimi/**` 真相层。它写入包自有的 config、contracts、methodology 和 bootstrap spec 资料，在你接受时更新受管 AI 入口区块，并准备下一次外部交接。

| 模式 | 命令 |
| --- | --- |
| 交互式 | `nimicoding start` |
| 非交互式 | `nimicoding start --yes` |
| 指定宿主提示词 | `nimicoding start --host <host>` |

`start` 会保留项目自有真相：`.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**`，以及本地修改过的 bootstrap 文件都不会被静默覆盖。

### `nimicoding sync`

`sync` 是包自有 seed 的写入契约。

| 模式 | 含义 |
| --- | --- |
| `--check` | 包自有 seed 缺失或漂移时以非零退出 |
| `--apply` | 重写漂移的 package-canonical 文件，并补齐缺失 seed |
| `--dry-run` | 只报告会发生什么 |

宿主自有的 seed 条目只在缺失时写入一次，后续不会被 `sync` 覆盖。

### `nimicoding doctor`

`doctor` 校验 bootstrap 健康度、本地状态根、跨契约引用、宿主适配姿态、技能结果契约、高风险 schema，以及 canonical tree readiness。`--json` 给机器读，`--verbose` 输出内部契约细节。

## 最小采纳路径

新项目的第一条路径是：

```bash
nimicoding start
nimicoding doctor --json
nimicoding handoff --skill spec_reconstruction --json
nimicoding validate-spec-tree .nimi/spec
nimicoding validate-spec-audit
```

`handoff` 输出 payload。外部 AI 宿主消费 payload，并物化 `.nimi/spec/**`；本地校验器负责检查结果。

## Topic 生命周期

topic 用于承载权威性、高风险、跨模块或多 wave 工作。CLI 在 `.nimi/topics/{proposal,ongoing,pending,closed}/` 下记录持久状态。

```bash
nimicoding topic create <slug> --justification <text>
nimicoding topic wave add <topic-id> <wave-id> <slug> \
  --goal <text> --owner-domain <domain>
nimicoding topic wave select <topic-id> <wave-id>
nimicoding topic wave admit <topic-id> <wave-id>
nimicoding topic packet freeze <topic-id> --from <draft-path>
nimicoding topic run-next-step <topic-id> --json
```

`run-next-step` 计算下一步强类型决策。需要反复推进时，用 `topic-runner step` 或 `topic-runner run`，并显式传入 run id 和 adapter。不要用临时拼接的 `topic run-ledger` 基础命令链替代 runner。

## Sweep Audit 与 Sweep Design

`sweep audit` 把目标根目录拆成分块，记录审计员证据，构建账本，映射候选修复，并记录 finding 处置。

`sweep design` 从 sweep finding 出发。它构建有界的设计审计 packet，接收强类型结果，校验修订血缘，生成最终本地设计状态，并输出候选 topic wave。`sweep design wave-plan` 不改状态；`sweep design fix-topic` 可以把校验过的 wave 计划写入 topic。

## 宿主特定路径

`sweep audit chunk audit-codex`、`start --host codex` 这类命令是适配器表面。它们不改变包边界：Nimi Coding 仍然宿主无关，provider runtime 所有权仍在包外。

## CLI 不做的事

| 关注点 | 边界 |
| --- | --- |
| 产品实现 | 由已准入 AI 宿主或人类 worker 修改产品代码 |
| 作为包内 runtime 调用 provider | 包不拥有 AI provider 执行 |
| 调度 | 属于宿主或周边工作流 |
| 通知 | 属于宿主或产品 UX |
| 自主执行 packet | 包负责 gate，不成为 worker |

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/CHANGELOG.md`](https://github.com/nimiplatform/nimi-coding/blob/main/CHANGELOG.md)
- [`nimi-coding/cli/help.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/help.mjs)
- [`nimi-coding/cli/index.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/index.mjs)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-handoff.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
