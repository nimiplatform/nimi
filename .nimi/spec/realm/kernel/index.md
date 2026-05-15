---
id: SPEC-REALM-KERNEL-INDEX-001
title: Realm Kernel Index
status: active
owner: "@team"
updated: 2026-04-18
---

# Realm Kernel Index

## Contracts

- `truth-contract.md` (`R-TRUTH-*`)
- `projection-contract.md` (`R-PROJ-*`)
- `world-state-contract.md` (`R-WSTATE-*`)
- `world-history-contract.md` (`R-WHIST-*`)
- `chat-contract.md` (`R-CHAT-*`)
- `group-agent-participation-contract.md` (`R-CHAT-*`)
- `attachment-contract.md` (`R-ATTACH-*`)
- `binding-contract.md` (`R-BIND-*`)
- `resource-contract.md` (`R-RSRC-*`)
- `social-contract.md` (`R-SOC-*`)
- `economy-contract.md` (`R-ECON-*`)
- `asset-contract.md` (`R-ASSET-*`)
- `bundle-contract.md` (`R-BNDL-*`)
- `transit-contract.md` (`R-TRANSIT-*`)
- `oauth-authority-contract.md` (`R-OAUTH-*`)

## Tables

- `tables/rule-catalog.yaml`
- `tables/rule-evidence.yaml`
- `tables/commit-authorization-matrix.yaml`
- `tables/truth-contract.yaml`
- `tables/projection-contract.yaml`
- `tables/world-state-contract.yaml`
- `tables/world-history-contract.yaml`
- `tables/chat-contract.yaml`
- `tables/group-agent-participation-contract.yaml`
- `tables/group-agent-trigger-policy.yaml`
- `tables/group-agent-slot-lifecycle.yaml`
- `tables/attachment-contract.yaml`
- `tables/binding-contract.yaml`
- `tables/resource-contract.yaml`
- `tables/social-contract.yaml`
- `tables/economy-contract.yaml`
- `tables/asset-contract.yaml`
- `tables/bundle-contract.yaml`
- `tables/transit-contract.yaml`
- `tables/oauth-authority-contract.yaml`
- `tables/domain-enums.yaml`
- `tables/domain-state-machines.yaml`
- `tables/open-spec-alignment-map.yaml`
- `tables/under-spec-registry.yaml`

## Derived Views

Realm table views are rendered on demand with `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope realm`. The views are stdout artifacts; `generated/` is not a product authority directory.
