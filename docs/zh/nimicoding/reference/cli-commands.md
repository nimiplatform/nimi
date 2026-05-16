# CLI 命令参考

`nimicoding` CLI 的字段级参考。概念层面的总览见 [CLI Surface](/zh/nimicoding/cli)。

## Bootstrap 命令

### `nimicoding start`

| 属性 | 值 |
| --- | --- |
| 用途 | 引导或恢复项目状态 |
| 模式 | 交互式；`--yes` 走非交互路径 |
| 失败行为 | 遇到未知 CLI 选项时 fail closed |
| 保留 | 已有的真相文件 |
| 副作用 | 创建 `.nimi/**`，更新受管 `AGENTS.md` / `CLAUDE.md` 区块，更新 `.gitignore` |

### `nimicoding clear`

| 属性 | 值 |
| --- | --- |
| 用途 | 移除受管 AI 区块和包自有的 bootstrap 文件 |
| 保留 | `.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**`、本地修改过的 bootstrap 文件 |
| 拒绝 | 隐式删除项目自有的真相 |

### `nimicoding doctor`

| 标志 | 用途 |
| --- | --- |
| `--json` | 机器可读输出 |

| 校验项 | 检查内容 |
| --- | --- |
| Bootstrap seed | `.nimi/**` 文件是否就位 |
| 本地状态 | `.nimi/local/`、`.nimi/cache/` 存在且被忽略 |
| 契约版本 | bootstrap 契约兼容性 |
| 跨契约引用 | manifest、handoff、runtime、installer、host-profile 一致 |
| Host-adapter | 边界真相 |
| Skill 结果契约 | reconstruction、doc-spec-audit、high-risk-execution 三类结果契约 |
| 高风险 schema | packet、orchestration-state、prompt、worker-output、acceptance |
| 外部宿主姿态 | 兼容性契约校验 |

| 退出码 | 含义 |
| --- | --- |
| 0 | 健康 |
| 非 0 | 至少一项出现已命名的 drift |

## Topic 生命周期

### `nimicoding topic create <slug> --justification <text> [--title <text>] [--json]`

创建提案 topic，必须给出显式的进入理由。

### `nimicoding topic wave add <topic-id> <wave-id> <slug> --goal <text> --owner-domain <text> [--dep <wave-id>] [--json]`

添加一条 wave。`<wave-id>` 用 `wave-N-<slug>` 形态，并保证在 topic 内唯一。

### `nimicoding topic packet freeze <topic-id> --from <draft-path> [--json]`

校验并冻结一份 packet 产物。Packet id 建议带上 wave 标识，例如 `wave-1-add-reference-field`；像 `smoke-1` 这种短 id 在同一 topic 内可能产生命名歧义的 `packet-*.md` 生命周期文件。

### `nimicoding topic worker dispatch <topic-id> --packet <packet-id> [--json]`

把已冻结的 packet 派发到 worker 路径，并将 packet 推进到 dispatched 生命周期状态。

### `nimicoding topic result record <topic-id> --kind <worker|implementation|audit|preflight|judgement> --verdict <PASS|NEEDS_REVISION|FAIL|OVERFLOW> --from <path> --verified-at <iso8601> [--json]`

记录一份强类型结果。Topic 结果时间戳采用 UTC 秒级精度，例如 `2026-05-06T16:47:20Z`。

### `nimicoding topic run-next-step <topic-id> [--json]`

计算下一步生命周期决策。需要重复机械步进时，请用 `nimicoding topic-runner step` 或 `nimicoding topic-runner run`，并显式传入 `--run-id` 与 adapter。

### `nimicoding topic closeout wave <topic-id> <wave-id> ... [--json]`

按权威、语义、消费方、抗漂移四个维度记录 wave 的关闭。

### `nimicoding topic true-close-audit <topic-id> --judgement <text> [--json]`

在 topic 最终关闭之前跑一遍 topic 级 true-close 关卡。

## Sweep 审计

### `nimicoding sweep audit plan --root <dir> [--criteria <csv>] [--exclude <csv>] [--max-files <n>] [--sweep-id <id>] [--json]`

构建审计计划，并把分块文件物化到 `.nimi/local/audit/chunks/<sweep-id>/`。JSON 输出报告分块引用；从分块文件里读取 `chunk_id`，比如 `chunk-001`。

