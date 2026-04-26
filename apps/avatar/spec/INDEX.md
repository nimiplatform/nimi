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
| [kernel/carrier-visual-acceptance-contract.md](kernel/carrier-visual-acceptance-contract.md) | Current Avatar app carrier visual proof requirements and evidence taxonomy |
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

These are consumed as active upstream contracts. They are **not** redefined here:

- APML wire format — `../../.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- APML LLM compliance — `../../.nimi/spec/runtime/kernel/agent-output-wire-contract.md` plus first-party prompt contracts
- Activity projection — `../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` and `kernel/tables/activity-mapping.yaml`
- Event contract + app convention — `../../.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`, `../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`, and `kernel/avatar-event-contract.md`
- SDK Event API — `../../.nimi/spec/sdk/kernel/runtime-contract.md`
- Presentation Timeline — `../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
