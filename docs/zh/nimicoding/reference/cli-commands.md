# CLI 命令

`nimicoding` 0.2.1 CLI 的字段级参考。概念层总览见 [CLI Surface](/zh/nimicoding/cli)。

## Bootstrap 与 Sync

| 命令 | 用途 |
| --- | --- |
| `nimicoding start` | 引导或恢复项目本地 `.nimi/**` |
| `nimicoding start --yes` | 走非交互式 bootstrap 路径 |
| `nimicoding start --host {host}` | bootstrap 并输出面向指定宿主的提示词 |
| `nimicoding clear --yes` | 移除仍与发布 seed 一致的受管 AI 区块和包自有 bootstrap 文件 |
| `nimicoding sync --check` | seed 缺失或 package-canonical 文件漂移时拒绝 |
| `nimicoding sync --apply` | 重新写入 package-canonical seed 条目 |
| `nimicoding sync --dry-run` | 只展示 sync 会改什么 |
| `nimicoding doctor --json` | 输出机器可读的 bootstrap 与契约健康状态 |
| `nimicoding doctor --verbose` | 包含内部契约细节 |

`clear` 会保留 `.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**`，以及本地修改过的 bootstrap 文件。

## Skill 交接与 Closeout

| 命令 | 用途 |
| --- | --- |
| `nimicoding handoff --skill {skill-id} --json` | 输出权威机器可读 payload |
| `nimicoding handoff --skill {skill-id} --prompt` | 输出给宿主看的简报和本地引用 |
| `nimicoding closeout --skill {skill-id} --outcome {outcome} --verified-at {iso8601}` | 记录 skill closeout |
| `nimicoding closeout --from {json} --write-local` | 导入强类型结果并写入本地 closeout 证据 |

有效 skill id 是 `spec_reconstruction`、`doc_spec_audit`、`audit_sweep`、`high_risk_execution`。

## Topic 生命周期

| 命令 | 用途 |
| --- | --- |
| `nimicoding topic create {slug} --justification {text} [--title {text}] [--json]` | 创建 proposal topic |
| `nimicoding topic status [{topic-ref}] [--json]` | 查看 topic 状态 |
| `nimicoding topic validate [{topic-ref}] [--json]` | 校验 topic 形态 |
| `nimicoding topic validate graph {topic-id} [--json]` | 校验 wave 图一致性 |
| `nimicoding topic validate admission {topic-id} {wave-id} [--json]` | 校验准入就绪度 |
| `nimicoding topic wave add {topic-id} {wave-id} {slug} --goal {text} --owner-domain {text} [--dep {wave-id}] [--json]` | 添加 wave |
| `nimicoding topic wave select {topic-id} {wave-id} [--json]` | 选中下一条 wave |
| `nimicoding topic wave admit {topic-id} {wave-id} [--json]` | 准入已选 wave |
| `nimicoding topic packet freeze {topic-id} --from {draft-path} [--json]` | 校验并冻结 packet 工件 |
| `nimicoding topic worker dispatch {topic-id} --packet {packet-id} [--json]` | 把冻结 packet 派发到 worker 状态 |
| `nimicoding topic audit dispatch {topic-id} --packet {packet-id} [--json]` | 为 packet 派发权威或审计复核 |
| `nimicoding topic result record {topic-id} --kind {result-kind} --verdict {result-verdict} --from {path} --verified-at {iso8601} [--json]` | 记录强类型证据 |
| `nimicoding topic remediation open {topic-id} --kind {remediation-kind} --reason {token} [--overflowed-packet {packet-id}] [--json]` | 打开修复路径 |
| `nimicoding topic overflow continue {topic-id} --packet {continuation-packet-id} --overflowed-packet {packet-id} --manager-judgement {text} --same-owner-domain [--json]` | 继续一份 overflowed packet |
| `nimicoding topic hold {topic-id} --reason {token} --summary {text} [--reopen-criteria {text}] [--close-trigger {text}] [--json]` | 把 topic 移到 pending |
| `nimicoding topic resume {topic-id} --criteria-met {text} [--json]` | 恢复 pending topic |
| `nimicoding topic validate closure {topic-id} {wave-id} [--json]` | 校验 closeout 就绪度 |
| `nimicoding topic closeout wave {topic-id} {wave-id} --authority {closure-state} --semantic {closure-state} --consumer {closure-state} --drift-resistance {closure-state} --disposition {closeout-disposition} [--json]` | 记录 wave closeout |
| `nimicoding topic true-close-audit {topic-id} --judgement {text} [--json]` | 运行 topic 级 true-close 关卡 |
| `nimicoding topic closeout topic {topic-id} --authority {closure-state} --semantic {closure-state} --consumer {closure-state} --drift-resistance {closure-state} --disposition {closeout-disposition} [--json]` | 记录 topic closeout |
| `nimicoding topic decision-review {topic-id} {slug} --decision {text} --replaced-scope {text} --active-replacement-scope {text} [--disposition {decision-disposition}] [--target-wave {wave-id}] [--date {YYYY-MM-DD}] [--json]` | 记录管理者决策复核 |