### `nimicoding sweep audit chunk dispatch --sweep-id <id> --chunk-id <chunk-id> --dispatched-at <iso8601> [--auditor <id>] [--json]`

派发单个分块。Sweep 审计时间戳采用完整的 JavaScript ISO UTC 形态，含毫秒，例如 `2026-05-06T16:47:20.705Z`。

### `nimicoding sweep audit chunk audit-codex --sweep-id <id> --chunk-id <chunk-id> --dispatched-at <iso8601> --verified-at <iso8601> --reviewed-at <iso8601> [--from-raw-output <ref>] [--timeout-ms <ms>] [--json]`

在当前宿主支持 Codex 时，跑 Codex 后端的分块审计路径。

### `nimicoding sweep audit chunk ingest --sweep-id <id> --chunk-id <chunk-id> --from <json> --verified-at <iso8601> [--json]`

接收某分块的审计员证据。

### `nimicoding sweep audit chunk review --sweep-id <id> --chunk-id <chunk-id> --verdict <pass|fail> --reviewed-at <iso8601> [--summary <text>] [--json]`

记录管理者对已接收证据的复核。

### `nimicoding sweep audit chunk skip --sweep-id <id> --chunk-id <chunk-id> --reason <text> --skipped-at <iso8601> [--json]`

显式跳过某分块，必须给出原因。

### `nimicoding sweep audit ledger build --sweep-id <id> [--verified-at <iso8601>] [--json]`

构建一份不可变的审计账本快照。

### `nimicoding sweep audit remediation-map build --sweep-id <id> [--max-findings <n>] [--verified-at <iso8601>] [--json]`

从账本生成候选的修复地图。涉及权威对齐或需要人工判断的 finding，应先走 `sweep design` 再实施。

### `nimicoding sweep audit finding resolve --sweep-id <id> --finding-id <id> --disposition <remediated|accepted-risk|false-positive|deferred-backlog> --from <json> --verified-at <iso8601> [--json]`

记录单条审计 finding 的处置证据。

### `nimicoding sweep audit closeout summary --sweep-id <id> --verified-at <iso8601> [--json]`

生成 sweep 关闭摘要（仅本地可见）。

### `nimicoding sweep audit status --sweep-id <id> [--json]`

报告当前 sweep 的状态。

已被移除的顶层入口 `nimicoding audit-sweep ...` 不是规范的 CLI 命令。

## Sweep 设计

### `nimicoding sweep design intake --sweep-id <id> [--run-id <id>] [--json]`

读取 `.nimi/local/audit/evidence/<sweep-id>/findings.yaml`，记录源哈希，并把清单写到 `.nimi/local/sweep-design/<run-id>/`。

### `nimicoding sweep design packet-build --run-id <id> --packet-id <id> (--finding-id <id>|--finding-ids <csv>) [--explicit-question <text>] [--prior-design-state-refs <csv>] [--prior-design-state-marker <state>] [--current-cluster-refs <csv>] [--current-wave-refs <csv>] [--authority-only] [--json]`

为一个或多个 finding 构建一份界限明确的设计审计 packet。Packet 引用源 finding、相关证据、权威引用、先前设计状态、显式问题、预期结果形态、证据缺口策略和停止条件。

### `nimicoding sweep design packet-build-batch --run-id <id> --batch-size <n> [--finding-ids <csv>] [--packet-prefix <id>] [--manifest-id <id>] [--explicit-question <text>] [--json]`

从清单批量构建一份设计审计 packet 的 manifest。

### `nimicoding sweep design auditor-prompt --run-id <id> --packet-id <id> [--json]`

为某份设计审计 packet 输出宿主提示词，包含必需的结果来源和血缘字段。

### `nimicoding sweep design result-ingest --run-id <id> --from <yaml> [--mode <focused|all>] [--json]`

接收一份强类型的设计审计结果，更新 finding 结论、cluster 与 wave 变更、决策请求、追加审计请求和修订记录。Synthetic-trial 结果只在显式 load-test 标志下被允许，且不满足真正的 LLM 关闭条件。

### `nimicoding sweep design ledger-validate --run-id <id> [--json]`

在排期之前校验修订账本完整性和最终结论的血缘。

### `nimicoding sweep design finalize --run-id <id> [--json]`

