# 技能

Nimi Coding 包声明了四个**技能**。每个技能都是一个强类型表面，由已准入的外部 AI 宿主负责履行。技能就是宿主在 Nimi Coding 治理下做事的正式契约。

## 四个技能

| 技能 | 是否必需 | 用途 |
| --- | --- | --- |
| `spec_reconstruction` | 是 | 把项目现有内容重建为 `.nimi/spec/**` 下的规范权威树 |
| `doc_spec_audit` | 是 | 对照 `.nimi/spec/**` 检查人写的文档 |
| `audit_sweep` | 否 | 跑一次全覆盖审计 sweep，输出已冻结的 finding 账本 |
| `high_risk_execution` | 否 | 项目真相成熟之后做 packet 化执行 |

## `spec_reconstruction`（必需）

新项目最先要跑的技能。它把项目当前的混合内容（散落的代码、文档、ADR、README）转换为 `.nimi/spec/**` 下的规范权威树。

| 输入 | 输出 |
| --- | --- |
| 混合输入（代码、文档、目录结构、人类笔记） | `.nimi/spec/**` 规范树以及 `.nimi/spec/_meta/spec-generation-audit.yaml` |

| 属性 | 取值 |
| --- | --- |
| 触发时机 | `bootstrap_only` |
| 输出规则 | 每条生成的规范条目都必须有显式来源依据，或显式标注未解决缺口 |
| 硬性约束 | 不允许"写给人看的并行真相" |

重建不可凭空生成。每一条生成规则要么有明确来源依据，要么有明确的缺口跟踪。

## `doc_spec_audit`（必需）

重建完成之后，这个技能拿人写的文档对照规范树做核查，识别漂移。

| 输入 | 输出 |
| --- | --- |
| 人写文档 + 规范树 | 漂移 finding 账本 |

文档与规范不一致是一条 finding。文档复述规范没问题。文档与规范矛盾是严重 finding。

## `audit_sweep`（可选）

对项目做全覆盖的审计 sweep，输出冻结的 finding 账本。

| 输入 | 输出 |
| --- | --- |
| 项目语料 | finding 账本（已冻结） |

"冻结"这个性质是账本可作为证据的关键。sweep 结果一经记录，之后不可再编辑。

## `high_risk_execution`（可选）

在项目真相成熟之后做 packet 化执行。这是方法论真正面向的技能：需要四闭合框架的高风险工作。

| 输入 | 输出 |
| --- | --- |
| 已冻结的执行 packet | worker 输出 + 证据 |

`high_risk_execution` 一次执行消费一份冻结 packet，产出 closeout 步骤可核验的输出。

| 属性 | 取值 |
| --- | --- |
| 触发时机 | `.nimi/spec/**` 已具备规范树 |
| 责任方 | manager（准入此次执行） |
| 审计方 | 独立 auditor（按角色分离） |

## 技能如何派发

包提供的 `nimicoding handoff` 命令输出一份机器可读的权威 handoff payload。

| 字段 | 取值 |
| --- | --- |
| `--skill <skill-id>` | 必填 |
| `--json` | 权威 payload |
| `--prompt` | 可选的人类可读宿主简报 |

宿主消费 JSON、跑这个技能、返回结果。包用 `nimicoding closeout` 在强类型契约校验下接收结果。

## 技能结果契约

每个技能都按强类型契约接收结果。

| 技能 | 结果契约 |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |
| `high_risk_execution` | `.nimi/contracts/high-risk-execution-result.yaml` |

不符合契约的结果在准入时 fail closed。没有"软通过"。

## 场景：新项目跑一次 `spec_reconstruction`

某团队采用 Nimi Coding，项目现有内容很混杂，还没有规范树。

1. **执行 `nimicoding start`**，bootstrap 准入。
2. **项目选定宿主**：选一个适配 overlay（Codex、Claude、oh-my-codex 等）。
3. **执行 `nimicoding handoff --skill spec_reconstruction --json`**：包输出 handoff payload。
4. **宿主消费 payload**：在已准入的契约下重建规范树。
5. **宿主返回结果**：包通过 `nimicoding closeout` 接收。
6. **强类型校验**：每条生成规则必须有来源依据或缺口跟踪，否则拒绝。
7. **规范树就绪**：项目可以进入高风险工作的方法论流程。

整个重建是**厂商中立**的——任何满足 host-class 能力要求的已准入宿主都能完成。

## 场景：`audit_sweep` 输出 finding 账本

某团队希望对项目做一次方法论级别的全覆盖审计。

1. **执行 `nimicoding handoff --skill audit_sweep --json`**。
2. **宿主跑 sweep**：在已准入的读范围内读项目，输出强类型 finding。
3. **finding 账本冻结**：结果记录在册，之后不可编辑。
4. **manager 复核**：把强类型 finding 用到下一波 wave 准入决策。

账本是证据。后续审计可以拿它作对照基线。

## 场景：一次 `high_risk_execution`

某团队希望在方法论下做一次实质 AI 编码工作。

1. **manager 准入 packet**：所有必填字段写齐并冻结。
2. **实施前审计**：若 `authority_convergence` 闸门触发，跑审计并记录 PASS。
3. **执行 `nimicoding handoff --skill high_risk_execution --json`**：把 packet 交给宿主。
4. **宿主执行**：受 packet 约束，产出输出。
5. **结果返回**：包做结果契约校验。
6. **实施后判定**：独立回路复核并记录判定。
7. **closeout**：核验四闭合维度。
8. **wave 关闭**或退回修订。

这是完整执行流程。每一步都经过准入，没有一步是隐式的。

## 技能不会做的事

| 操作 | 是否禁止 |
| --- | --- |
| 在包内部跑 AI 推理 | 禁止——运行时归宿主 |
| 未经准入改写项目规范真相 | 禁止 |
| 输出无来源依据 | 禁止（`spec_reconstruction` 强制要求来源依据或缺口跟踪） |
| 宿主能力检查失败仍继续 | 禁止（fail closed） |

## 来源依据

- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skill-manifest.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
