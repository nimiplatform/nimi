# CLI 表面

`nimicoding` CLI 是一组小而有界的命令。包是有意做成**边界完整、不是执行完整**：CLI 负责 bootstrap、校验、把工件映出来，但它**不**自动跑 packet。

每条命令的字段级参考在 [Reference → CLI Commands](/zh/nimicoding/reference/cli-commands)。

## 命令分类

CLI 的动词分成几类：

| 类别 | 命令 |
| --- | --- |
| Bootstrap | `start`、`clear`、`doctor` |
| Topic 生命周期 | `topic create`、`topic wave ...`、`topic packet freeze`、`topic worker dispatch`、`topic result record`、`topic closeout ...`、`topic true-close-audit` |
| Topic runner | `topic run-next-step`、`topic-runner step`、`topic-runner run` |
| Sweep audit | `sweep audit plan`、`sweep audit chunk ...`、`sweep audit ledger build`、`sweep audit remediation-map build`、`sweep audit closeout summary`、`sweep audit status` |
| Sweep design | `sweep design intake`、`sweep design packet-build`、`sweep design packet-build-batch`、`sweep design auditor-prompt`、`sweep design result-ingest`、`sweep design ledger-validate`、`sweep design finalize`、`sweep design wave-plan` |
| 技能 handoff | `handoff`、`closeout` |
| 高风险执行 | `admit-high-risk-decision`、`ingest-high-risk-execution`、`review-high-risk-execution`、`decide-high-risk-execution` |
| 机器校验器 | 针对单个工件的校验器：`execution-packet`、`orchestration-state`、`prompt`、`worker-output`、`acceptance` |
| Spec 审计 | `validate-spec-tree`、`validate-spec-audit`、`blueprint-audit` |
| Repo 闸门 | `pnpm check:spec-authority-cutover-readiness`（走宿主仓库的本地工具） |

每一条都有边界；要加新动词，得有准入的合同扩展。

## Bootstrap

### `nimicoding start`

检测项目状态，把包源映射到宿主路径下，给 `.nimi/**` 种子，准备一份权威 JSON AI 任务包，再打印一段可粘贴的 prompt。

| 性质 | 值 |
| --- | --- |
| 模式 | 交互式：解释 → 确认 → 应用，一次一步 |
| 失败 | 未知 CLI 选项时 fail closed |
| 保留 | 既有真相文件（不会盖掉） |
| 拒绝 | 不支持的 bootstrap contract 版本 |

### `nimicoding clear`

只移除 `AGENTS.md` 与 `CLAUDE.md` 里被管理的 AI 块；只移除跟种子完全一致的、包拥有的 bootstrap 文件。

| 性质 | 值 |
| --- | --- |
| 保留 | 项目自己的真相、被本地改过的 bootstrap 文件、`.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**` |
| 拒绝 | 隐式删除项目自己的真相或本地工件 |

### `nimicoding doctor`

校验 `.nimi/**` bootstrap 种子是否就位、合同兼容性、生命周期 marker、跨合同引用是否一致、host-adapter 边界真相、命名 overlay 状态、准入的包拥有 adapter profile overlay，等等。

| 输出 | 人类可读 或 `--json` |
| 失败 | 生命周期、规范化树、可审计性出现漂移时 fail closed |

## Topic 生命周期

`topic` 命令族管理 `.nimi/topics/{proposal,ongoing,pending,closed}/` 下的 topic 文件夹。它能创建 topic、添加和选择 wave、准入 wave、冻结 packet、dispatch worker 或 audit packet、记录类型化结果、处理 remediation / overflow，并最终闭 wave 或闭 topic。

机械推进入口是：

```bash
nimicoding topic run-next-step <topic-id> --json
```

如果要连续推进，用带明确 run id 和 adapter 的 `topic-runner step` 或 `topic-runner run`。Packet id 建议带上 wave 身份，例如 `wave-1-add-reference-field`；这样生成出来的 `packet-*.md` 在 topic 文件夹里不会跟别的 lifecycle 工件混淆。

## Sweep audit

`sweep audit` 命令族把一个目标根拆成可审计 chunk，负责 dispatch chunk、ingest auditor 证据、记录 manager review、生成不可变 ledger，并映出 remediation map 或 closeout summary。

`plan` 的 JSON 输出给的是 chunk artifact ref。具体 `chunk_id` 在 chunk 文件里，planner 生成的默认形状是 `chunk-001`。

## Sweep design

`sweep design` 在审计已经产出 findings 之后使用。它读取 `.nimi/local/audit/evidence/<sweep-id>/findings.yaml`，把 findings 复制到 `.nimi/local/sweep-design/<run-id>/` 下作为设计工作集，再把原始审计结果整理成可以准入 topic wave 的候选计划。

它不会改原始 findings。Codex 或其他宿主会用它构建设计审计 packet、生成审计 prompt、ingest 类型化设计审计结果、追加 revision ledger、校验 provenance、生成本地 final state report，再生成不直接改 topic 的 wave plan。`result-ingest` 可以接 focused 或 all 模式的审计结果，但 topic wave 单独准入之前，仍然不会允许 worker dispatch。

| 阶段 | 作用 |
| --- | --- |
| `intake` | 把审计 findings 复制成设计工作集 |
| `packet-build` | 为一个或多个 finding 构建设计审计 packet |
| `packet-build-batch` | 生成一组设计审计 packet 的 manifest |
| `auditor-prompt` | 输出 packet 对应的 prompt 和结果形状 |
| `result-ingest` | ingest 类型化设计审计结果并追加 revision |
| `ledger-validate` | 校验 revision ledger 和 final outcome provenance |
| `finalize` | 生成本地专用 final state report |
| `wave-plan` | 输出候选 topic 命令，但不改 topic 状态 |

