# State Machines

This page lists state machines that belong to the current core product
surface. Deferred Workflow, World Evolution, delegated-provider, and
hook scheduling models are intentionally not presented as Runtime
prerequisites.

## Runtime — Daemon Health

| State | Meaning |
| --- | --- |
| `STARTING` | Daemon initializing |
| `READY` | Daemon serving |
| `DEGRADED` | Daemon serving with reduced capability |
| `STOPPING` | Daemon draining; streams cancel cleanly |

## Runtime — ScenarioJob

| State | Terminal? |
| --- | --- |
| `SUBMITTED` | no |
| `QUEUED` | no |
| `RUNNING` | no |
| `COMPLETED` | yes (success) |
| `FAILED` | yes |
| `TIMEOUT` | yes |
| `CANCELED` | yes |

## Runtime — Observation Facts

Provider protocol phases remain private. The common Job exposes `submission_outcome` (`UNSPECIFIED`, `NOT_DISPATCHED`, `UNKNOWN`, `ACCEPTED`, `REJECTED`) and `stop_outcome` (`UNSPECIFIED`, `NOT_DISPATCHED`, `CONFIRMED`, `UNCONFIRMED`). Missing historical values remain unknown.

An observation issue does not change Job status. A local canceled result does not alone prove external work stopped. `TIMEOUT` requires actual bounded Host termination or confirmed provider expiration; elapsed Job age alone is insufficient. Use Get on the original Job and preserve the full terminal result.

## Realm — App-World Binding

| State | Meaning |
| --- | --- |
| `(new)` | World exists; no app bound |
| `active` | Extension app bound and writing |
| `suspended` | Binding paused |
| `revoked` | Binding removed |

This existing public-distribution model stays isolated from the
current Windows product loop. It does not make an App or Desktop the
owner of Realm truth.

## Avatar — Composition State

| State | Meaning |
| --- | --- |
| `loading` | Initial load |
| `ready` | Embodiment composed and rendering |
| `degraded:*` | Degraded with a reason-specific sub-state |
| `relaunch-pending` | Awaiting relaunch |

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