从校验过的设计账本输出最终状态报告（仅本地可见）。

### `nimicoding sweep design wave-plan --run-id <id> --topic-id <id> [--json]`

为可进入实施的 cluster 输出候选的 `topic wave add` / `topic wave admit` 命令引用，不会改动 topic 状态。

## Skill 交接

### `nimicoding handoff --skill <skill-id> [--json] [--prompt]`

| 标志 | 必需 | 用途 |
| --- | --- | --- |
| `--skill <skill-id>` | 是 | 取值之一：`spec_reconstruction`、`doc_spec_audit`、`audit_sweep`、`high_risk_execution` |
| `--json` | 否 | 权威 payload |
| `--prompt` | 否 | 给宿主看的人类可读简报 |

| 拒绝场景 | 触发条件 |
| --- | --- |
| `doc_spec_audit` 交接 | `.nimi/spec/` 下的规范树尚未就绪 |
| `high_risk_execution` 交接 | 规范树尚未就绪 |

### `nimicoding closeout --skill <skill-id> --outcome <outcome> --verified-at <iso8601>`

| 标志 | 必需 | 用途 |
| --- | --- | --- |
| `--skill` | 是 | 哪个 skill |
| `--outcome` | 是 | `completed`、`failed` 等 |
| `--verified-at` | 是 | closeout 命令接受的 ISO8601 UTC 时间戳 |
| `--from <json>` | 否 | 从 JSON 导入 skill 结果 |
| `--write-local` | 否 | 把 payload 写到 `.nimi/local/handoff-results/` |

| Fail-closed 触发 | 条件 |
| --- | --- |
| outcome 与规范树状态相悖 | 是 |
| 引用越出声明的本地产物根 | 是 |
| 导入的摘要违反声明的 skill 结果契约 | 是 |

## 高风险执行

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`

| 标志 | 用途 |
| --- | --- |
| `--from <json>` | 高风险决策 payload 路径 |
| `--admitted-at <iso8601>` | 准入时间 |
| `--write-spec` | 写入受跟踪的语义真相 |

| 仅接受 | `nimicoding.high-risk-decision.v1`，且 `decisionStatus: manager_decision_recorded` |

### `nimicoding ingest-high-risk-execution --from <json>`

| 仅接受 | `high_risk_execution` closeout 产物，且 `outcome: completed`、`summary.status: candidate_ready` |
| 校验 | 引用的 packet、orchestration-state、prompt、worker-output |
| 输出 | 仅本地可见的 ingest payload |

### `nimicoding review-high-risk-execution --from <json>`

| 仅接受 | `nimicoding.high-risk-ingest.v1`，且 `ok: true` |
| 输出 | 进入 review 的附件 payload |

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`

| 仅接受 | `nimicoding.high-risk-review.v1`，且 `ok: true`、`reviewStatus: ready_for_manager_review` |
| 校验 | acceptance 产物必须含显式 `Disposition:` 行 |
| 输出 | 仅本地可见的管理者决策 payload |

## 机械校验器

| 命令 | 校验内容 |
| --- | --- |
| `nimicoding validate-execution-packet <path>` | 已冻结的 packet 形态 |
| `nimicoding validate-orchestration-state <path>` | 编排状态记录 |
| `nimicoding validate-prompt <path>` | prompt payload |
| `nimicoding validate-worker-output <path>` | worker 输出形态 |
| `nimicoding validate-acceptance <path>` | acceptance 证据 |

| 通用输出 | `validator-cli-result.v1` JSON |
| 失败行为 | 缺少必需段落、YAML 格式错误、seed 契约 drift 时 fail closed |

## 规范审计

### `nimicoding validate-spec-tree`

校验 `.nimi/spec` 下规范树的结构。

### `nimicoding validate-spec-audit`

校验 `.nimi/local/state/spec-generation/spec-generation-audit.yaml` 中的逐文件 grounding、推断和未解决缺口跟踪。

### `nimicoding blueprint-audit`

将仓库本地的 blueprint 根与 `.nimi/spec` 下的候选规范树做对比。这是一次显式的等价性审计，不会触发任何路由变更。

## 来源依据

- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)（CLI 章节）
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/audit-chunk.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/audit-chunk.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/acceptance.schema.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-installer-result.yaml)
