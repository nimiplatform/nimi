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
| `apps/desktop/`, `apps/web/`, `kit/`, `nimi-mods/` | MIT |
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

`MUST`: 平台治理执行项必须使用 `OSG-<Priority>-NN` 命名并记录在 local execution workspaces such as `.local/work/<topic-id>/**` 或等效非规范执行面中。kernel 只定义任务分级口径（P0/P1/P2）与命名约束，不承载具体待办清单。

## P-GOV-021 — Repository Governance Evidence Ownership

`.github/**` is platform governance evidence for CI, release workflows, security metadata, issue/PR templates, labels, funding metadata, dependency automation, and repository interaction policy. These files must be admitted through audit evidence roots and must not remain unmapped support files in a repo-wide spec-first full audit.

## P-GOV-022 — Cross-Domain Root Support Admission

Top-level package/protocol support roots such as `sdk/` root metadata and `proto/` root metadata may be admitted as audit evidence for their owning domain authority when `.nimi/spec/**` names the authority refs and evidence roots explicitly. Admission of these roots does not transfer SDK or Runtime semantic ownership to Platform; Platform owns only the repository governance admission rule.

## P-GOV-023 — Release Automation Traceability

Release and CI workflow files must remain traceable to their governed release surface, security posture, or package/protocol release gates. Workflows that publish runtime, SDK, proto, desktop, web, or mod artifacts must not become unstated parallel release authority.
