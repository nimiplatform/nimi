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
| [kernel/journal-contract.md](kernel/journal-contract.md) | Journal entry flow, voice capture, AI tag suggestion |
| [kernel/advisor-contract.md](kernel/advisor-contract.md) | Advisor chat, reports, AI safety boundaries |

Kernel tables:

| Table | Scope |
|-------|-------|
| [kernel/tables/routes.yaml](kernel/tables/routes.yaml) | Registered routes and nav exposure |
| [kernel/tables/feature-matrix.yaml](kernel/tables/feature-matrix.yaml) | Current implemented feature set and future items |
| [kernel/tables/local-storage.yaml](kernel/tables/local-storage.yaml) | SQLite schema and persistence constraints |
| [kernel/tables/nurture-modes.yaml](kernel/tables/nurture-modes.yaml) | Nurture-mode parameters |
| [kernel/tables/reminder-rules.yaml](kernel/tables/reminder-rules.yaml) | Reminder rule catalog |
| [kernel/tables/milestone-catalog.yaml](kernel/tables/milestone-catalog.yaml) | Milestone catalog |
| [kernel/tables/sensitive-periods.yaml](kernel/tables/sensitive-periods.yaml) | Sensitive-period data |
| [kernel/tables/growth-standards.yaml](kernel/tables/growth-standards.yaml) | WHO/reference measurement standards |
| [kernel/tables/observation-framework.yaml](kernel/tables/observation-framework.yaml) | Observation dimensions and quick tags |
| [kernel/tables/knowledge-source-readiness.yaml](kernel/tables/knowledge-source-readiness.yaml) | Reviewed versus needs-review AI gate |

Shared imports still come from root `spec/**` where applicable.
