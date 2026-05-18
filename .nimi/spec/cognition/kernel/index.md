---
id: SPEC-COGNITION-KERNEL-INDEX-001
title: Cognition Kernel Index
status: active
owner: "@team"
updated: 2026-04-16
---

# Cognition Kernel Index

## Contracts

- `cognition-contract.md` (`C-COG-*`)
- `family-contract.md` (`C-COG-*`)
- `surface-contract.md` (`C-COG-*`)
- `runtime-bridge-contract.md` (`C-COG-*`)
- `runtime-upgrade-contract.md` (`C-COG-*`)
- `memory-service-contract.md` (`C-COG-*`)
- `knowledge-service-contract.md` (`C-COG-*`)
- `skill-service-contract.md` (`C-COG-*`)
- `reference-contract.md` (`C-COG-*`)
- `prompt-serving-contract.md` (`C-COG-*`)
- `completion-contract.md` (`C-COG-*`)
- `app-memory-access-contract.md` (`C-APMEM-*`)

## Tables

- `tables/artifact-families.yaml`
- `tables/public-surface.yaml`
- `tables/runtime-bridge-boundary.yaml`
- `tables/runtime-capability-upgrade-matrix.yaml`
- `tables/memory-service-operations.yaml`
- `tables/knowledge-service-operations.yaml`
- `tables/skill-service-operations.yaml`
- `tables/admitted-reference-matrix.yaml`
- `tables/prompt-serving-lanes.yaml`
- `tables/completion-gates.yaml`

## Derived Views

Cognition table views are rendered on demand with `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope cognition`. The views are stdout artifacts; `generated/` is not a product authority directory.
