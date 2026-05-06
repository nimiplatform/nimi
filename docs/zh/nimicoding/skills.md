# 技能

Nimi Coding 包准入了四个**声明技能**。每个技能是一份类型化表面，由准入的外部 AI 宿主来实现。技能是宿主执行 Nimi Coding 治理下工作所走的形式合同。

## 四个技能

| 技能 | 必需 | 用途 |
| --- | --- | --- |
| `spec_reconstruction` | 是 | 把项目规范化树重建到 `.nimi/spec/**` |
| `doc_spec_audit` | 是 | 把人写的文档跟 `.nimi/spec/**` 对照 |
| `audit_sweep` | 否 | 做全覆盖审计扫描，发出一份冻结的 finding 账本 |
| `high_risk_execution` | 否 | 项目真相成熟之后做 packet 化的执行 |

## `spec_reconstruction`（必需）

新项目跑的第一个技能。把项目当下手头的东西 —— 散乱的代码、零散的文档、ADR、README —— 转成一份规范化权威树，写在 `.nimi/spec/**` 下。

| 输入 | 输出 |
| --- | --- |
| 杂混输入（代码、文档、目录结构、人写笔记） | `.nimi/spec/**` 下的规范化树，加 `.nimi/spec/_meta/spec-generation-audit.yaml` |

| 性质 | 值 |
| --- | --- |
| 触发 | `bootstrap_only` |
| 输出规则 | "每条生成的规范化文件都要有显式 source basis，并跟踪未解决的 gap" |
| 硬约束 | "no human-friendly parallel truth" |

重建不会凭空发明。每条生成的规则要么有显式 source basis，要么显式跟踪未解决的 gap。

## `doc_spec_audit`（必需）

重建之后，这个技能拿人写的文档跟规范化 spec 树对照。漂移检测。

| 输入 | 输出 |
| --- | --- |
| 人写文档 + 规范化 spec 树 | 漂移 finding 账本 |

文档跟 spec 漂的，是一条 finding。文档复述 spec 的，没问题。文档跟 spec 矛盾的，是一条关键 finding。

## `audit_sweep`（可选）

对项目做全覆盖审计扫描，发出一份冻结的 finding 账本。

| 输入 | 输出 |
| --- | --- |
| 项目 corpus | Finding 账本（冻结） |

「冻结」这条性质让账本可以作为证据使用：扫描结果记下来之后，不会再被改。

## `high_risk_execution`（可选）

项目真相成熟之后跑 packet 化的执行。这个技能就是方法论真正为它而设计的那一类工作：需要四闭合框架来兜的高风险工作。

| 输入 | 输出 |
| --- | --- |
| 冻结的执行 packet | Worker 输出 + 证据 |

一次 `high_risk_execution` 跑消化一份冻结 packet，产出能让 closeout 步骤去核验的输出。

| 性质 | 值 |
| --- | --- |
| 触发 | `.nimi/spec/**` 已具备规范化树形态之后 |
| 拥有者 | Manager（admit 这次跑） |
| Auditor | 独立（按角色分离） |

## 技能怎么 dispatch

包的 `nimicoding handoff` 命令发出一份权威机器可读的 handoff payload。

| 字段 | 值 |
| --- | --- |
| `--skill <skill-id>` | 必填 |
| `--json` | 权威 payload |
| `--prompt` | 可选的人类可读宿主简报 |

宿主消化 JSON、跑技能、回结果。包用 `nimicoding closeout` 把结果在类型化合同核验下准入进来。

## 技能结果合同

每个技能在一份类型化合同下准入结果。

| 技能 | 结果合同 |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |
| `high_risk_execution` | `.nimi/contracts/high-risk-execution-result.yaml` |

不符合合同的结果，在准入时 fail closed。这里没有软接受。

## 阅读场景：新项目跑 `spec_reconstruction`

某团队采纳 Nimi Coding，项目里输入很杂、还没有规范化 spec。

1. **跑 `nimicoding start`。** Bootstrap 准入。
2. **项目挑宿主。** 选 adapter overlay（比如 Codex、Claude、oh-my-codex）。
3. **跑 `nimicoding handoff --skill spec_reconstruction --json`。** 包发出 handoff payload。
4. **宿主消化 payload。** 在准入合同下重建规范化树。
5. **宿主回结果。** 包通过 `nimicoding closeout` 准入。
6. **校验。** 每条生成的规则都得有 source basis 或 gap-tracking，否则拒。
7. **规范化树就位。** 项目现在可以采纳方法论做高风险工作。

重建是**厂商中立**的 —— 任何满足 host-class 能力的准入宿主都跑得起来。

## 阅读场景：`audit_sweep` 返回 finding 账本

某团队想在方法论下对项目做一次全覆盖审计。

1. **跑 `nimicoding handoff --skill audit_sweep --json`。**
2. **宿主跑扫描。** 在准入读范围下读项目；发出类型化 finding。
3. **Finding 账本冻结。** 结果记下来之后不可改。
4. **Manager review。** 类型化 finding 喂下一次 wave 准入决策。

账本就是证据。将来的审计可以拿它来对照。

## 阅读场景：`high_risk_execution` 跑一轮

某团队想在方法论下做实质 AI 编程工作。

1. **Manager admit packet。** 必填字段都冻结。
2. **实现前审计。** `authority_convergence` 门一旦启动，跑审计；记 PASS。
3. **跑 `nimicoding handoff --skill high_risk_execution --json`。** 把 packet hand off 给宿主。
4. **宿主执行。** 受 packet 框住；产出输出。
5. **结果回。** 包按结果合同校验。
6. **实现后判断。** 独立循环 review；记下 judgement。
7. **Closeout。** 评估四个闭合维度。
8. **Wave 闭合。** 或者退回修改。

这是完整执行流。每一步都被准入；没有隐式。

## 技能不做的事

| 技能动作 | 是否禁止 |
| --- | --- |
| 在包内部跑 AI 推理 | 是 —— 宿主拥有 runtime |
| 不经准入就改项目规范化真相 | 是 |
| 没 source basis 就生成输出 | 是（`spec_reconstruction` 要求 source basis 或 gap-tracking） |
| 宿主能力检查没过还继续 | 是（fail closed） |

## 来源

- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skill-manifest.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
