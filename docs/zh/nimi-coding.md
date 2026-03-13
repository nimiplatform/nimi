# Nimi Coding

> Status: Active
> Version: 1.0
> Maintainer: @snowzane
> Created: 2026-03-03
> Last Updated: 2026-03-12
> Scope: Nimi 对外方法论
> Language: 中文为主，关键术语保留英文
> Legacy Alias: Oriented-AI Spec Coding

---

## Part A — Method Definition & Design Goals

### A1. 定义

**Nimi Coding** 是一种围绕 AI 可读、可强制、分层且可交叉校验的事实源进行软件开发的方法。  
它把这套事实源体系升级为面向 AI 主执行者（AI-first executor）的可执行治理系统，并要求以下顺序成为默认路径：

`Rule -> Table -> Generate -> Check -> Evidence`

其中：

1. `Rule`：定义不变量和跨域契约。
2. `Table`：将可结构化事实落入机器可验证的数据层。
3. `Generate`：由事实源自动生成可读投影视图。
4. `Check`：用确定性脚本守护一致性与漂移。
5. `Evidence`：以命令结果和审计记录闭环变更。

### A2. 适用场景

该方法适用于以下工程环境：

1. 规则复杂、跨模块耦合高的系统。
2. 多团队协作、需要统一语义边界的组织。
3. 由 AI agent 作为主要实现者或协作者的流程。
4. 要求高可追溯性、高一致性、高回归防护的交付链路。

### A3. 非目标（Out of Scope）

本方法不直接解决：

1. 商业策略本身的正确性判断。
2. 法律结论（仅提供工程治理建议，不构成法律意见）。
3. 组织政治与职责冲突的管理问题。
4. 对“无需规范即可低成本交付”的一次性原型场景。

### A4. 设计目标（Design Goals）

1. **Decision Complete**：实现者不再承担隐性决策负担。  
2. **Machine Verifiable**：核心规则可被脚本确定性验证。  
3. **Traceable**：任一行为可追溯到 Rule ID 与证据链。  
4. **Regress-resistant**：缺陷修复可固化为长期守护规则。  
5. **Portable**：可迁移到不同仓库与技术栈。  

---

## Part B — Core Axioms

### B1. One Fact One Home

同一事实只能有一个权威来源。  
投影、摘要、教程、代码注释都不是事实源本体。

### B2. Contract-first / Table-first / Projection-last

1. 先定义契约（Contract）。  
2. 再维护结构化事实（Table）。  
3. 最后生成可读投影（Projection）。  

禁止先改投影再回填事实源。

### B3. Deterministic Guard First

凡可机器化判定的规则，必须进入 CI/脚本守护，不允许长期依赖人工记忆。

### B4. Evidence over Assertion

“我认为已完成”不构成完成。  
必须提交可复现证据：

1. 执行命令。
2. 输出结果。
3. 未执行项与原因。

### B5. Stable Anchors

规则必须有稳定锚点（如 Rule ID）。  
跨文档、跨表、跨检查脚本都应依赖锚点，而不是依赖自然语言段落位置。

### B6. No Execution-State Pollution in Spec

规范性事实源只承载“应然契约”，不承载“某次执行状态”。  
执行状态应进入报告或计划文档，而非规范正文。

### B7. Gate-based Enforcement Language

本方法不使用 MUST/SHOULD 作为治理强度主表达，统一使用 Gate 分类：

1. **Hard Gate**：不过不能合并。  
2. **Soft Gate**：不过可合并，但必须记录风险与责任人。  
3. **Advisory**：建议项，仅做趋势跟踪与优化输入。  

---

## Part C — Artifact Architecture

### C1. 分层模型（Policy / Kernel / Domain / Tables / Generated / Report）

| Layer | 目标 | 产物特征 | 是否可手改 |
|---|---|---|---|
| Policy | 治理原则与红线 | Gate 分类与执行边界（Hard/Soft/Advisory） | 是 |
| Kernel | 跨域核心契约 | Rule ID + 不变量 | 是 |
| Domain | 业务域增量 | 引用 Kernel，不复述核心规则 | 是 |
| Tables | 结构化事实源 | YAML/JSON/Schema 等 | 是 |
| Generated | 机器生成视图 | 只读投影 | 否 |
| Report/Plan | 执行证据与过程 | 审计、计划、结果 | 是 |

