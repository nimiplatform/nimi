# ParentOS Spec Guide

This file is a guide. ParentOS normative authority lives in [kernel/index.md](kernel/index.md).

Reading path:

| Document | Role |
|----------|------|
| [kernel/index.md](kernel/index.md) | ParentOS kernel authority map |
| [parentos.md](parentos.md) | Product overview, non-goals, known defects, and reading guidance |

Kernel contracts:

| Contract | Scope |
|----------|-------|
| [kernel/app-shell-contract.md](kernel/app-shell-contract.md) | Shell, bootstrap, routing, settings surfaces |
| [kernel/timeline-contract.md](kernel/timeline-contract.md) | Reminder engine, timeline projection, auto-report trigger |
| [kernel/profile-contract.md](kernel/profile-contract.md) | Child profile, health records, profile-local AI summaries, OCR import, posture surface |
| [kernel/health-record-console-contract.md](kernel/health-record-console-contract.md) | `/profile` health record console, current metrics, evaluation, freshness, next-record display |
| [kernel/capture-orchestrator-contract.md](kernel/capture-orchestrator-contract.md) | Unified health data capture intent, modal protocol, save transaction, reminder-linked completion |
| [kernel/journal-contract.md](kernel/journal-contract.md) | Journal entry flow, voice capture, AI tag suggestion |
| [kernel/advisor-contract.md](kernel/advisor-contract.md) | Advisor chat, reports, AI safety boundaries |

Kernel tables:

| Table | Scope |
|-------|-------|
| [kernel/tables/routes.yaml](kernel/tables/routes.yaml) | Registered routes and nav exposure |
| [kernel/tables/feature-matrix.yaml](kernel/tables/feature-matrix.yaml) | Current implemented feature set and future items |
| [kernel/tables/local-storage.yaml](kernel/tables/local-storage.yaml) | SQLite schema and persistence constraints |
| [kernel/tables/health-metric-registry.yaml](kernel/tables/health-metric-registry.yaml) | Canonical health metric registry |
| [kernel/tables/health-evaluation-rules.yaml](kernel/tables/health-evaluation-rules.yaml) | Non-diagnostic health evaluation rules |
| [kernel/tables/health-capture-protocols.yaml](kernel/tables/health-capture-protocols.yaml) | Unified capture protocols |
| [kernel/tables/reminder-capture-targets.yaml](kernel/tables/reminder-capture-targets.yaml) | `record_data` reminder capture bindings |
| [kernel/tables/nurture-modes.yaml](kernel/tables/nurture-modes.yaml) | Nurture-mode parameters |
| [kernel/tables/reminder-rules.yaml](kernel/tables/reminder-rules.yaml) | Reminder rule catalog |
| [kernel/tables/knowledge-source-readiness.yaml](kernel/tables/knowledge-source-readiness.yaml) | Reviewed versus needs-review AI gate |
| [kernel/tables/reference-data-assets.yaml](kernel/tables/reference-data-assets.yaml) | Versioned JSON data asset manifest |

Reference/data assets:

| Asset | Scope |
|-------|-------|
| [data/knowledge/growth-standards.json](../data/knowledge/growth-standards.json) | Growth, vision, lab, and other reference datasets consumed through spec-admitted evaluators |
| [data/knowledge/milestone-catalog.json](../data/knowledge/milestone-catalog.json) | Developmental milestone catalog content |
| [data/knowledge/sensitive-periods.json](../data/knowledge/sensitive-periods.json) | Sensitive-period content |
| [data/knowledge/observation-framework.json](../data/knowledge/observation-framework.json) | Observation dimensions and quick-tag content |
| [data/knowledge/ability-model.json](../data/knowledge/ability-model.json) | Non-frozen ability model design asset |

Shared imports still come from root `spec/**` where applicable.
