# CLI 命令

`nimicoding` CLI 的字段级参考。概念级总览见 [CLI 表面](/zh/nimicoding/cli)。

## Bootstrap 命令

### `nimicoding start`

| 性质 | 值 |
| --- | --- |
| 用途 | Bootstrap 或恢复项目状态 |
| 模式 | 交互 |
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
| `--verified-at` | 是 | ISO8601 UTC 时间戳 |
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
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
