# Interop Mapping Contract

> Owner Domain: `R-INTEROP-*`

## R-INTEROP-001 — 六原语映射方法

映射状态定义：COVERED（可直接对齐）、PARTIAL（有基础但有缺口）、MISSING（无对应实现）。

`MUST`: 只基于当前仓库已存在代码与已冻结协议合同做差距判断。差距项必须可执行。不以"先加新 feature"掩盖协议对齐缺口。

映射矩阵详见 `tables/primitive-mapping-status.yaml`。

## R-INTEROP-002 — Primitive 毕业标准

从 PARTIAL → COVERED 的毕业条件（三项均须满足）：

1. **字段映射覆盖**：primitive 定义的全部必填字段在 Realm 适配层有明确对应（字段映射表已冻结）
2. **Contract Test 通过**：至少一组 contract test 覆盖该 primitive 的正常路径和主要拒绝路径
3. **CI Gate 接入**：contract test 纳入 CI pipeline，回归检测自动触发

从 MISSING → PARTIAL 的前提条件：至少有一个代码锚点（code_anchor）且具备基础数据能力。

毕业评估由 `primitive-mapping-status.yaml` 的 `status` 字段记录，变更需同步更新 `gap` 字段说明。
