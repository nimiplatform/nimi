# Runtime SSOT 边界收敛记录（ssot vs dev）

- 日期：2026-02-26
- 目的：将 runtime SSOT 中的执行态内容迁移到 `dev/report`，恢复“SSOT 仅承载规范、dev 承载执行态”的边界。
- 影响范围：
  - `ssot/runtime/multimodal-delivery-gates.md`
  - `ssot/runtime/multimodal-provider-contract.md`
  - `ssot/runtime/service-contract.md`
  - `ssot/runtime/workflow-dag.md`

## 1. 迁移内容总览

1. 从 `multimodal-delivery-gates.md` 迁移：
   - 迭代执行表（I1-I10）
   - Gate 状态快照（G0-G7 PASS）
   - “本轮报告”定点引用（R4/R5）
2. 从 `multimodal-provider-contract.md` 迁移：
   - `R5/R6` 交付切面状态描述
3. 从 `service-contract.md` 迁移：
   - “已通过 23/23”执行结论
   - `[x]` 已完成发布门槛勾选清单
4. 从 `workflow-dag.md` 迁移：
   - “已测试落地并通过”执行结论
   - `[x]` DAG 发布门槛勾选清单

## 2. 迁移后边界定义

1. `ssot/runtime/*`：
   - 仅保留规范性内容（MUST/SHOULD、合同定义、门禁定义、验证命令、退出条件）
   - 不允许写入日期化通过状态、迭代完成记录、PASS/FAIL 快照
2. `dev/report/*`：
   - 承载每轮执行结果、状态快照、证据链接、残差风险
3. `dev/plan/*`：
   - 承载迭代计划、分片策略、后续承接项

## 3. 对应规范化变更

1. `ssot/runtime/multimodal-delivery-gates.md`
   - 删除执行态章节，新增“执行态记录归档（MUST）”规则。
2. `ssot/runtime/multimodal-provider-contract.md`
   - 删除 R5/R6 轮次状态段，保留纯能力要求并显式要求进度写入 `dev/report`。
3. `ssot/runtime/service-contract.md`
   - 将 `[x]` 清单改为“发布候选前必须满足”的未勾选门槛。
4. `ssot/runtime/workflow-dag.md`
   - 将 `[x]` 清单改为 DAG baseline 最小门槛。

## 4. 历史执行态承接

历史执行证据仍由既有报告承接，不回写 SSOT：

1. `dev/report/runtime-multimodal-r5-2026-02-26.md`
2. `dev/report/runtime-multimodal-r5-2026-02-26.evidence.md`
3. `dev/report/runtime-multimodal-g6-g7-2026-02-26.md`
4. `dev/report/runtime-multimodal-g6-g7-2026-02-26.evidence.md`
5. `dev/report/runtime-multimodal-r5-residual-audit-2026-02-26.md`
6. `dev/report/runtime-multimodal-r5-residual-audit-2026-02-26.evidence.md`
