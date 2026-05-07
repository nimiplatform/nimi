# CLI 命令

`nimicoding` CLI 的字段级参考。概念级总览见 [CLI 表面](/zh/nimicoding/cli)。

## Bootstrap 命令

### `nimicoding start`

| 性质 | 值 |
| --- | --- |
| 用途 | Bootstrap 或恢复项目状态 |
| 模式 | 交互；`--yes` 走非交互路径 |
| 失败 | 未知 CLI 选项 fail-close |
| 保留 | 既有真相文件 |
| 副作用 | 建 `.nimi/**`、更新托管 `AGENTS.md` / `CLAUDE.md` 块、更新 `.gitignore` |

### `nimicoding clear`

| 性质 | 值 |
| --- | --- |
| 用途 | 移除托管 AI 块与包拥有 bootstrap 文件 |
| 保留 | `.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**`、本地修改的 bootstrap 文件 |
| 拒 | 隐式删项目拥有真相 |

### `nimicoding doctor`

| Flag | 用途 |
| --- | --- |
| `--json` | 机器可读输出 |

| 校验 | 检查什么 |
| --- | --- |
| Bootstrap 种子 | `.nimi/**` 文件在 |
| 本地状态 | `.nimi/local/`、`.nimi/cache/` 在并被 ignore |
| 合同版本 | Bootstrap 合同兼容 |
| 跨合同 ref | Manifest、handoff、runtime、installer、host-profile 对齐 |
| Host-adapter | 边界真相 |
| 技能结果合同 | Reconstruction、doc-spec-audit、high-risk-execution 结果合同 |
| 高风险 schema | Packet、orchestration-state、prompt、worker-output、acceptance |
| 外部 host 姿态 | 兼容合同校验 |

| Exit code | 含义 |
| --- | --- |
| 0 | 健康 |
| 非零 | 一项或多项命名漂移 |

## Topic 生命周期

### `nimicoding topic create <slug> --justification <text> [--title <text>] [--json]`

创建 proposal topic；必须给出明确 entry justification。

### `nimicoding topic wave add <topic-id> <wave-id> <slug> --goal <text> --owner-domain <text> [--dep <wave-id>] [--json]`

添加 wave 条目。`wave_id` 建议使用 `wave-N-<slug>`，并且在同一 topic 内唯一。

### `nimicoding topic packet freeze <topic-id> --from <draft-path> [--json]`

校验并冻结 packet 工件。`packet_id` 建议带上 wave 身份，例如 `wave-1-add-reference-field`；像 `smoke-1` 这样的短 id 可能让后续 `packet-*.md` 生命周期文件名变得含混。

### `nimicoding topic worker dispatch <topic-id> --packet <packet-id> [--json]`

把已冻结 packet dispatch 到 worker 路径，并把 packet 推到 dispatched 生命周期状态。

### `nimicoding topic result record <topic-id> --kind <worker|implementation|audit|preflight|judgement> --verdict <PASS|NEEDS_REVISION|FAIL|OVERFLOW> --from <path> --verified-at <iso8601> [--json]`

记录类型化结果。Topic result 的时间戳用 UTC 秒精度，例如 `2026-05-06T16:47:20Z`。

### `nimicoding topic run-next-step <topic-id> [--json]`

计算下一步生命周期决定。要连续机械推进时，用带 `--run-id` 和 adapter 的 `nimicoding topic-runner step` 或 `nimicoding topic-runner run`。

### `nimicoding topic closeout wave <topic-id> <wave-id> ... [--json]`

按权威、语义、消费方、抗漂移四个维度记录 wave closeout。

### `nimicoding topic true-close-audit <topic-id> --judgement <text> [--json]`

在 topic closeout 前跑 topic 级 true-close 闸门。

## Sweep audit

### `nimicoding sweep audit plan --root <dir> [--criteria <csv>] [--exclude <csv>] [--max-files <n>] [--sweep-id <id>] [--json]`

生成 audit plan，并把 chunk 文件写到 `.nimi/local/audit/chunks/<sweep-id>/`。JSON 输出给 chunk ref；具体 `chunk_id` 在 chunk 文件里，默认形状是 `chunk-001`。

