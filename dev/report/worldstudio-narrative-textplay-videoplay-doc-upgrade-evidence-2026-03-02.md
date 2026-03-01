# WorldStudio -> Narrative -> TextPlay -> VideoPlay 文档升级证据（2026-03-02）

## 1. 本轮范围

本轮完成了 Final State 文档落地，覆盖：

1. 链路级 SSOT：运行协议、守卫治理、总入口索引更新。
2. narrative/textplay：run orchestration 合同与 run-states 表。
3. videoplay：creator workflow、version lineage、prompt governance 合同与配套表。
4. spec 生成与一致性校验脚本配置更新。

## 2. 关键产物

链路级 SSOT：

1. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`（ADD）
2. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`（ADD）
3. `ssot/mod/worldstudio-narrative-rendering.md`（UPDATE）

模块级 SSOT/Spec：

1. `nimi-mods/world-studio/SSOT.md`（UPDATE）
2. `nimi-mods/narrative/spec/kernel/run-orchestration-contract.md`（ADD）
3. `nimi-mods/narrative/spec/kernel/tables/run-states.yaml`（ADD）
4. `nimi-mods/textplay/spec/kernel/run-orchestration-contract.md`（ADD）
5. `nimi-mods/textplay/spec/kernel/tables/run-states.yaml`（ADD）
6. `nimi-mods/videoplay/spec/kernel/creator-workflow-contract.md`（ADD）
7. `nimi-mods/videoplay/spec/kernel/version-lineage-contract.md`（ADD）
8. `nimi-mods/videoplay/spec/kernel/prompt-governance-contract.md`（ADD）
9. `nimi-mods/videoplay/spec/kernel/tables/creator-operations.yaml`（ADD）
10. `nimi-mods/videoplay/spec/kernel/tables/rebuild-impact-matrix.yaml`（ADD）
11. `nimi-mods/videoplay/spec/kernel/tables/continuity-constraints.yaml`（ADD）
12. `nimi-mods/videoplay/spec/kernel/tables/version-lineage-policy.yaml`（ADD）
13. `nimi-mods/videoplay/spec/kernel/tables/forbidden-patterns.yaml`（ADD）
14. `nimi-mods/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`（ADD）
15. `nimi-mods/narrative/spec/INDEX.md`（UPDATE）
16. `nimi-mods/textplay/spec/INDEX.md`（UPDATE）
17. `nimi-mods/videoplay/spec/INDEX.md`（UPDATE）
18. `nimi-mods/narrative/spec/narrative.md`（UPDATE）
19. `nimi-mods/textplay/spec/textplay.md`（UPDATE）
20. `nimi-mods/videoplay/spec/videoplay.md`（UPDATE）
21. `nimi-mods/*/spec/kernel/index.md`（UPDATE）

脚本与生成产物：

1. `nimi-mods/scripts/spec-kernel-config.mjs`（UPDATE）
2. `nimi-mods/*/spec/kernel/generated/*`（AUTO-GENERATED UPDATE）

## 3. 验证命令与结果

执行时间：2026-03-02

1. `pnpm -C nimi-mods run generate:spec`

结果：通过

- `[narrative] generated kernel docs (9 files)`
- `[textplay] generated kernel docs (8 files)`
- `[videoplay] generated kernel docs (15 files)`

2. `pnpm -C nimi-mods run check:spec`

结果：通过

- `[narrative] kernel consistency checks passed`
- `[textplay] kernel consistency checks passed`
- `[videoplay] kernel consistency checks passed`
- 三模块 docs drift 均为 up-to-date

## 4. 约束符合性

1. 无 legacy 兼容层、迁移层、双轨协议新增。
2. 新增规则均映射到当前链路接口/状态机/数据模型。
3. 新增 YAML 均带 `source_rule`，并通过 kernel consistency 校验。
4. `render-*` 命名已改为链路级命名，避免“仅渲染层”歧义。
