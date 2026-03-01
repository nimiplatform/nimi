# Governance Contract

> Owner Domain: `P-GOV-*`

## P-GOV-001 — 开源边界

| 层 | 策略 |
|---|---|
| `nimi-realm` | 闭源 |
| `runtime` / `sdk` / `proto` | 开源 (Apache-2.0) |
| `apps/desktop` / `nimi-mods` / `apps/web` | 开源 (MIT) |
| `docs` / `spec` | 开源 (CC-BY-4.0) |

## P-GOV-002 — 许可证矩阵

| 路径 | License |
|---|---|
| `runtime/`, `sdk/`, `proto/` | Apache-2.0 |
| `apps/desktop/`, `apps/web/`, `apps/_libs/`, `nimi-mods/` | MIT |
| `docs/`, `spec/` | CC-BY-4.0 |

## P-GOV-003 — 发布门禁规则

`MUST`: 所有关键门禁必须在 CI 可重放。破坏性变更必须具备显式声明与迁移路径。安全与供应链检查必须可追溯。发布产物必须可由工作流复现。本 SSOT 先于实现变更更新。

## P-GOV-010 — 优先级模型

| 优先级 | 语义 |
|---|---|
| P0 | 发布前阻断项 |
| P1 | 发布后 30 天内补齐项 |
| P2 | 社区增长期持续优化项 |

## P-GOV-011 — Go/No-Go 发布门

Go 条件（全部满足）：Dependabot 生效、安全扫描持续通过、Runtime tag 自动发布、SDK/proto/desktop staging 演练、覆盖率门禁启用、CI 多 job 并发、PR 模板含安全影响、发布 runbook 可复现。

No-Go 条件（任一命中）：发布依赖人工脚本、机密/漏洞门禁缺失、关键产物不可复现、文档与工作流不一致。

## P-GOV-020 — 治理任务清单

治理任务 ID 格式：`OSG-<Priority>-NN`。P0 (7项)：依赖自动化、安全基线、发布流水线、Go 二进制发布、覆盖率门槛、CI 拓扑、发布物签名与 SBOM。P1 (5项)：pre-commit hooks、PR 安全模板、Markdown lint、env 样例、workflow 自检。P2 (3项)：社区引导、治理外显、品牌分发。