Topic 结果时间戳使用 UTC 秒级精度，例如 `2026-05-06T16:47:20Z`。

## Topic Runner

| 命令 | 用途 |
| --- | --- |
| `nimicoding topic run-next-step {topic-id} [--json]` | 计算下一步强类型生命周期决策 |
| `nimicoding topic run-ledger {ledger-action} {topic-id} --run-id {id} [--json]` | 维护 run ledger |
| `nimicoding topic-runner step {topic-id} --run-id {id} --adapter {adapter} [--execute-host] [--json]` | 执行一个受治理步骤 |
| `nimicoding topic-runner run {topic-id} --run-id {id} --adapter {adapter} [--execute-host] [--json]` | 连续执行受治理步骤 |

重复推进时优先使用 `topic-runner step` 或 `topic-runner run`，不要手工串联 `topic run-ledger record` 基础命令。

## Sweep Audit

| 命令 | 用途 |
| --- | --- |
| `nimicoding sweep audit plan --root {dir} [--criteria {csv}] [--exclude {csv}] [--max-files {n}] [--sweep-id {id}] [--json]` | 构建审计计划并切分文件 |
| `nimicoding sweep audit chunk dispatch --sweep-id {id} --chunk-id {chunk-id} --dispatched-at {iso8601} [--auditor {id}] [--json]` | 派发一个分块 |
| `nimicoding sweep audit chunk audit-codex --sweep-id {id} --chunk-id {chunk-id} --dispatched-at {iso8601} --verified-at {iso8601} --reviewed-at {iso8601} [--from-raw-output {ref}] [--timeout-ms {ms}] [--json]` | 运行 Codex adapter 的分块审计路径 |
| `nimicoding sweep audit chunk ingest --sweep-id {id} --chunk-id {chunk-id} --from {json} --verified-at {iso8601} [--json]` | 接收审计员证据 |
| `nimicoding sweep audit chunk review --sweep-id {id} --chunk-id {chunk-id} --verdict {review-verdict} --reviewed-at {iso8601} [--summary {text}] [--json]` | 记录管理者复核 |
| `nimicoding sweep audit chunk skip --sweep-id {id} --chunk-id {chunk-id} --reason {text} --skipped-at {iso8601} [--json]` | 带原因跳过一个分块 |
| `nimicoding sweep audit ledger build --sweep-id {id} [--verified-at {iso8601}] [--json]` | 构建不可变账本快照 |
| `nimicoding sweep audit remediation-map build --sweep-id {id} [--max-findings {n}] [--verified-at {iso8601}] [--json]` | 构建候选修复地图 |
| `nimicoding sweep audit finding resolve --sweep-id {id} --finding-id {id} --disposition {finding-disposition} --from {json} --verified-at {iso8601} [--json]` | 记录 finding 处置证据 |
| `nimicoding sweep audit closeout summary --sweep-id {id} --verified-at {iso8601} [--json]` | 构建仅本地可见的 closeout 摘要 |
| `nimicoding sweep audit status --sweep-id {id} [--json]` | 报告 sweep 状态 |

Sweep audit 时间戳使用完整 JavaScript ISO UTC 形态并带毫秒，例如 `2026-05-06T16:47:20.705Z`。

## Sweep Design

