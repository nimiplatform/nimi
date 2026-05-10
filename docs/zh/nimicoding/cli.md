# CLI Surface

`nimicoding` CLI 是一组小而有界的命令。这个包刻意做成**边界完整、但不自主执行**：CLI 负责引导、校验和生成工件，不替你跑 packet。

每个命令的字段级参考见 [Reference → CLI Commands](/zh/nimicoding/reference/cli-commands)。

## 命令分类

CLI 的命令分成几类：

| 分类 | 命令 |
| --- | --- |
| Bootstrap | `start`、`clear`、`doctor` |
| Topic 生命周期 | `topic create`、`topic wave ...`、`topic packet freeze`、`topic worker dispatch`、`topic result record`、`topic closeout ...`、`topic true-close-audit` |
| Topic runner | `topic run-next-step`、`topic-runner step`、`topic-runner run` |
| Sweep audit | `sweep audit plan`、`sweep audit chunk ...`、`sweep audit ledger build`、`sweep audit remediation-map build`、`sweep audit closeout summary`、`sweep audit status` |
| Sweep design | `sweep design intake`、`sweep design packet-build`、`sweep design packet-build-batch`、`sweep design auditor-prompt`、`sweep design result-ingest`、`sweep design ledger-validate`、`sweep design finalize`、`sweep design wave-plan` |
| Skill handoff | `handoff`、`closeout` |
| 高风险执行 | `admit-high-risk-decision`、`ingest-high-risk-execution`、`review-high-risk-execution`、`decide-high-risk-execution` |
| 机械校验器 | 针对 `execution-packet`、`orchestration-state`、`prompt`、`worker-output`、`acceptance` 的逐工件校验器 |
| 规范审计 | `validate-spec-tree`、`validate-spec-audit`、`blueprint-audit` |
| 仓库门禁 | `pnpm check:spec-authority-cutover-readiness`（通过宿主仓库的工具链） |

每一个都有严格边界，新增命令需要先扩展已准入的契约。

## Bootstrap

### `nimicoding start`

侦测项目当前状态，把包内 source 映射到宿主路径，写入 `.nimi/**` seed，准备一份权威 JSON 任务包，并打印可粘贴的提示词。

| 属性 | 值 |
| --- | --- |
| 模式 | 交互式：解释 → 确认 → 应用，一次一步 |
| 失败行为 | 遇未知 CLI 选项 fail closed |
| 保留 | 已有的真相文件，不会覆写 |
| 拒绝 | 不支持的 bootstrap 契约版本 |

### `nimicoding clear`

只移除 `AGENTS.md` 与 `CLAUDE.md` 中的受管 AI 区块；只在文件仍与 seed 完全一致时移除包自有 bootstrap 文件。

| 属性 | 值 |
| --- | --- |
| 保留 | 项目自有真相、本地修改过的 bootstrap 文件、`.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**` |
| 拒绝 | 隐式删除项目自有真相或本地工件 |

### `nimicoding doctor`

校验 `.nimi/**` bootstrap seed 是否就位、契约兼容性、生命周期标记、跨契约引用一致性、host-adapter 边界真相、命名 overlay 状态、以及已准入的包自有 adapter profile overlay。

| 属性 | 值 |
| --- | --- |
| 输出 | 人类可读，或 `--json` |
| 失败行为 | 当生命周期、规范树和审计性出现漂移时 fail closed |

## Topic 生命周期

`topic` 命令家族管理 `.nimi/topics/{proposal,ongoing,pending,closed}/` 下的 topic 文件夹。它创建 topic、添加和选中 wave、准入 wave、冻结 packet、派发 worker 或 audit packet、记录强类型结果、处理修复和溢出，最后关闭 wave 或 topic。

机械化推进的入口是：

```bash
nimicoding topic run-next-step <topic-id> --json
```

如果要重复执行，用 `topic-runner step` 或 `topic-runner run`，并显式带上 run-id 与 adapter。Packet id 应当带上 wave 标识，比如 `wave-1-add-reference-field`，这样生成的 `packet-*.md` 在 topic 文件夹里不会产生命名歧义。

## Sweep Audit

`sweep audit` 命令家族把目标根目录拆成可审计的分块，派发分块、接收审计员证据、记录管理者复核、构建不可变账本，并输出修复地图或关闭摘要。

Plan 输出会报告分块工件引用。分块 id 存在分块文件里，按 planner 生成的 `chunk-001` 形态命名。

## Sweep Design

`sweep design` 命令家族在 sweep 产生 finding 之后启动。它读取 `.nimi/local/audit/evidence/<sweep-id>/findings.yaml`，把这些 finding 复制一份到 `.nimi/local/sweep-design/<run-id>/`，再把原始审计输出转成可以变成 topic wave 的规划工件。

它不会改原始 finding。它会请求 Codex 或其他宿主对界限明确的 finding packet 做检查，返回强类型的设计审计员结果，追加修订账本条目，校验账本，定稿仅本地可见的设计状态，并构建一份不会改写状态的 wave 规划。结果摄入接受 focused 或 all 两种模式的审计员输出，但在 topic wave 单独准入之前，worker dispatch 仍然不被允许。

