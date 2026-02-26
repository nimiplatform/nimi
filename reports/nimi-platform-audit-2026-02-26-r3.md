# Nimi 发布前审计报告 R3（Claude 结果复核版）

- 审计日期：2026-02-26
- 审计范围：`/Users/snwozy/nimi-realm/nimi`（含 `nimi-mods`）
- 审计方法：仓内可复现证据（本地命令 + 仓库文件），不采信仓外不可复现实证
- 审计基线：在 R2 基础上，针对 Claude 报告进行逐项复核与校正

## 1. 结论摘要

- 综合评级：`B (79/100)`
- 发布结论：`Conditional GO`
- 条件说明：
  1. 治理、供应链、边界约束和 Runtime 架构质量已达到工业级门槛。
  2. 当前主要差距集中在测试金字塔上层（前端测试接入 CI、浏览器 E2E）和 API 文档化（JSDoc/TypeDoc）。
  3. 不建议在未补齐前端 CI 测试执行前，将“质量基线已工业级”作为对外表述。

## 2. 与 Claude 报告的差异校正

### 2.1 已确认成立

1. Runtime Go 覆盖率门限偏低（默认 30%）。
2. 无 Playwright/Cypress 等真实浏览器 E2E 框架。
3. 无 TypeDoc/API 参考站点自动化链路。
4. Desktop/Web 缺少组件测试体系（Testing Library 等）。
5. Tauri 无自动更新配置。
6. Proto 文件几乎无语义注释。

### 2.2 部分成立（需修正表述）

1. “SDK README 仅中文”：
   - 包根 README 确为中文：`sdk/README.md`
   - 但 docs 站已有英文 SDK 指南与示例：`docs/sdk/README.md`
   - 结论应改为“npm 包入口文档与 docs 站语言/定位分裂，外部开发者入口不一致”。

2. “无 Mod 开发教程”：
   - `docs/mods/README.md` 已提供双终端流程和排障。
   - 但仍缺少从 0 到 1 的完整端到端教程（脚手架、调试、发布、验收闭环）。

### 2.3 不成立或已过时

1. “无 GoDoc”不成立：
   - Runtime 大量导出符号存在注释，GoDoc 覆盖并非 0。
2. “无 Troubleshooting 文档”不成立：
   - `docs/dev/setup.md`、`docs/mods/README.md` 均有排障章节。
3. “main-layout-view.tsx 823 行”已过时：
   - 当前为 `844` 行。

## 3. 最新量化证据（本轮复核）

### 3.1 覆盖率实测

1. Runtime 覆盖率（脚本门禁）：
   - 命令：`pnpm check:runtime-go-coverage`
   - 总 statements 覆盖率：`34.4%`
   - 门限：`30%`（可由 `NIMI_RUNTIME_MIN_STATEMENTS_COVERAGE` 覆盖）
2. SDK 覆盖率（脚本门禁）：
   - 命令：`pnpm check:sdk-coverage`
   - 结果：`lines 91.05% / branches 70.83% / functions 90.63%`
   - 门限：`90 / 70 / 90`

### 3.2 CI 质量门禁结构

1. `sdk-quality` 包含 SDK test + 覆盖率 + smoke。
2. `runtime-quality` 包含 go build/vet/coverage/lint/vulncheck/compliance。
3. `desktop-web-quality` 当前仅包含：
   - mods smoke
   - Rust checks/tests
   - Desktop/Web typecheck
   - Web build
4. 关键缺口：未执行 `pnpm --filter @nimiplatform/desktop test` 与 `pnpm --filter @nimiplatform/web test`。

### 3.3 测试形态复核

1. Desktop/Web/nimi-mods 测试文件存在，但主要是 node:test 逻辑层测试与 smoke。
2. 未发现 `@testing-library/*`、`playwright`、`cypress` 等依赖与执行链路。
3. 标记为 `*e2e*` 的测试并非浏览器级端到端自动化。

### 3.4 可观测性复核

1. Runtime 提供 `/livez` `/readyz` `/healthz` `/v1/runtime/health`。
2. 未发现 OTel/Prometheus 采集与导出链路（`runtime/go.mod` 无对应依赖）。
3. 结论：健康可见性较好，生产可观测性仍不足。

## 4. 维度评分（R3）

| 维度 | 评分 | 结论 |
|---|---:|---|
| 开源治理与供应链安全 | 95 | 强 |
| 代码质量与工程规范 | 88 | 强 |
| SDK + Runtime 成熟度 | 84 | 较强 |
| Desktop/Web 产品工程质量 | 76 | 中等 |
| 测试覆盖与质量保障 | 60 | 偏弱 |
| 文档与开发者体验 | 78 | 中等偏上 |
| 可观测性与运维就绪 | 62 | 偏弱 |

## 5. 发布前关键风险（按优先级）

### P0

1. Desktop/Web 测试未接入 CI 执行，前端回归可进入主干。
2. 无真实浏览器 E2E 框架，关键用户流缺少自动化验收。
3. Runtime 覆盖率门限与实测覆盖均偏低（30% / 34.4%）。

### P1

1. SDK 公共导出缺少 JSDoc，IDE 悬浮与外部 API 可读性不足。
2. 无 TypeDoc/API 文档站点，外部开发者需要读源码。
3. Runtime 无 OTel/Prometheus 体系化观测。
4. Tauri 无自动更新配置，桌面分发运维成本偏高。
5. Proto 语义注释不足，事件流契约可读性弱。

### P2

1. `.gitignore` 未显式纳入 `.env*` 防御规则。
2. `CODEOWNERS` 单 owner，bus factor 风险高。
3. Desktop 存在多个超长文件（500+ 行文件较多），后续维护成本偏高。

## 6. 行动路线（建议）

### Phase 1（1-2 周，发布前最小闭环）

1. 在 `desktop-web-quality` job 加入 Desktop/Web test 执行步骤。
2. 引入 Playwright，落地 3 条关键链路用例（auth、mod 安装、聊天主流程）。
3. 将 Runtime 覆盖率门限提升到 `>=45%`（目标 50%）。
4. `sdk/README.md` 与 docs 入口统一，消除中文/英文入口割裂。
5. `.gitignore` 增加 `.env*`（保留 `.env.example`）。

### Phase 2（2-4 周）

1. 为 SDK 公共 API 补 JSDoc。
2. 引入 TypeDoc 并接入 docs 发布流程。
3. 引入 Testing Library 覆盖核心 UI 组件。
4. SDK runtime transport 增加可配置重试/指数退避（至少对可重试错误生效）。
5. Runtime 接入 OTel traces + metrics。

### Phase 3（1-2 月）

1. Tauri updater + release pipeline 闭环。
2. Proto 文件补语义注释与 streaming event 合约文档。
3. 建立共享测试工厂（fixtures/mocks/factories）。
4. 拆分超长组件并推进长列表虚拟化。

## 7. 审计边界

1. 本报告仅基于当前仓库可复现证据。
2. 不包含仓外系统状态（如线上环境、外部 SaaS 配置）真实性背书。
3. 本报告为发布前工程成熟度评估，不替代安全渗透与法务合规审计。
