# Relay Spec Index

> Nimi Relay — Electron AI chat client with beat-first turn pipeline
> Agent-centric interaction: the selected agent drives every interaction surface

## Domain

| Document | Scope |
|----------|-------|
| [relay.md](relay.md) | Domain positioning, module map, non-goals |

## Kernel Contracts

| Contract | Rule IDs | Scope |
|----------|----------|-------|
| [bootstrap-contract.md](kernel/bootstrap-contract.md) | RL-BOOT-001 ~ 005 | Electron startup sequence |
| [ipc-bridge-contract.md](kernel/ipc-bridge-contract.md) | RL-IPC-001 ~ 009 | Electron IPC bridge protocol |
| [transport-validation.md](kernel/transport-validation.md) | RL-TRANS-001 ~ 005 | node-grpc validation targets |
| [interop-contract.md](kernel/interop-contract.md) | RL-INTOP-001 ~ 003 | Multi-app chat interop |
| [agent-core-contract.md](kernel/agent-core-contract.md) | RL-CORE-001 ~ 004 | Agent-centric interaction invariants |
| [feature-contract.md](kernel/feature-contract.md) | RL-FEAT-001 ~ 007 | Feature module contracts |
| [pipeline-contract.md](kernel/pipeline-contract.md) | RL-PIPE-001 ~ 011 | Beat-first turn pipeline |

## Fact Sources

| Table | Generated View |
|-------|---------------|
| [ipc-channels.yaml](kernel/tables/ipc-channels.yaml) | [ipc-channels.md](kernel/generated/ipc-channels.md) |
| [bootstrap-phases.yaml](kernel/tables/bootstrap-phases.yaml) | [bootstrap-phases.md](kernel/generated/bootstrap-phases.md) |
| [feature-capabilities.yaml](kernel/tables/feature-capabilities.yaml) | [feature-capabilities.md](kernel/generated/feature-capabilities.md) |
| [rule-evidence.yaml](kernel/tables/rule-evidence.yaml) | [rule-evidence.md](kernel/generated/rule-evidence.md) |

## Authoritative Imports

- `spec/sdk/kernel/transport-contract.md` — S-TRANSPORT-*
- `spec/runtime/kernel/rpc-surface.md` — K-SCENARIO-*, K-STREAM-*