### C2. 各层输入/输出与边界

1. `Policy -> Kernel`：治理原则定义 Gate 分类并约束规则写法。  
2. `Kernel -> Domain`：Domain 只做业务增量和规则引用。  
3. `Kernel + Tables -> Generated`：生成脚本读取事实源产出视图。  
4. `Check -> Report`：检查结果沉淀为审计证据。  

边界规则：

1. Domain 不定义跨域核心事实。  
2. Generated 不作为编辑入口。  
3. Report 不回写规范事实。  

### C3. 可追溯链路（Traceability）

标准追溯链路：

`Rule ID -> Table row -> Generated view -> Check rule -> Evidence record`

任一节点断裂都应被视为治理缺陷。

---

## Part D — Rule & Fact System Design

### D1. Rule ID 命名与编号策略

固定采用：

`AISC-<AREA>-NNN`

说明：

1. `<AREA>`：规则归属区域，`2-12` 位大写字母（例如 `CORE`、`FLOW`、`AUDIT`）。  
2. `NNN`：三位编号，不复用。  
3. 校验正则：`^AISC-[A-Z]{2,12}-[0-9]{3}$`。  

建议分段：

1. `001-009`：不变量。
2. `010-099`：增量段。
3. `100+`：扩展段与跨版本迁移保留位。

示例：

1. `AISC-CORE-001`
2. `AISC-FLOW-023`
3. `AISC-AUDIT-110`

### D2. 结构化事实表（Table）设计规范

建议字段（可按组织裁剪）：

| 字段 | 说明 |
|---|---|
| `id` | 行级唯一标识 |
| `name` | 业务语义名 |
| `value` | 枚举值或配置值 |
| `source_rule` | 来源 Rule ID |
| `status` | active/deprecated/draft |
| `version` | 语义版本 |
| `owner` | 维护责任人或责任组 |
| `updated_at` | 最后更新时间 |

硬约束：

1. 每条结构化事实必须包含 `source_rule`。  
2. `source_rule` 必须可解析到真实 Rule ID，且只允许 `AISC-*`。  
3. 缺失 `source_rule` 或格式不合法，直接判定为 `Hard Gate` 失败。  
4. 跨表引用必须可验证（ID 存在性、唯一性、类型合法性）。  
5. 表字段变更必须伴随检查规则升级。  

### D3. Generated 视图约束

1. Generated 文件必须声明“DO NOT EDIT”。  
2. 生成过程必须可重复（deterministic）。  
3. 需要 drift-check 命令，检查“事实源与投影”是否一致。  
4. 生成失败应阻断合并，不允许“先合后修”。  

---

## Part E — Execution Protocol (Change Lifecycle)

### E1. 变更分类

每个变更先归类为以下一种或多种：

1. `Rule Change`：契约条款变化。  
2. `Fact Change`：结构化事实变化。  
3. `Projection Change`：生成逻辑或可读视图变化。  
4. `Guard Change`：检查脚本规则变化。  

### E2. 标准顺序（Mandatory Order）

标准执行顺序固定为：

1. 更新 Rule。  
2. 更新 Table。  
3. 运行 Generate。  
4. 运行 Check。  
5. 输出 Evidence。  

任何跳步都需要明确豁免说明。

### E3. 失败处理（Failure Handling）

失败分级建议：

1. **Blocking**：违反核心不变量、规则无法解析、drift 未通过。  
2. **High**：跨表不一致、关键守护缺失。  
3. **Medium**：可读性缺陷或非关键覆盖缺口。  

处理策略：

1. Blocking：立即停止合并，优先修复。  
2. High：限定窗口内修复，并加回归守护。  
3. Medium：纳入计划并跟踪关闭。  

### E4. 决策闭环（Decision Closure）

每个变更必须具备：

1. 变更意图（Why）。  
2. 变更范围（What）。  
3. 执行顺序与命令（How）。  
4. 验收标准（Done）。  
5. 风险与回滚方案（Risk/Rollback）。  

---

## Part F — Two-Layer Quality Guard

### F1. Layer 1: CI Deterministic Guards

应覆盖的规则类型：