| 命令 | 用途 |
| --- | --- |
| `nimicoding sweep design intake --sweep-id {id} [--run-id {id}] [--json]` | 把 findings fork 成设计工作集 |
| `nimicoding sweep design packet-build --run-id {id} --packet-id {id} (--finding-id {id} or --finding-ids {csv}) [--explicit-question {text}] [--prior-design-state-refs {csv}] [--prior-design-state-marker {state}] [--current-cluster-refs {csv}] [--current-wave-refs {csv}] [--authority-only] [--json]` | 构建一个设计审计 packet |
| `nimicoding sweep design packet-build-batch --run-id {id} --batch-size {n} [--finding-ids {csv}] [--packet-prefix {id}] [--manifest-id {id}] [--explicit-question {text}] [--json]` | 构建 batch manifest |
| `nimicoding sweep design auditor-prompt --run-id {id} --packet-id {id} [--json]` | 为设计 packet 输出宿主提示词 |
| `nimicoding sweep design result-ingest --run-id {id} --from {yaml} [--mode {mode}] [--json]` | 接收强类型设计审计结果 |
| `nimicoding sweep design ledger-validate --run-id {id} [--json]` | 校验修订账本血缘 |
| `nimicoding sweep design finalize --run-id {id} [--json]` | 输出最终本地设计状态 |
| `nimicoding sweep design wave-plan --run-id {id} --topic-id {id} [--json]` | 输出候选 topic-wave 命令 |
| `nimicoding sweep design fix-topic --run-id {id} [--slug {slug}] [--title {title}] [--admit-first-wave or --admit-wave-id {id}] [--json]` | 把校验过的 wave plan 写入 topic |

## 高风险执行关卡

| 命令 | 接受什么 |
| --- | --- |
| `nimicoding admit-high-risk-decision --from {json} --admitted-at {iso8601} [--json] [--write-spec]` | `decisionStatus: manager_decision_recorded` 的 `nimicoding.high-risk-decision.v1` payload |
| `nimicoding ingest-high-risk-execution --from {json} [--json] [--write-local]` | `outcome: completed` 且 `summary.status: candidate_ready` 的 `high_risk_execution` closeout |
| `nimicoding review-high-risk-execution --from {json} [--json] [--write-local]` | 有效的高风险 ingest payload |
| `nimicoding decide-high-risk-execution --from {json} --acceptance {path} --verified-at {iso8601} [--json] [--write-local]` | review payload，以及含显式 `Disposition:` 行的 acceptance 工件 |

## 规范与治理校验器

| 命令 | 用途 |
| --- | --- |
| `nimicoding validate-spec-tree [.nimi/spec]` | 校验 canonical tree 结构 |
| `nimicoding validate-spec-audit [.nimi/local/state/spec-generation/spec-generation-audit.yaml]` | 校验逐文件来源证据、推断和未解决缺口 |
| `nimicoding validate-spec-governance --profile {profile-id} --scope {scope}` | 校验配置的规范治理范围 |
| `nimicoding classify-spec-tree --profile {profile-id} --root .nimi/spec [--emit {path}] [--json]` | 分类 spec surface 条目 |
| `nimicoding generate-spec-migration-plan --profile {profile-id} --root .nimi/spec --emit .nimi/local/state/spec-surface/migration-plan.json [--json]` | 输出 migration plan |
| `nimicoding validate-placement --profile {profile-id} --root .nimi/spec [--json]` | 校验 placement 契约 |
| `nimicoding validate-table-family --profile {profile-id} --root .nimi/spec [--json]` | 校验 table-family 契约 |
| `nimicoding validate-projection-edges --profile {profile-id} --root .nimi/spec [--json]` | 校验 projection edge 契约 |
| `nimicoding validate-guidance-bodies --profile {profile-id} --root .nimi/spec [--json]` | 校验 guidance body 形态 |
| `nimicoding validate-domain-admission --profile {profile-id} --root .nimi/spec [--json]` | 校验 domain admission 记录 |
| `nimicoding validate-tracked-output-admission --profile {profile-id} --root .nimi/spec [--json]` | 校验 tracked-output admission |
| `nimicoding generate-spec-derived-docs --profile {profile-id} --scope {scope} [--check]` | 生成或检查派生文档 |
| `nimicoding validate-ai-governance --profile {profile-id} --scope {scope}` | 校验 AI governance 约束 |
| `nimicoding blueprint-audit [--blueprint-root {path}] [--canonical-root {path}] [--json] [--write-local]` | 对比 blueprint 与 canonical spec 根 |

## 机械工件校验器

| 命令 | 校验对象 |
| --- | --- |
| `nimicoding validate-execution-packet {path}` | 冻结 execution packet 形态 |
| `nimicoding validate-orchestration-state {path}` | orchestration state 记录 |
| `nimicoding validate-prompt {path}` | prompt payload |
| `nimicoding validate-worker-output {path}` | worker output 形态 |
| `nimicoding validate-acceptance {path}` | acceptance 证据 |

## 来源依据

- [`nimi-coding/cli/help.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/help.mjs)
- [`nimi-coding/cli/index.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/index.mjs)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
