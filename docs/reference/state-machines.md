# State Machines

Reference for every named state machine across the Nimi stack. Owner
contracts are cited; specifics live in those contracts.

## Runtime — Daemon Health

| State | Meaning |
| --- | --- |
| `STARTING` | Daemon initializing |
| `READY` | Daemon serving |
| `DEGRADED` | Daemon serving with reduced capability |
| `STOPPING` | Daemon draining; streams cancel cleanly |

Owner: `runtime/kernel/daemon-lifecycle.md` (`K-DAEMON-*`).

## Runtime — ScenarioJob

| State | Terminal? |
| --- | --- |
| `SUBMITTED` | no |
| `RUNNING` | no |
| `COMPLETED` | yes (success) |
| `FAILED` | yes |
| `TIMEOUT` | yes |
| `CANCELED` | yes |

Owner: `runtime/kernel/scenario-job-lifecycle.md` (`K-JOB-*`).

## Runtime — Workflow

| State | Terminal? |
| --- | --- |
| `ACCEPTED` | no |
| `QUEUED` | no |
| `RUNNING` | no |
| `COMPLETED` | yes (success) |
| `FAILED` | yes |
| `CANCELED` | yes |
| `SKIPPED` | yes |

Workflow events stream as: `STARTED`, `NODE_STARTED`, `NODE_PROGRESS`,
`NODE_COMPLETED`, `NODE_SKIPPED`, `COMPLETED`, `FAILED`, `CANCELED`,
plus external-async variants.

Owner: `runtime/kernel/workflow-contract.md` (`K-WF-*`).

## Runtime — Provider Async Task

| State | Terminal? |
| --- | --- |
| `queued` | no |
| `running` | no |
| `succeeded` | yes |
| `failed` | yes |
| `expired` | yes (timeout-equivalent) |

Provider async states use lower_snake; ScenarioJob uses UPPER_SNAKE.
The mapping rule (`K-MMPROV-027`) translates `succeeded → COMPLETED`,
`expired → TIMEOUT`, `failed → FAILED`.

Owner: `runtime/kernel/multimodal-provider-contract.md` (`K-MMPROV-*`).

## Runtime — Hook Lifecycle

| State | Terminal? |
| --- | --- |
| `pending` | no |
| `running` | no |
| `completed` | yes |
| `failed` | yes |
| `canceled` | yes |
| `rescheduled` | no (transitions to `pending`) |
| `rejected` | yes |

Owner: `runtime/kernel/agent-hook-intent-contract.md` (`K-AGCORE-*`).

## Runtime — Memory Replication

| State | Terminal? |
| --- | --- |
| `pending` | no |
| `synced` | yes |
| `conflict` | yes (cannot serve) |
| `invalidated` | yes (Realm governance invalidated) |

Owner: `runtime/kernel/runtime-memory-service-contract.md` (`K-MEM-*`)
and table `runtime-memory-replication-outcome.yaml`.

## Runtime — Delegated Provider

| State | Terminal? |
| --- | --- |
| `REGISTERED` | no |
| `DISCOVERING` | no |
| `READY` | no |
| `DEGRADED` | no |
| `DISABLED` | no |
| `QUARANTINED` | no |
| `REMOVED` | yes |

Owner: `runtime/kernel/delegated-capability-gateway-contract.md`
(`K-DELEG-*`).

## Runtime — Delegated Session

| State | Terminal? |
| --- | --- |
| `OPEN` | no |
| `PAUSED_FOR_APPROVAL` | no |
| `CLOSING` | no |
| `CLOSED` | yes |
| `FAILED` | yes |

Owner: `runtime/kernel/delegated-capability-gateway-contract.md`
(`K-DELEG-*`).

## Runtime — World Evolution Engine Stages

| Stage | Order |
| --- | --- |
| `INGRESS` | 1 |
| `NORMALIZE` | 2 |
| `SCHEDULE` | 3 |
| `DISPATCH` | 4 |
| `TRANSITION` | 5 |
| `EFFECT` | 6 |
| `COMMIT_REQUEST` | 7 |
| `CHECKPOINT` | 8 |
| `TERMINAL` | 9 |

Owner: `runtime/kernel/world-evolution-engine-contract.md` (`K-WEV-*`).

## Realm — App-World Binding

| State | Meaning |
| --- | --- |
| `(new)` | World exists; no app bound |
| `active` | Extension-app bound and writing |
| `suspended` | Binding paused |
| `revoked` | Binding removed |

A world has at most one active extension-app binding. Re-binding
requires explicit revoke first.

Owner: `realm/kernel/binding-contract.md` (`R-BIND-*`).

## Avatar — Composition State

| State | Meaning |
| --- | --- |
| `loading` | Initial load |
| `ready` | Embodiment composed and rendering |
| `degraded:*` | Degraded with sub-state (e.g. `degraded:asset_missing`) |
| `relaunch-pending` | Awaiting relaunch |

Owner: `avatar/kernel/index.md`.

## Cross-Domain State Machine Vocabulary

ScenarioJob and Workflow use UPPER_SNAKE proto enums; provider async
tasks use lower_snake to stay close to provider semantics. The casing
differences are intentional design.

## Source Basis

- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/daemon-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/daemon-lifecycle.md)
- [`.nimi/spec/runtime/kernel/scenario-job-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scenario-job-lifecycle.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
