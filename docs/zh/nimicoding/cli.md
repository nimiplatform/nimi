# CLI 表面

`nimicoding` CLI 是一组小而有界的命令。包是有意做成**边界完整、不是执行完整**：CLI 负责 bootstrap、校验、把工件映出来，但它**不**自动跑 packet。

每条命令的字段级参考在 [Reference → CLI Commands](/zh/nimicoding/reference/cli-commands)。

## 命令分类

CLI 的动词分成几类：

| 类别 | 命令 |
| --- | --- |
| Bootstrap | `start`、`clear`、`doctor` |
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
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