1. Rule ID 可解析性与唯一性。  
2. 表字段完整性与类型合法性。  
3. 跨表引用一致性。  
4. 事实源与生成视图漂移检测。  
5. 命名规范与禁用模式检测。  
6. 规则引用覆盖率（导入即引用）。  
7. 关键实现与规范映射校验（如常量/枚举/状态机对齐）。  

#### 现有检查清单（与方法论直接相关）

1. `check:runtime-spec-kernel-consistency`
2. `check:runtime-spec-kernel-docs-drift`
3. `check:sdk-spec-kernel-consistency`
4. `check:sdk-spec-kernel-docs-drift`
5. `check:desktop-spec-kernel-consistency`
6. `check:desktop-spec-kernel-docs-drift`
7. `check:future-spec-kernel-consistency`
8. `check:future-spec-kernel-docs-drift`
9. `check:platform-spec-kernel-consistency`
10. `check:platform-spec-kernel-docs-drift`
11. `check:realm-spec-kernel-consistency`
12. `check:realm-spec-kernel-docs-drift`
13. `check:spec-human-doc-drift`
14. `check:scope-catalog-drift`
15. `check:runtime-bridge-method-drift`

#### 最小 Hard Gate（准入规则）

1. 受影响域 `consistency` 必过。  
2. 受影响域 `docs-drift` 必过。  
3. 全局 `spec-human-doc-drift` 必过。  
4. `scope-catalog-drift` 作为跨域映射 Hard Gate。  
5. `runtime-bridge-method-drift` 作为接口投影漂移 Hard Gate（按改动触发）。  

### F2. Layer 2: Semantic Audit

语义审计用于 CI 难自动化的问题：

1. 设计合理性（策略、性能、韧性）。  
2. 规范完整性（是否遗漏约束维度）。  
3. 跨域一致性（术语、状态语义、错误语义）。  
4. 演进路径可行性（迁移成本、兼容策略）。  

约束：

1. 语义审计不能替代 CI。  
2. 可机器化的问题必须回流到 Layer 1。  

### F3. 双向 Audit 模型（Bi-directional Audit）

双向 Audit 由两条审计通道组成：

1. `Lane A: Spec -> Impl`：规范是否被实现。  
2. `Lane B: Impl -> Spec`：实现变化是否回写规范。  

治理角色：

1. LLM/自动化负责持续审计。  
2. Human 作为最终裁决层（Final Arbiter）。  

触发机制：

1. 事件驱动，不固定周期。  
2. 触发事件包含：  
  - Kernel/Table 变更  
  - 重大功能合并  
  - 发布前冻结窗口  

### F4. 缺陷回流机制（Defect Backflow）

标准回流流程：

1. 发现缺陷。  
2. 判定是否可机器化。  
3. 可机器化：补脚本规则 + 修复缺陷。  
4. 不可机器化：记录语义审计条目与复审条件。  
5. 复盘后更新模板与检查清单。  

---

## Part G — Templates & Playbooks

### G1. PR 模板（通用）

```md
## Change Summary
- Change Type: Rule / Fact / Projection / Guard
- Affected Areas: ...
- Rule IDs: ...

## Files
- Contract files:
- Fact tables:
- Generated views:
- Guard scripts:

## Execution
1. `<generate-command>`
2. `<consistency-check-command>`
3. `<drift-check-command>`

## Gate Results
- Hard Gate: PASS / FAIL
- Soft Gate: PASS / FAIL (if FAIL, risk owner required)
- Advisory: observations / trend notes

## Results
- PASS:
- FAIL:
- Not Run (reason):

## Risks
- Compatibility:
- Rollback:
```

### G2. 审计报告模板（通用）

```md
# Spec Audit Report
Date: YYYY-MM-DD
Scope: ...

## Evidence
- Commands:
  - `<command-1>`
  - `<command-2>`
- Inputs:
  - `<file-or-module-1>`

## Findings
### Blocking
1. ...

### High
1. ...

### Medium
1. ...

## Bi-directional Audit
- Lane A (Spec -> Impl):
- Lane B (Impl -> Spec):
- Human Verdict (Final Arbiter): PASS / CONDITIONAL PASS / FAIL

## Recommended Actions
1. ...
2. ...

## Acceptance Criteria
- [ ] ...
- [ ] ...
```

### G3. 新规则引入模板（Rule/Table/Check 同步）

