# ParentOS Phase 1 设计审计报告

> 审计对象：`apps/parentos/dev/plan/phase-1-implementation-plan.md`
>
> 审计基线日期：2026-04-03
>
> 审计阶段：设计阶段，仅评估设计完整性、规范一致性、阶段边界与治理可执行性；不评价开发实现质量。

## 1. 审计范围

本次审计覆盖以下内容：

- Phase 1 计划文档本身的结构、边界与可执行性
- ParentOS 上游规范的一致性，包括：
  - `apps/parentos/spec/parentos.md`
  - `apps/parentos/AGENTS.md`
  - `apps/parentos/spec/INDEX.md`
  - `apps/parentos/spec/kernel/tables/*.yaml`
- 与设计治理直接相关的仓库级约束，包括：
  - 根 `AGENTS.md`
  - `kit/README.md`
  - `spec/platform/kernel/tables/nimi-kit-registry.yaml`

不在本次审计范围内：

- 代码实现是否正确
- 测试是否通过
- 运行时行为是否符合预期
- 外部权威知识源内容本身是否真实准确

## 2. 审计方法

本次审计采用静态设计审查，重点核对：

1. 计划文档与当前权威 spec/AGENTS 是否一致
2. 设计冻结条件是否已经决策完成
3. `Phase 1 / Phase 2` 边界是否被单一权威源约束
4. AI 门禁、知识源成熟度、`nimi-kit` 复用与跨 app 复用是否形成可执行治理
5. 计划文档是否符合 `dev/plan/**` 与 `dev/report/**` 的分层要求

## 3. 总体结论

结论：**Conditional Pass / 有条件通过**

当前计划文档已经具备“设计收口版本”的基本形态，优点包括：

- 已把 5 份 contract 缺失、AI 门禁、`/reports` 边界、`nimi-kit` 复用、spec drift 提升为前置治理问题
- 已把审计过程与设计结论分层，方向上符合 `dev/plan/**` / `dev/report/**` 约束
- 已以 `routes.yaml`、`feature-matrix.yaml`、`knowledge-source-readiness.yaml` 为主要权威事实源组织叙述

但基于 2026-04-03 的仓库现状，它仍**不建议被视为最终冻结版设计方案**。当前最大问题不再是“缺少原则”，而是“少数关键设计尚未决策完成”。

## 4. 已确认的当前事实

- ParentOS 当前有 **11** 个权威 YAML 表，而不是 9 个。
- `knowledge-source-readiness.yaml` 已存在并已建立 `reviewed / needs-review` 门禁。
- `routes.yaml` 已把 `/reports` 冻结为 `phase: 2` 且 `gated: true`。
- `feature-matrix.yaml` 当前有 **22** 个功能定义，其中 `PO-FEAT-010` 和 `PO-FEAT-013` 仍列在 Phase 1。
- `spec/INDEX.md` 暴露的 5 份 Kernel Contract 文件当前全部缺失。
- `ability-model.yaml` 当前仍未收口，存在层级口径和枚举不一致。

## 5. 主要发现

### 5.1 阻断项

#### B1. 5 份 Kernel Contract 文件仍不存在

`spec/INDEX.md` 已公开暴露以下入口，但文件本体当前全部缺失：

- `spec/kernel/app-shell-contract.md`
- `spec/kernel/timeline-contract.md`
- `spec/kernel/profile-contract.md`
- `spec/kernel/journal-contract.md`
- `spec/kernel/advisor-contract.md`

影响：

- INDEX 暴露的 contract 入口不可达
- `PO-*` 规则编号还不能作为已落地资产引用
- Gate D0 无法闭合

结论：这是当前设计冻结的明确阻断项。

#### B2. `§6.7` 体验能力收口仍不完整

当前 `parentos.md §6.7` 共定义 13 项体验能力，但原计划文档并未把它们全部归入明确状态。至少以下两项此前没有被清晰归类：

- `此刻最值得关注的一件事`
- `关系信号检测`

影响：

- “哪些能力只是产品设计，哪些能力允许进入排期”仍不完全明确
- 后续实现容易把未收口能力误带入 Phase 1

