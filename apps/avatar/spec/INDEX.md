# Nimi Avatar Spec Guide

This file is a guide. Nimi Avatar normative authority lives in [kernel/index.md](kernel/index.md).

Reading path:

| Document | Role |
|----------|------|
| [kernel/index.md](kernel/index.md) | Nimi Avatar kernel authority map |
| [nimi-avatar.md](nimi-avatar.md) | Product overview, product form, phase scope, known defects |

## Kernel Contracts

| Contract | Scope |
|----------|-------|
| [kernel/embodiment-projection-contract.md](kernel/embodiment-projection-contract.md) | Backend-agnostic embodiment projection layer and protocol split |
| [kernel/app-shell-contract.md](kernel/app-shell-contract.md) | Window behavior / drag / always-on-top / click-through / small button |
| [kernel/live2d-render-contract.md](kernel/live2d-render-contract.md) | Current Live2D backend branch: Cubism SDK integration, model loading, rendering pipeline |
| [kernel/agent-script-contract.md](kernel/agent-script-contract.md) | NimiAgentScript (NAS) — convention-based JS handlers for embodiment package creators |
| [kernel/avatar-event-contract.md](kernel/avatar-event-contract.md) | `avatar.*` events produced and consumed by the app |
| [kernel/mock-fixture-contract.md](kernel/mock-fixture-contract.md) | Mock data format + scenario catalog for Phase 1 development |

## Kernel Tables

| Table | Scope |
|-------|-------|
| [kernel/tables/feature-matrix.yaml](kernel/tables/feature-matrix.yaml) | Phase 1 / 2 / 3 feature phasing |
| [kernel/tables/activity-mapping.yaml](kernel/tables/activity-mapping.yaml) | Current Live2D backend branch activity → motion-group naming (default fallback) |
| [kernel/tables/scenario-catalog.yaml](kernel/tables/scenario-catalog.yaml) | Mock-driven dev scenarios |

## Upstream Platform Specs

These are consumed as upstream contracts, located in the topic proposal directory. They are **not** redefined here:

- APML wire format — `../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/apml-design.md`
- APML LLM compliance — `apml-llm-compliance.md`
- Activity ontology — `activity-ontology.md`
- Event contract + app convention — `event-hook-contract.md`
- SDK Event API — `sdk-event-api.md`
- Presentation Timeline — `presentation-timeline.md`