```md
## New Rule
- Rule ID: `AISC-<AREA>-NNN`
- Contract location: `<kernel-file>`
- Intent: ...

## Fact Impact
- Table: `<table-file>`
- Fields changed: ...
- source_rule mapping: `AISC-*` (required on every structured fact row)

## Projection Impact
- Generated target: `<generated-file>`
- Regeneration required: yes/no

## Guard Impact
- Existing checks affected: ...
- New deterministic check needed: yes/no
- Check logic summary: ...

## Verification
1. `<generate-command>`
2. `<consistency-check-command>`
3. `<drift-check-command>`
```

### G4. 迁移模板（文档型规范 -> 可执行规范）

```md
## Migration Plan
Phase 1: Inventory
- Collect all existing normative statements.
- Identify duplicated facts and conflicting definitions.

Phase 2: Kernelization
- Move cross-domain rules into Kernel contracts.
- Assign stable Rule IDs using `AISC-<AREA>-NNN`.

Phase 3: Structuring
- Convert enumerable facts into Tables.
- Add `source_rule` for every table row (must reference `AISC-*`).

Phase 4: Automation
- Introduce Generate pipeline.
- Introduce Consistency + Drift checks.

Phase 5: Governance
- Define PR evidence policy.
- Define semantic audit cadence and backflow rules.
```

---

## Part H — Anti-Patterns & Red Lines

### H1. 红线（Red Lines）

1. 手工修改 Generated 视图。  
2. 在多个位置重复定义同一事实。  
3. 只做语义审计，不做确定性守护。  
4. 变更无证据链直接合并。  
5. 把执行态快照写进规范正文。  

### H2. 常见误区（Anti-Patterns）

1. “局部检查通过”被误判为“全局安全”。  
2. 只改说明文案，不改事实源与守护脚本。  
3. 规则变更后未更新 source_rule 绑定。  
4. 依赖个人经验解释规则而非规则文本本身。  

### H3. 演进治理（Phase / Deferred / Deprecation）

建议策略：

1. `Phase`：定义约束级别（Draft/Normative/Frozen）。  
2. `Deferred`：显式记录推迟项、触发条件、复审时间。  
3. `Deprecation`：定义弃用窗口、迁移路径、删除门槛。  
4. 每次状态变更都要有证据和责任归属。  

---

## Appendix

### Appendix A — Glossary

| Term | Definition |
|---|---|
| Spec-first | 先定义契约再实现 |
| Kernel | 跨域权威规则层 |
| Domain | 业务域增量层 |
| Table | 结构化事实源 |
| Generated | 由事实源生成的只读视图 |
| Drift | 事实源与投影不一致 |
| Consistency | 规则、事实、引用间的一致性 |
| Evidence | 命令输出与审计记录组成的证据链 |
| Semantic Audit | 非确定性语义层审计 |
| Hard Gate | 检查失败即禁止合并 |
| Soft Gate | 检查失败可合并，但必须记录风险与责任人 |
| Advisory | 建议项，主要用于趋势跟踪与优化输入 |
| Lane A | Spec -> Impl 审计通道 |
| Lane B | Impl -> Spec 审计通道 |

### Appendix B — 90 天最小落地路线图（L1/L2/L3）

#### L1（Day 1-30）：建立骨架

1. 建立 Kernel/Domain/Table/Generated 基础分层。  
2. 选 1 个核心域试点 `AISC-<AREA>-NNN` + Table-first。  
3. 建立最小 Generate 与 Drift-check。  

#### L2（Day 31-60）：强化守护

1. 扩展 Consistency checks（引用、跨表、命名约束）。  
2. 建立审计报告模板与 PR 证据模板。  
3. 对高风险路径建立强制 Blocking 规则。  

#### L3（Day 61-90）：组织化运行

1. 全域接入 Two-Layer Guard。  
2. 建立语义缺陷回流到脚本的标准机制。  
3. 固化季度复盘：规则覆盖率、回归率、变更吞吐。  

### Appendix C — 文档维护规则

1. 本文维护对象是“方法论设计”，不是项目执行快照。  
2. 版本升级必须说明新增公理、流程或模板变化。  
3. 若引入新层级或新守护机制，需同步更新 Part C/F/G。  
4. 所有示例保持项目无关；仅在明确说明基线检查清单时，可显式列出命令。  