### `nimicoding sweep audit chunk dispatch --sweep-id <id> --chunk-id <chunk-id> --dispatched-at <iso8601> [--auditor <id>] [--json]`

Dispatch 单个 chunk。Sweep audit 时间戳用完整 JavaScript ISO UTC 形状，带毫秒，例如 `2026-05-06T16:47:20.705Z`。

### `nimicoding sweep audit chunk audit-codex --sweep-id <id> --chunk-id <chunk-id> --dispatched-at <iso8601> --verified-at <iso8601> --reviewed-at <iso8601> [--from-raw-output <ref>] [--timeout-ms <ms>] [--json]`

在当前宿主支持时，走 Codex-backed 的 chunk 审计路径。

### `nimicoding sweep audit chunk ingest --sweep-id <id> --chunk-id <chunk-id> --from <json> --verified-at <iso8601> [--json]`

Ingest 这个 chunk 的 auditor 证据。

### `nimicoding sweep audit chunk review --sweep-id <id> --chunk-id <chunk-id> --verdict <pass|fail> --reviewed-at <iso8601> [--summary <text>] [--json]`

记录 manager 对这份证据的 review。

### `nimicoding sweep audit chunk skip --sweep-id <id> --chunk-id <chunk-id> --reason <text> --skipped-at <iso8601> [--json]`

带明确原因跳过一个 chunk。

### `nimicoding sweep audit ledger build --sweep-id <id> [--verified-at <iso8601>] [--json]`

生成不可变 audit ledger 快照。

### `nimicoding sweep audit remediation-map build --sweep-id <id> [--max-findings <n>] [--verified-at <iso8601>] [--json]`

从 ledger 生成候选 remediation map。需要权威对齐或用户判断的 finding，应先走 `sweep design`，再进入实现。

### `nimicoding sweep audit finding resolve --sweep-id <id> --finding-id <id> --disposition <remediated|accepted-risk|false-positive|deferred-backlog> --from <json> --verified-at <iso8601> [--json]`

为单个 audit finding 记录 resolution 证据。

### `nimicoding sweep audit closeout summary --sweep-id <id> --verified-at <iso8601> [--json]`

生成本地专用的 sweep closeout summary。

### `nimicoding sweep audit status --sweep-id <id> [--json]`

查看当前 sweep 状态。

旧的顶层 `nimicoding audit-sweep ...` 不再是规范 CLI 入口。

## Sweep design

### `nimicoding sweep design intake --sweep-id <id> [--run-id <id>] [--json]`

读取 `.nimi/local/audit/evidence/<sweep-id>/findings.yaml`，记录源文件 hash，并在 `.nimi/local/sweep-design/<run-id>/` 下写入 inventory。

### `nimicoding sweep design packet-build --run-id <id> --packet-id <id> (--finding-id <id>|--finding-ids <csv>) [--explicit-question <text>] [--prior-design-state-refs <csv>] [--prior-design-state-marker <state>] [--current-cluster-refs <csv>] [--current-wave-refs <csv>] [--authority-only] [--json]`

为一个或多个 finding 构建边界明确的设计审计 packet。Packet 引用源 finding、相关证据、权威 refs、既有设计状态、明确问题、期望结果形状、证据缺口策略和 stop conditions。

### `nimicoding sweep design packet-build-batch --run-id <id> --batch-size <n> [--finding-ids <csv>] [--packet-prefix <id>] [--manifest-id <id>] [--explicit-question <text>] [--json]`

从 inventory 生成一组设计审计 packet 的 manifest。

### `nimicoding sweep design auditor-prompt --run-id <id> --packet-id <id> [--json]`

输出设计审计 packet 的宿主 prompt，并写明必需的结果来源和 provenance 字段。

### `nimicoding sweep design result-ingest --run-id <id> --from <yaml> [--mode <focused|all>] [--json]`

Ingest 类型化设计审计结果，更新 finding outcome、cluster 与 wave 变化、用户决策请求、追加审计请求和 revision entries。Synthetic trial 结果只允许显式用于 load test，且不能满足 true LLM closeout。

### `nimicoding sweep design ledger-validate --run-id <id> [--json]`

