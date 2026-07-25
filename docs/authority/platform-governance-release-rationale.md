# Platform Governance Release - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/platform/governance-release.authority.yaml`。

---

<!-- source: .nimi/spec/platform/open-source-governance.md -->

# Open Source Governance

> Domain: platform

## 0. Normative Imports

- `.nimi/spec/platform/kernel/*`
- `.nimi/spec/platform/kernel/tables/*`

## Scope

This guide points to the Platform authority surfaces for open-source-governance. It does not define product rules.

## Reading Path

- `.nimi/spec/platform/kernel/index.md`
- `.nimi/spec/platform/kernel/ai-last-mile-contract.md`
- `.nimi/spec/platform/kernel/ai-scope-contract.md`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md`
- `.nimi/spec/platform/kernel/architecture-contract.md`
- `.nimi/spec/platform/kernel/capability-catalog-contract.md`
- `.nimi/spec/platform/kernel/design-pattern-contract.md`
- `.nimi/spec/platform/kernel/governance-contract.md`
- `.nimi/spec/platform/kernel/kit-contract.md`
- `.nimi/spec/platform/kernel/nimi-ui-material-contract.md`
- `.nimi/spec/platform/kernel/package-authority-admission-contract.md`
- `.nimi/spec/platform/kernel/protocol-contract.md`
- `.nimi/spec/platform/kernel/release-gate-contract.md`
- `.nimi/spec/platform/kernel/tables/release-promise-freeze.yaml`

## Tables

- `.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`
- `.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml`
- `.nimi/spec/platform/kernel/tables/audit-events.yaml`
- `.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml`
- `.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml`
- `.nimi/spec/platform/kernel/tables/compliance-test-matrix.yaml`
- `.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml`
- `.nimi/spec/platform/kernel/tables/release-promise-freeze.yaml`


---

<!-- source: .nimi/spec/platform/kernel/governance-contract.md -->

# Governance Contract

> Owner Domain: `P-GOV-*`

## P-GOV-001 — 开源边界

| 层 | 策略 |
|---|---|
| Realm implementation surface | Not distributed by this public repository |
| `runtime` / `sdk` / `proto` | 开源 (Apache-2.0) |
| `apps/desktop` / `apps/web` | 开源 (MIT) |
| `docs` / `spec` | 开源 (CC-BY-4.0) |

## P-GOV-002 — 许可证矩阵

| 路径 | License |
|---|---|
| `runtime/`, `sdk/`, `proto/` | Apache-2.0 |
| `apps/desktop/`, `apps/web/`, `kit/` | MIT |
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

`MUST`: 平台治理执行项必须使用 `OSG-<Priority>-NN` 命名；其执行计划和状态遵循 `P-PKG-010` 的 external-host ownership。必要的非权威证据或 decision dossier 可记录在 `.local/work/<work-id>/**`、等效 local evidence surface 或 Git history 中。kernel 只定义任务分级口径（P0/P1/P2）与命名约束，不承载具体待办清单或执行状态。

## P-GOV-021 — Repository Governance Evidence Ownership

`.github/**` is platform governance evidence for CI, release workflows, security metadata, issue/PR templates, labels, funding metadata, dependency automation, and repository interaction policy. These files must be admitted through audit evidence roots and must not remain unmapped support files in a repo-wide spec-first full audit.

## P-GOV-022 — Cross-Domain Root Support Admission

Top-level package/protocol support roots such as `sdk/` root metadata and `proto/` root metadata may be admitted as audit evidence for their owning domain authority when `.nimi/spec/**` names the authority refs and evidence roots explicitly. Admission of these roots does not transfer SDK or Runtime semantic ownership to Platform; Platform owns only the repository governance admission rule.

## P-GOV-023 — Release Automation Traceability

Release and CI workflow files must remain traceable to their governed release surface, security posture, or package/protocol release gates. Workflows that publish runtime, SDK, proto, desktop, or web artifacts must not become unstated parallel release authority.

## P-GOV-024 — Spec Final Authority Only

`.nimi/spec/**` records active final authority only. It must not use
repository-work task lifecycle, subordinate-process, historical-process, or
process-provenance wording as the source of truth for an active rule, table,
status, evidence requirement, or fact source.

Operational planning and task state follow the external-host ownership defined
by `P-PKG-010`.
Execution evidence, worker results, durable decision dossiers, and historical
provenance remain non-authoritative and belong in explicitly admitted local
evidence surfaces or Git history. Spec must not prescribe a repository task
lifecycle mirror; it may mention operational surfaces only to state that they
are not product authority.

## P-GOV-025 — Cross-Domain Audit Evidence Root Admission

`.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml` may admit exact
implementation evidence roots for non-platform owner domains only when the row
names the owning domain, names existing `.nimi/spec/**` authority refs owned by
that domain, and keeps the admission as audit-planning metadata. This admission
does not transfer semantic authority to Platform and must not be inferred from
workspace layout, package names, or broad owner-domain defaults.

## P-GOV-026 — Release Promise Freeze

`.nimi/spec/platform/kernel/tables/release-promise-freeze.yaml` is the
cross-domain release-promise freeze for the first publishable Nimi capability
set. The table records each public capability promise with its canonical owner,
login requirement, failure behavior, partial or deferred reason, and authority
references.

This rule does not transfer Runtime, Realm, Cognition, SDK, Desktop, Avatar, or
Kit semantic ownership to Platform. Platform owns only the promise boundary and
the requirement that a public claim must resolve to an existing owner authority.

Fixed rules:

- Public capabilities must not be advertised outside the table unless they are
  represented by an active row or explicitly covered by an active row family.
- `semantic_contract_only_proto_unavailable`, source-root-only, fixture-only,
  design-only, or adapter-placeholder capabilities are not release promises.
- `supported` rows must name an owner authority, login requirement, failure
  behavior, and verification reference.
- `partial`, `unsupported`, and `deferred` rows must name the product reason and
  the fail-closed behavior.
- App, adapter, Kit, and renderer surfaces may project or consume an admitted
  capability, but they must not become canonical owners for agent lifecycle,
  memory, credential, Realm world/social/chat, provider/model routing, or
  runtime audit truth by appearing in this table.
- The public positioning string for the first publishable capability set is:
  "Nimi is an open-source, local-first, multi-provider personal AI runtime with
  Realm-owned ecosystem identity."

## Operational Refinement Reference

`release-gate-contract.md` (`P-RELG-*`) is the operational refinement of `P-GOV-003`, `P-GOV-011`, `P-GOV-021`, and `P-GOV-023`. It declares a single release-gate registry (`tables/release-gate-registry.yaml`) as the source of release-gate identity, locks projection-only semantics for preflight / lint chain / CI workflow step blocks, and enforces traceability through a coherence checker plus a projection-drift checker. `P-RELG-*` rules cite their parent `P-GOV-*` anchors explicitly and never override them.


---

