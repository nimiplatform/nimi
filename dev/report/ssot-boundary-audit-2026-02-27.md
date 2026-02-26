# SSOT 边界审计（全量扫描）

- 日期：2026-02-27
- 目标：核验 `ssot/` 是否混入执行态内容，并收敛到 `ssot`/`dev` 边界规则。
- 规则来源：`AGENTS.md`（SSOT vs Dev Boundary）与 `check:ssot-boundary`。

## 1. 扫描范围

- 目录：`ssot/**/*.md`
- 文件数：26
- 检测项：
  1. SSOT 内出现勾选进度标记（`- [x]`）
  2. SSOT 内出现状态快照语义（例如“当前状态快照”）
  3. SSOT 内出现迭代完成台账语义（计划/实际/阻塞/下轮）

## 2. 初始命中（同类问题）

1. `ssot/platform/open-source-governance.md`
   - 命中：状态快照段、大量 `[x]` 执行态清单、执行历史日志。
2. `ssot/sdk/design.md`
   - 命中：`发布与验收` 段落使用 `[x]` 执行态清单。
3. `ssot/platform/protocol.md`
   - 命中：`冻结检查清单` 使用 `[x]` 执行态清单。
4. `ssot/mod/codegen.md`
   - 命中：`发布门槛` 使用 `[x]` 执行态清单。
5. `ssot/runtime/*`
   - 命中：本轮之前已在 runtime 文档完成同类收敛（见 runtime 边界收敛报告）。

## 3. 已执行修复

1. 将上述文档中的 `[x]` 清单改为规范性条款（无执行态勾选）。
2. 移除/改写状态快照与执行完成叙述，改为“证据归档到 `dev/report/*`”。
3. 在 `AGENTS.md` 新增 `SSOT vs Dev Boundary (MUST)` 条款，明确禁止项与归档路径。
4. 新增自动检测脚本 `scripts/check-ssot-boundary.mjs`，并接入：
   - `pnpm check:ssot-boundary`
   - 根级 `pnpm lint` 链路

## 4. 复验结果

1. `pnpm check:ssot-boundary`：PASS（26 file(s) scanned）
2. 复扫无 `- [x]` 命中。
3. 复扫无“当前状态快照/本轮报告/迭代台账字段”残留命中。

## 5. 结论

- `ssot` 与 `dev` 的边界已完成规则化（AGENTS）+ 机械化（脚本门禁）双收敛。
- 后续若出现同类漂移，`check:ssot-boundary` 将在本地与 CI 阻断。
