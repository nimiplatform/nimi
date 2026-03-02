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

---

## 5. 2026-03-02 五轮增量迭代证据（新增，不替代第 1-4 节）

说明：本节记录 2026-03-02 的五轮增量迭代证据，保留历史证据正文不变。

### 5.1 基线与输入

1. `world-studio` 已有真实实现（`nimi-mods/world-studio/src/*`）。
2. `narrative/textplay/videoplay` 当前为 contract-first（SSOT/spec 先行，尚无 `src`）。
3. 链路级 SSOT 已存在 3 份：rendering / run-protocol / guard-governance。
4. 对标输入使用行业主流产品样本（外部样本仓，HEAD `eb18e92`，2026-03-01）。

### 5.2 五轮执行与落地结果

#### 5.2.1 第 1 轮：基线收敛与边界澄清

1. 目标：澄清 contract-first 边界，避免把“合同定义”误读为“实现已上线”。
2. 落地：
   1. `ssot/mod/worldstudio-narrative-rendering.md`
   2. `dev/plan/worldstudio-narrative-textplay-videoplay-doc-upgrade-plan-2026-03-02.md`
3. 门禁：
   1. `pnpm -C nimi-mods run generate:spec` 通过
   2. `pnpm -C nimi-mods run check:spec` 通过

#### 5.2.2 第 2 轮：Run 协议可恢复性强化

1. 目标：补 run/task 解耦、cancel 独立终态、`afterSeq + gapRefill` 恢复约束。
2. 落地：
   1. narrative：`run-orchestration-contract.md`、`run-states.yaml`、`reason-codes.yaml`、`acceptance-cases.yaml`
   2. textplay：`run-orchestration-contract.md`、`run-states.yaml`、`reason-codes.yaml`、`acceptance-cases.yaml`
3. 门禁：
   1. `pnpm -C nimi-mods run generate:spec:narrative-kernel-docs` 通过
   2. `pnpm -C nimi-mods run check:spec:narrative` 通过
   3. `pnpm -C nimi-mods run generate:spec:textplay-kernel-docs` 通过
   4. `pnpm -C nimi-mods run check:spec:textplay` 通过

#### 5.2.3 第 3 轮：链路反模式硬闸

1. 目标：固化反照抄规则，补齐 videoplay prompt 漂移守卫。
2. 落地：
   1. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`
   2. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`
   3. `nimi-mods/videoplay/spec/kernel/prompt-governance-contract.md`
   4. `nimi-mods/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`
3. 门禁：
   1. `pnpm -C nimi-mods run generate:spec:videoplay-kernel-docs` 通过
   2. `pnpm -C nimi-mods run check:spec:videoplay` 通过

#### 5.2.4 第 4 轮：WorldStudio -> Narrative 交接合同强化

1. 目标：将 world 到 narrative 的交接投影束合同化（`WS-PIPE-008`）。
2. 落地：
   1. `nimi-mods/world-studio/spec/kernel/pipeline-contract.md`
   2. `nimi-mods/world-studio/spec/kernel/tables/pipeline-states.yaml`
   3. `nimi-mods/world-studio/spec/kernel/tables/reason-codes.yaml`
   4. `nimi-mods/world-studio/spec/kernel/acceptance-contract.md`
   5. `nimi-mods/world-studio/spec/kernel/tables/acceptance-cases.yaml`
3. 门禁：
   1. `pnpm -C nimi-mods run generate:spec:world-studio-kernel-docs` 通过
   2. `pnpm -C nimi-mods run check:spec:world-studio` 通过

#### 5.2.5 第 5 轮：收敛与全量门禁

1. 目标：修复 traceability 缺口并完成全量门禁闭环。
2. 落地：
   1. `ssot/_meta/traceability-matrix.md`（补齐 3 个链路级 SSOT 条目）
   2. `dev/plan/worldstudio-narrative-textplay-videoplay-doc-upgrade-plan-2026-03-02.md`
   3. 本证据文档
3. 门禁：
   1. `pnpm run check:ssot-frontmatter` 通过（39 files）
   2. `pnpm run check:ssot-links` 通过（39 files）
   3. `pnpm run check:ssot-boundary` 通过（39 files）
   4. `pnpm run check:ssot-traceability` 通过（36 expected / 36 listed）
   5. `pnpm -C nimi-mods run generate:spec` 通过
   6. `pnpm -C nimi-mods run check:spec` 通过

