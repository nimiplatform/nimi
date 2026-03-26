# Video Food Map Spec Index

> Nimi Video Food Map — creator-video-driven food discovery app built on `nimi-runtime`

## Domain

| Document | Scope |
|----------|-------|
| [video-food-map.md](video-food-map.md) | Product positioning, module map, staged scope |
| [execution-plan.md](execution-plan.md) | Phase-by-phase delivery scope |

## Kernel Contracts

| Contract | Rule IDs | Scope |
|----------|----------|-------|
| [app-shell-contract.md](kernel/app-shell-contract.md) | VFM-SHELL-001 ~ 004 | Standalone app shell, stage boundaries, runtime dependency |
| [extraction-contract.md](kernel/extraction-contract.md) | VFM-PIPE-001 ~ 008 | Video intake, staged extraction order, coverage disclosure, dedupe |
| [discovery-contract.md](kernel/discovery-contract.md) | VFM-DISC-001 ~ 006 | Map promotion, creator search, confirmation order, geocoding gate |
| [menu-advisor-contract.md](kernel/menu-advisor-contract.md) | VFM-MENU-001 ~ 004 | Menu capture, dietary guardrails, party-size recommendations |

## Authoritative Imports

- `spec/runtime/kernel/multimodal-provider-contract.md`
- `spec/runtime/kernel/scenario-job-lifecycle.md`
- `spec/sdk/kernel/runtime-contract.md`
- `spec/sdk/kernel/surface-contract.md`