| 阶段 | 角色 |
| --- | --- |
| `intake` | 把审计 finding 复制到一份设计工作集 |
| `packet-build` | 为一个或多个 finding 构建设计审计员 packet |
| `packet-build-batch` | 构建一份设计审计员 packet 的清单 |
| `auditor-prompt` | 输出某 packet 的提示词与必需的结果形态 |
| `result-ingest` | 接收强类型的设计审计员结果并追加修订 |
| `ledger-validate` | 校验修订账本和最终结论的血缘 |
| `finalize` | 输出仅本地可见的最终状态报告 |
| `wave-plan` | 输出候选的 topic 命令引用，不改写 topic 状态 |

## Skill Handoff

### `nimicoding handoff --skill <skill-id> --json`

导出一份机器可读的外部交接 payload。带 `--prompt` 时还会打印一段给宿主看的人类可读简报。

| 属性 | 值 |
| --- | --- |
| Skill | 必填（`spec_reconstruction` / `doc_spec_audit` / `audit_sweep` / `high_risk_execution`） |
| 输出 | 权威 JSON payload |
| 宿主姿态 | 厂商中立；支持任何已准入宿主（Claude、Codex、Gemini、OMX 等） |
| 拒绝场景 | 规范树尚未就绪时拒绝 `doc_spec_audit` 和 `high_risk_execution` |

### `nimicoding closeout --skill --outcome --verified-at`

把外部技能结果转成仅本地可见的 closeout payload。可选 `--write-local` 写入 `.nimi/local/handoff-results/`。

| 属性 | 值 |
| --- | --- |
| 校验 | closeout 结果必须通过强类型契约 |
| 失败行为 | 结果与规范树状态相悖、引用越出声明的本地产物根等情况下 fail closed |
| 仅本地 | 不会被提升为项目语义真相 |

## 高风险执行

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`

只接受 `nimicoding.high-risk-decision.v1` payload，且 `decisionStatus: manager_decision_recorded`。生成权威准入预览。需要显式 `--write-spec` 才会写入受跟踪的语义真相。

### `nimicoding ingest-high-risk-execution --from <json>`

只接受 `high_risk_execution` 的 closeout 工件，且 `outcome: completed`、`summary.status: candidate_ready`。机械校验引用工件，输出仅本地可见的 ingest payload。

### `nimicoding review-high-risk-execution --from <json>`

接受 `ok: true` 的 ingest payload。生成供管理者复核的附件，附件携带引用与摄入校验证据。

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`

接受 `ok: true` 且 `reviewStatus: ready_for_manager_review` 的 review payload。机械校验 acceptance 工件，必须含 `Disposition:` 行。生成仅本地可见的管理者决策记录。

## 机械校验器

逐工件校验器统一输出机器可读的 `validator-cli-result.v1` JSON。

| 校验器 | 校验对象 |
| --- | --- |
| `execution-packet` | 已冻结的 packet 形态 |
| `orchestration-state` | 编排状态记录 |
| `prompt` | prompt payload |
| `worker-output` | worker 输出形态 |
| `acceptance` | acceptance 证据 |

| 属性 | 值 |
| --- | --- |
| 路径必填 | 是 |
| 输出 | 成功或拒绝时统一输出 JSON |
| 失败行为 | 缺少必需段落、YAML 格式错误、seed 契约 drift 时 fail closed |

## 规范审计

### `nimicoding validate-spec-tree`

校验 `.nimi/spec` 下规范树的结构。

### `nimicoding validate-spec-audit`

校验 `.nimi/spec/_meta/spec-generation-audit.yaml` 中的逐文件 grounding、推断和未解决缺口跟踪。

### `nimicoding blueprint-audit`

把仓库本地的 blueprint 根与 `.nimi/spec` 下的候选规范树做对比。这是一次显式的等价性审计，不会改路由。

## 场景：第一次 bootstrap

你第一次在某个项目里安装 Nimi Coding。

```
nimicoding start
```

CLI 会带你走完：

1. 侦测项目状态。
2. 确认或接受受管 AI 入口（`AGENTS.md`、`CLAUDE.md` 区块）。
3. 用包自有的 source 写入 `.nimi/**` seed。
4. 为 `spec_reconstruction` 准备一份权威 JSON 任务包。
5. 打印可粘贴的提示词，给你选定的 AI 宿主用。

你把提示词交给 AI 宿主；宿主跑重建；你用 `nimicoding closeout` 回填结果。

## 场景：一次完整的高风险执行

项目已经有完整规范，你要跑一次实质的 AI 编码工作。

| 步骤 | 命令 |
| --- | --- |
| 1. 管理者准入 packet | （手工；topic.yaml + packet 工件） |
| 2. 实施前审计（如需） | （宿主跑审计，记录结果） |
| 3. 交接给宿主 | `nimicoding handoff --skill high_risk_execution --json` |
| 4. 宿主执行并返回 | （宿主侧） |
| 5. 摄入结果 | `nimicoding ingest-high-risk-execution --from result.json` |
| 6. 复核 | `nimicoding review-high-risk-execution --from ingest.json` |
| 7. 管理者裁定 | `nimicoding decide-high-risk-execution --from review.json --acceptance accept.md --verified-at ...` |
| 8. 关闭 | （手工；closeout 工件） |

每一步都受 CLI 的强类型校验约束。跳步或夹带字段，CLI 会直接拒绝。

## CLI 不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 自主执行 packet | 执行权归宿主 AI |
| 调用 provider | 包不直接调用 AI provider |
| 调度器 | 调度由宿主负责 |
| 通知 | UX 由宿主负责 |
| 自动更新 | 超出独立包的范围 |

这些都是显式被推迟的能力面。

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)（CLI 章节）
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
