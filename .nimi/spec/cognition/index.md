# Standalone Cognition

> Scope: `nimi-cognition` 作为独立 standalone cognition domain 的权威说明；runtime 可以 bridge / consume cognition，但不得重新定义其 authority。
>
> Normative Imports: `.nimi/spec/cognition/kernel/*`

## 1. 目标

本目录定义 `nimi-cognition` 的独立 authority home。
它来源于 runtime memory / knowledge 语义的抽离与升级。当前 public repo canonical 已明确把 continuity memory semantic owner 放在 cognition/runtime 路径；realm 在本 repo public authority 中不再保留 active memory owner surface。后续 cross-repo cleanup 只允许收窄 wording 或 tooling，不得把 owner line 写回 realm。

## 2. 目录结构

- `kernel/` — 规范唯一事实源（Rule ID `C-*`）
- `kernel/tables/` — 结构化事实表
- `kernel/generated/` — 自动生成视图

## 3. 阅读路径

### 评估 cognition 的 owning boundary

1. `.nimi/spec/cognition/kernel/cognition-contract.md`
2. `.nimi/spec/cognition/kernel/family-contract.md`
3. `.nimi/spec/cognition/kernel/surface-contract.md`
4. `.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`
5. `.nimi/spec/cognition/kernel/runtime-bridge-contract.md`
6. `.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`
7. `.nimi/spec/runtime/kernel/knowledge-contract.md`
8. `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`

### 收口 standalone cognition implementation

1. `.nimi/spec/cognition/kernel/cognition-contract.md`
2. `.nimi/spec/cognition/kernel/family-contract.md`
3. `.nimi/spec/cognition/kernel/surface-contract.md`
4. `.nimi/spec/cognition/kernel/memory-service-contract.md`
5. `.nimi/spec/cognition/kernel/knowledge-service-contract.md`
6. `.nimi/spec/cognition/kernel/reference-contract.md`
7. `.nimi/spec/cognition/kernel/prompt-serving-contract.md`
8. `.nimi/spec/cognition/kernel/completion-contract.md`
9. `.nimi/spec/cognition/kernel/runtime-bridge-contract.md`
10. `.nimi/spec/cognition/kernel/tables/artifact-families.yaml`
11. `.nimi/spec/cognition/kernel/tables/public-surface.yaml`
12. `.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`
13. `.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`
14. `.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml`
15. `.nimi/spec/cognition/kernel/tables/knowledge-service-operations.yaml`
16. `.nimi/spec/cognition/kernel/tables/admitted-reference-matrix.yaml`
17. `.nimi/spec/cognition/kernel/tables/prompt-serving-lanes.yaml`
18. `.nimi/spec/cognition/kernel/tables/completion-gates.yaml`
19. `.nimi/spec/cognition/kernel/tables/rule-evidence.yaml`
20. `nimi-cognition/**`

## 4. 边界声明

- Kernel anchor rules: `C-COG-001` `C-COG-002` `C-COG-003` `C-COG-016`
- cognition 不是 runtime subchapter。
- runtime 可以 bridge / consume cognition，但不能重新定义 cognition authority。
- runtime-facing overlap surface 的存在，不等于 runtime 或 realm 重新获得 cognition semantic ownership。
- baseline、审计报告、实现代码都不是权威；权威只在本目录 kernel 中。
