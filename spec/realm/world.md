---
id: SPEC-REALM-WORLD-001
title: Realm World Domain
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm World Boundary

## Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001..008`
- `kernel/world-state-contract.md`: `R-WSTATE-001..006`
- `kernel/world-history-contract.md`: `R-WHIST-001..006`
- `kernel/transit-contract.md`: `R-TRANSIT-001..006`
- `kernel/binding-contract.md`: `R-BIND-001..005`

## Scope

World 在闭源 `nimi-realm` 中不再是厚 narrative runtime 域，而是一个组合边界：

- `Truth`: 世界是什么
- `World State`: 世界现在变成了什么样
- `World History`: 世界已经发生了什么
- `Transit`: 跨世界连续性迁移
- `World Drafts`: creator control-plane 上的最小发布候选稿，只承载显式可发布到 `Truth / World State / World History` 的内容

`OASIS` 是 Realm 内唯一系统主世界，属于该组合边界的正式组成：它提供默认入口、默认返回点与跨世界中转锚点，但不是额外第五核心域。

## Draft Boundary

`world-drafts` 在 Realm 中是 control-plane 对象，不是 editor/runtime 对象。

- 允许进入 Realm draft 的只有：`importSource`、`truthDraft`、`stateDraft`、`historyDraft`
- Forge 本地持有：workspace step、导入任务、phase1/phase2 中间产物、资产生成状态、review UI state、未准备发布的草稿
- cross-device 恢复只保证最小 publish candidate，不保证恢复完整编辑器过程态
- 资产展示或正式使用绑定不属于 canonical world draft；如需落库，必须走显式 binding 路径

## Reading Path

1. `kernel/truth-contract.md`
2. `kernel/world-state-contract.md`
3. `kernel/world-history-contract.md`
4. `kernel/transit-contract.md`
5. `kernel/binding-contract.md`
6. `kernel/tables/rule-catalog.yaml`
7. `kernel/tables/truth-contract.yaml`
8. `kernel/tables/world-state-contract.yaml`
9. `kernel/tables/world-history-contract.yaml`
10. `kernel/tables/transit-contract.yaml`
11. `kernel/tables/binding-contract.yaml`

## Non-goals

No story runtime, narrative spine, satellite, turn pacing, prompt assembly state, draft workflow state, asset generation state, or editor checkpoint state is kept here.