结论：这是设计层面的阻断项，必须在计划文档内完成全量分类。

#### B3. AI Phase 1 的最小价值边界仍未完全决策完成

`knowledge-source-readiness.yaml` 当前明确显示 `observation` 仍为 `needs-review`，但 `feature-matrix.yaml` 中 `PO-FEAT-013` 仍位于 Phase 1。仅凭 feature 存在，尚不足以推出“观察模式识别”已经具备可实现边界。

影响：

- `PO-FEAT-013` 的 Phase 1 最小输出范围不明确
- 容易把 `needs-review` 理论解释误带入自由生成 prompt

结论：`PO-FEAT-010` 可以保留为最小基础问答能力；`PO-FEAT-013` 则必须先单独冻结其最小允许输出范围，不能默认放行。

### 5.2 高风险项

#### H1. `/reports` 仍存在明确的 spec/code drift

当前权威 spec 已冻结 `/reports`：

- 路由存在于 `routes.yaml`
- `phase: 2`
- `gated: true`
- Phase 1 不注册 router、不出现在导航中

但当前代码现状仍然：

- 在 `routes.tsx` 中注册了 `/reports`
- 在 `shell-layout.tsx` 中暴露了“成长报告”导航

结论：这不是开放决策问题，而是已冻结 spec 与实现现状的 drift。

#### H2. `ability-model.yaml` 仍不是可直接依赖的冻结资产

当前文件内部至少存在以下不一致：

- 文件头部与总览对层数的描述不一致
- 当前叙述同时出现“7 层版本”和“8 层版本”
- `layer` 枚举只列出 6 类值

结论：在上游收口前，它不应被当作稳定的编译产物输入，也不应被叙述性文档继续写成确定层数的结论。

#### H3. 计划文档中的部分 DF 条件仍缺少验收载体

以下条件在旧版本计划文档中只有“要形成结论”的要求，但没有固定结论归档位置：

- `DF-005` `nimi-kit` 复用审计
- `DF-007` 跨 app `runtime_bridge` 合规性
- `DF-008` 本地启发式词表/模式表治理

结论：如果不把这些结果固定落到 `dev/report/**` 中的明确报告里，它们仍然容易停留在口头状态，无法审计。

### 5.3 中风险项

#### M1. `package.json` 尚未落地 app-level generate/check 脚本入口

当前设计文档、`parentos.md` 与 `AGENTS.md` 都引用了：

- `generate:knowledge-base`
- `check:spec-consistency`
- `check:knowledge-base`
- `check:nurture-mode-safety`
- `check:ai-boundary`

但这些脚本当前尚未出现在 `apps/parentos/package.json` 中。

结论：这不阻断设计收口本身，但意味着“可验证”目前仍停留在治理要求层，而非已经落地的仓库入口。

## 6. 审计评级

| 级别 | 数量 |
|------|------|
| 阻断项 | 3 |
| 高风险项 | 3 |
| 中风险项 | 1 |

总体评级：**有条件通过**

## 7. 设计收口建议

在不改动权威 YAML 表本体的前提下，建议按以下顺序完成文档收口：

1. 在计划文档中补齐 `§6.7` 全量能力的明确分类，消除遗漏项。
2. 在计划文档中把 `PO-FEAT-010` 与 `PO-FEAT-013` 的 Phase 1 AI 边界拆开写，停止默认放行 `PO-FEAT-013`。
3. 在 `parentos.md` 中移除会与当前权威表冲突的旧版观察维度数量口径和能力模型层数口径。
4. 在 `AGENTS.md` 中同步 `knowledge-source-readiness.yaml` 和 `ability-model.yaml` 的当前治理口径。
5. 把 `DF-005`、`DF-007`、`DF-008` 的书面载体固定到 `dev/report/**` 的明确文件路径。

## 8. 当前结论

截至 2026-04-03，`apps/parentos/dev/plan/phase-1-implementation-plan.md` 可以作为“设计收口中的工作版本”，但还不能视为最终冻结版设计基线。完成本报告列出的阻断项收口后，才适合进入下一轮实现性规划。
