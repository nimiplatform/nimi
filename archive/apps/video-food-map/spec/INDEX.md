# Video Food Map Spec Index

> Nimi Video Food Map — creator-video-driven food discovery app built on `nimi-runtime`

## Domain

| Document | Scope |
|----------|-------|
| [video-food-map.md](video-food-map.md) | Personal food space positioning, module map, staged scope |
| [execution-plan.md](execution-plan.md) | Phase-by-phase delivery scope |

## Kernel Contracts

| Contract | Rule IDs | Scope |
|----------|----------|-------|
| [app-shell-contract.md](kernel/app-shell-contract.md) | VFM-SHELL-001 ~ 012 | Standalone app shell, personal-space-first shell rules, glass material direction, runtime dependency, kit-first UI, theme, surface mapping, adoption, runtime route settings, profile surface |
| [extraction-contract.md](kernel/extraction-contract.md) | VFM-PIPE-001 ~ 012 | Video intake, extraction order, coverage disclosure, dedupe, STT language, cookieless API, future creator batch boundary, FFmpeg |
| [discovery-contract.md](kernel/discovery-contract.md) | VFM-DISC-001 ~ 010 | Map promotion, creator search, confirmation order, comment supplement, geocoding gate, user curation, current-location nearby discovery, navigation handoff |
| [menu-advisor-contract.md](kernel/menu-advisor-contract.md) | VFM-MENU-001 ~ 005 | Menu capture, dietary guardrails, party-size recommendations, dining preference profile persistence |

## Kernel Tables

| Table | Scope |
|-------|-------|
| [dining-preference-options.yaml](kernel/tables/dining-preference-options.yaml) | Canonical option groups for dietary restrictions, taboo ingredients, flavor preferences, and cuisine preferences |

## Authoritative Imports

- `spec/runtime/kernel/multimodal-provider-contract.md`
- `spec/runtime/kernel/scenario-job-lifecycle.md`
- `spec/sdk/kernel/runtime-contract.md`
- `spec/sdk/kernel/surface-contract.md`
- `spec/platform/kernel/design-pattern-contract.md`
- `spec/platform/kernel/kit-contract.md`
