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
| `RUNNING` | no |
| `COMPLETED` | yes (success) |
| `FAILED` | yes |
| `TIMEOUT` | yes |
| `CANCELED` | yes |

## Runtime — Provider Async Task

| State | Terminal? |
| --- | --- |
| `queued` | no |
| `running` | no |
| `succeeded` | yes |
| `failed` | yes |
| `expired` | yes (timeout-equivalent) |

Provider async states use lower snake case; ScenarioJob uses upper
snake case. The provider boundary maps terminal provider outcomes to
the corresponding ScenarioJob result.

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
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