在规划前校验 revision ledger 完整性和 final outcome provenance。

### `nimicoding sweep design finalize --run-id <id> [--json]`

从已校验的设计 ledger 生成本地专用 final state report。

### `nimicoding sweep design wave-plan --run-id <id> --topic-id <id> [--json]`

为 implementation-ready cluster 输出候选 `topic wave add` / `topic wave admit` 命令引用。它不改 topic 状态。

## 技能 handoff

### `nimicoding handoff --skill <skill-id> [--json] [--prompt]`

| Flag | Required | 用途 |
| --- | --- | --- |
| `--skill <skill-id>` | 是 | `spec_reconstruction`、`doc_spec_audit`、`audit_sweep`、`high_risk_execution` 之一 |
| `--json` | 否 | 权威 payload |
| `--prompt` | 否 | 人可读 host 简介 |

| 拒 | 何时 |
| --- | --- |
| `doc_spec_audit` handoff | `.nimi/spec/` 下规范化树未就绪 |
| `high_risk_execution` handoff | 规范化树未就绪 |

### `nimicoding closeout --skill <skill-id> --outcome <outcome> --verified-at <iso8601>`

| Flag | Required | 用途 |
| --- | --- | --- |
| `--skill` | 是 | 哪个技能 |
| `--outcome` | 是 | `completed`、`failed` 等 |
| `--verified-at` | 是 | closeout 命令接受的 ISO8601 UTC 时间戳 |
| `--from <json>` | 否 | 从 JSON import 技能结果 |
| `--write-local` | 否 | 写 payload 到 `.nimi/local/handoff-results/` |

| Fail-close | 何时 |
| --- | --- |
| Outcome 跟规范化树状态矛盾 | 是 |
| Refs 逃出声明本地工件根 | 是 |
| Imported summary 违反声明技能结果合同 | 是 |

## 高风险执行

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`

| Flag | 用途 |
| --- | --- |
| `--from <json>` | 高风险决定 payload 路径 |
| `--admitted-at <iso8601>` | 何时准入 |
| `--write-spec` | 写跟踪语义真相 |

| 只接受 | 带 `decisionStatus: manager_decision_recorded` 的 `nimicoding.high-risk-decision.v1` payload |

### `nimicoding ingest-high-risk-execution --from <json>`

| 只接受 | 带 `outcome: completed` 与 `summary.status: candidate_ready` 的 `high_risk_execution` closeout 工件 |
| 校验 | 引用的 packet、orchestration-state、prompt、worker-output |
| 输出 | 仅本地 ingest payload |

### `nimicoding review-high-risk-execution --from <json>`

| 只接受 | 带 `ok: true` 的 `nimicoding.high-risk-ingest.v1` payload |
| 输出 | Review-ready 附件 payload |

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`

| 只接受 | 带 `ok: true` 与 `reviewStatus: ready_for_manager_review` 的 `nimicoding.high-risk-review.v1` payload |
| 校验 | 接受度工件要显式 `Disposition:` 行 |
| 输出 | 仅本地 manager 决定 payload |

## 机器校验器

| 命令 | 校验 |
| --- | --- |
| `nimicoding validate-execution-packet <path>` | 冻结 packet 形状 |
| `nimicoding validate-orchestration-state <path>` | 编排状态记录 |
| `nimicoding validate-prompt <path>` | Prompt payload |
| `nimicoding validate-worker-output <path>` | Worker 输出形状 |
| `nimicoding validate-acceptance <path>` | 接受度证据 |

| 公共输出 | `validator-cli-result.v1` JSON |
| 失败 | 缺必填段、YAML 形状错、种子合同漂移时 fail-close |

## Spec 审计

### `nimicoding validate-spec-tree`

校验 `.nimi/spec` 下规范化树结构。

### `nimicoding validate-spec-audit`

校验 `.nimi/spec/_meta/spec-generation-audit.yaml` 下按文件 grounding、推断、未解决 gap 跟踪。

### `nimicoding blueprint-audit`

比较仓库本地 blueprint 根与 `.nimi/spec` 下候选规范化树。显式等价审计；**不**做路由变更。

## 来源

- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)（CLI 段）
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/audit-chunk.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-chunk.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
