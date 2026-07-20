# Zhiyu Kernel Contracts

This directory is the formal authority for Zhiyu product behavior.

## Scope

Zhiyu is a first-party bundled developer-only incubated app that provides a
local partner center. It consumes Platform, Runtime, SDK, Kit, Desktop, Realm,
Cognition, and Avatar authority; it does not replace those owners.

## Rule IDs

Zhiyu rule IDs use `Z-<DOMAIN>-NNN`.

Allowed domains:

- `PROD`
- `AUTH`
- `STATE`
- `PARTNER`
- `CHAT`
- `CONFIG`
- `MEM`
- `AV`
- `ACT`
- `COPY`
- `DIAG`
- `GATE`
- `REL`
- `PERSIST`

## Contracts

| Contract | Rule IDs | Purpose |
| --- | --- | --- |
| `product-authority-contract.md` | `Z-PROD-*` | Product promise, release posture, non-goals |
| `authority-boundary-contract.md` | `Z-AUTH-*` | Cross-owner boundary and forbidden local truth |
| `local-partner-center-state-contract.md` | `Z-STATE-*` | Product states and transitions |
| `partner-selection-handoff-contract.md` | `Z-PARTNER-*` | Partner selection and Desktop/Realm handoff |
| `conversation-surface-contract.md` | `Z-CHAT-*` | Runtime Agent conversation consumption |
| `configuration-surface-contract.md` | `Z-CONFIG-*` | AI config and Avatar config operation surface |
| `memory-state-projection-contract.md` | `Z-MEM-*` | Read-only memory projection |
| `avatar-voice-surface-contract.md` | `Z-AV-*` | Avatar and voice posture |
| `creation-activity-contract.md` | `Z-ACT-*` | Partner activities and image hard cut |
| `main-ui-copy-contract.md` | `Z-COPY-*` | Chinese main UI copy boundary |
| `diagnostics-dev-mode-contract.md` | `Z-DIAG-*` | Developer diagnostics surface |
| `testing-contract.md` | `Z-GATE-*` | Executable test topology and acceptance gates |
| `incubation-release-contract.md` | `Z-REL-*` | Bundled developer-only release posture |
| `local-persistence-boundary-contract.md` | `Z-PERSIST-*` | Local persistence boundary |

## Tables

Typed facts live under `tables/`. The authoritative table list is checked by
`scripts/check-zhiyu-spec-kernel-consistency.mjs`.

## Priority

When conflicts occur:

1. Upstream owner specs define upstream truth.
2. Zhiyu kernel defines Zhiyu product surface and consumption requirements.
3. App implementation and tests follow this kernel.