## 技能 Handoff

### `nimicoding handoff --skill <skill-id> --json`

导出机器可读的外部 handoff payload。带上 `--prompt` 还会打印人类可读的宿主简报。

| 性质 | 值 |
| --- | --- |
| Skill | 必填（`spec_reconstruction` / `doc_spec_audit` / `audit_sweep` / `high_risk_execution`） |
| 输出 | 权威 JSON payload |
| 宿主姿态 | 厂商中立；支持任何准入宿主（Claude、Codex、Gemini、OMX 等） |
| 拒绝 | 规范化树就绪之前的 `doc_spec_audit` 与 `high_risk_execution` |

### `nimicoding closeout --skill --outcome --verified-at`

把外部技能结果映射成本地专用的 closeout payload。可选 `--write-local`，写到 `.nimi/local/handoff-results/` 下。

| 性质 | 值 |
| --- | --- |
| 校验 | Closeout 结果必须通过类型化合同 |
| 失败 | 结果跟规范化树状态矛盾、或引用越出声明的本地工件根，fail closed |
| 仅本地 | 永远不升格为项目语义真相 |

## 高风险执行

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`

只接 `nimicoding.high-risk-decision.v1` payload，且 `decisionStatus: manager_decision_recorded`。映射规范化准入预览。带显式 `--write-spec` 才写跟踪的语义真相。

### `nimicoding ingest-high-risk-execution --from <json>`

只接 `high_risk_execution` closeout 工件，且 `outcome: completed`、`summary.status: candidate_ready`。机器校验引用工件；映射本地 ingest payload。

### `nimicoding review-high-risk-execution --from <json>`

只接 `ok: true` 的 ingest payload。映射出 review 就绪的附件，给 manager 的 review 用。带上附件引用与 ingest 校验证据。

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`

只接 `ok: true`、`reviewStatus: ready_for_manager_review` 的 review payload。机器校验 acceptance 工件。要求带 `Disposition:` 行。映射本地专用的 manager 决策。

## 机器校验器

按工件分的校验器，发出机器可读的 `validator-cli-result.v1` JSON。

| 校验器 | 校验对象 |
| --- | --- |
| `execution-packet` | 冻结 packet 形态 |
| `orchestration-state` | 编排状态记录 |
| `prompt` | Prompt payload |
| `worker-output` | Worker 输出形态 |
| `acceptance` | 接受度证据 |

| 性质 | 值 |
| --- | --- |
| 必须传路径 | 是 |
| 输出 | 成功或拒绝时都给 JSON |
| 失败 | 缺必填段、YAML 形态错、种子合同漂移时 fail closed |

## Spec 审计

### `nimicoding validate-spec-tree`

校验 `.nimi/spec` 下规范化树结构。

### `nimicoding validate-spec-audit`

校验 `.nimi/spec/_meta/spec-generation-audit.yaml` 下每个文件的 grounding、推断、未解决 gap 跟踪。

### `nimicoding blueprint-audit`

把 repo 里的 blueprint 根跟 `.nimi/spec` 下的候选规范化树做对照。显式等价审计；不做路由变更。

## 阅读场景：第一次 bootstrap

你第一次在一个项目里装 Nimi Coding。

```
nimicoding start
```

CLI 一步一步带你：

1. 检测项目状态。
2. 确认或接受被管理的 AI 入口（`AGENTS.md`、`CLAUDE.md` 块）。
3. 用包拥有的源给 `.nimi/**` 种子。
4. 准备一份权威 JSON AI 任务包，跑 `spec_reconstruction`。
5. 打印一段可粘贴的 prompt，给你选择的 AI 宿主用。

你把 prompt 喂给 AI 宿主；宿主跑重建；你用 `nimicoding closeout` 把结果传回来。

## 阅读场景：跑一轮高风险执行

你的项目已经有规范化 spec 了，要做一次实质的 AI 编程工作。

| 步骤 | 命令 |
| --- | --- |
| 1. Manager admit packet | （手动；topic.yaml + packet 工件） |
| 2. 实现前审计（如有需要） | （宿主跑审计；结果记下来） |
| 3. 把工作 hand off 给宿主 | `nimicoding handoff --skill high_risk_execution --json` |
| 4. 宿主执行；返结果 | （宿主侧） |
| 5. Ingest 结果 | `nimicoding ingest-high-risk-execution --from result.json` |
| 6. Review | `nimicoding review-high-risk-execution --from ingest.json` |
| 7. Manager 决策 | `nimicoding decide-high-risk-execution --from review.json --acceptance accept.md --verified-at ...` |
| 8. Closeout | （手动；closeout 工件） |

每一步都受 CLI 类型化校验框住。漏一步、或者把字段偷偷塞进去，CLI 都拒绝。

## CLI 不做什么

| 关注 | 为什么不做 |
| --- | --- |
| 自动 packet 执行 | 宿主 AI 拥有执行 |
| 调 Provider | 包不调 AI provider |
| 调度 | 调度是宿主的事 |
| 通知 | UX 是宿主的事 |
| 自更新 | 在独立范围之外 |

这些是显式推迟的表面。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)（CLI 段）
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)（CLI 实现）
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