### 5.3 全链路已落地资产总表（统一口径）

说明：本清单统一展示当前已落地资产，不区分“历史已落地”与“5 轮迭代已落地”来源。

1. 链路级 SSOT：
   1. `ssot/mod/worldstudio-narrative-rendering.md`
   2. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`
   3. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`
2. SSOT 元数据：
   1. `ssot/_meta/traceability-matrix.md`
3. World-Studio：
   1. `nimi-mods/world-studio/SSOT.md`
   2. `nimi-mods/world-studio/spec/kernel/pipeline-contract.md`
   3. `nimi-mods/world-studio/spec/kernel/acceptance-contract.md`
   4. `nimi-mods/world-studio/spec/kernel/tables/pipeline-states.yaml`
   5. `nimi-mods/world-studio/spec/kernel/tables/reason-codes.yaml`
   6. `nimi-mods/world-studio/spec/kernel/tables/acceptance-cases.yaml`
4. Narrative：
   1. `nimi-mods/narrative/spec/INDEX.md`
   2. `nimi-mods/narrative/spec/kernel/run-orchestration-contract.md`
   3. `nimi-mods/narrative/spec/kernel/tables/run-states.yaml`
   4. `nimi-mods/narrative/spec/kernel/tables/reason-codes.yaml`
   5. `nimi-mods/narrative/spec/kernel/tables/acceptance-cases.yaml`
5. TextPlay：
   1. `nimi-mods/textplay/spec/INDEX.md`
   2. `nimi-mods/textplay/spec/kernel/run-orchestration-contract.md`
   3. `nimi-mods/textplay/spec/kernel/tables/run-states.yaml`
   4. `nimi-mods/textplay/spec/kernel/tables/reason-codes.yaml`
   5. `nimi-mods/textplay/spec/kernel/tables/acceptance-cases.yaml`
6. VideoPlay：
   1. `nimi-mods/videoplay/spec/INDEX.md`
   2. `nimi-mods/videoplay/spec/kernel/creator-workflow-contract.md`
   3. `nimi-mods/videoplay/spec/kernel/version-lineage-contract.md`
   4. `nimi-mods/videoplay/spec/kernel/prompt-governance-contract.md`
   5. `nimi-mods/videoplay/spec/kernel/tables/creator-operations.yaml`
   6. `nimi-mods/videoplay/spec/kernel/tables/rebuild-impact-matrix.yaml`
   7. `nimi-mods/videoplay/spec/kernel/tables/continuity-constraints.yaml`
   8. `nimi-mods/videoplay/spec/kernel/tables/version-lineage-policy.yaml`
   9. `nimi-mods/videoplay/spec/kernel/tables/forbidden-patterns.yaml`
   10. `nimi-mods/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`
7. 过程文档：
   1. `dev/plan/worldstudio-narrative-textplay-videoplay-doc-upgrade-plan-2026-03-02.md`
   2. `dev/report/worldstudio-narrative-textplay-videoplay-doc-upgrade-evidence-2026-03-02.md`

### 5.4 约束符合性审计（增量）

1. 保持主意图不变：worldstudio（基础事实）-> narrative（叙事事实）-> renderer（textplay/videoplay）。
2. 无 legacy 兼容层、迁移层、双轨协议。
3. 新增规则均映射到现有接口/状态机/数据模型，未引入悬空规则。
4. 所有新增表项均带 `source_rule` 并通过 consistency check。
5. SSOT 不写执行态打勾快照，执行证据全部在 `dev/report/*`。

### 5.5 深度对比摘要：Nimi 链路 vs 行业主流开源短剧产品样本

1. 产品力：行业主流样本当前可运行闭环更完整；Nimi 的长期优势在分层边界与合同治理。
2. 设计合理性：Nimi 在“反启发式终态推断、反 run/task 混用、反 cancel->error”上治理更强。
3. 工程成熟度：样本在应用工程成熟度更高；Nimi 在文档合同与门禁治理更系统。
4. 市场预期：样本更易快速传播；Nimi 若快速补齐实现，后期平台化上限更高。
