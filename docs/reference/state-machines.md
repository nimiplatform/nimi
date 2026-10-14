# Core State Machines Reference

Runtime health and asynchronous jobs follow deterministic lifecycles, Realm world authoring separates current CRUD operations from planned shared state contracts, and Avatar availability depends on the current App session and presentation prerequisites.

## 1. Runtime Daemon Health Lifecycle

| State | Definition | Permitted Operations |
| --- | --- | --- |
| `STARTING` | Process booting, initializing modules and stores | Loading configs, verifying model catalogs |
| `READY` | Runtime daemon operational and serving RPC requests | Accepting RPC invocations; individual capability readiness depends on local model/environment prerequisites |
| `DEGRADED` | Core daemon operational, but specific subsystem or diagnostic checks reported degraded status | Logging diagnostics, serving available subsystem operations |
| `STOPPING` | Graceful shutdown in progress; draining active streams | Refusing new tasks, flushing write buffers |

## 2. Asynchronous ScenarioJob State Machine

Long-running compute jobs transition through deterministic lifecycle milestones:

| State Code | Terminal? | Definition |
| --- | --- | --- |
| `SUBMITTED` | No | Job validated and registered, awaiting queue placement |
| `QUEUED` | No | Queued in worker pool, awaiting compute allocation |
| `RUNNING` | No | Active inference execution or token generation underway |
| `COMPLETED` | **Yes (Success)** | Task succeeded; all output artifacts finalized and accessible |
| `FAILED` | **Yes (Failure)** | Execution error encountered with diagnostic code |
| `TIMEOUT` | **Yes (Failure)** | Execution reached provider expiration or confirmed maximum timeout condition |
| `CANCELED` | **Yes** | Stoppage was requested; inspect `stopOutcome` (e.g., confirmed vs unconfirmed) for whether underlying work halted |

Jobs may report `submissionOutcome` to describe dispatch state. For `CANCELED` jobs, `stopOutcome` indicates whether underlying compute stoppage was verified (e.g. `confirmed`) or remains unconfirmed (`stopOutcome: 'unconfirmed'`). Other terminal states do not report `stopOutcome`; timeouts are handled under standard job observation and recovery contracts.

## 3. Realm World Authoring and Planned Shared State Boundaries

Realm does not use a per-world App binding state machine. Apps access Realm through an active protected host session, manifest `realm.data` declaration, and Runtime admission, while Realm enforces resource-level authorization. Runtime manages Realm credentials and remote connections.

### Current World Authoring Operations

Current world and character settings are maintained through `WorldCore`, `WorldCharacter`, and `PersonaCharacter`. Using the host-bound `client.realm.worldCore` and `client.realm.personaCharacter` surfaces, Apps can invoke only the fixed typed operations admitted by Runtime:

| Resource | Admitted App Operations | Notes |
| --- | --- | --- |
| `WorldCore` | `list`, `get`, `create`, `replace`, creation eligibility read | `create` requires explicit Realm administrator approval on the account (`realm.data`, subscriptions, or existing world ownership do not substitute, and reading eligibility does not replace the creation-time check). `replace` uses `baseContentHash` for optimistic concurrency. |
| `WorldCharacter` | `list`, `get`, `create`, `replace` | Operated as individual character records alongside `WorldCore`, not bundled into a multi-object transaction. |
| `WorldEntity` | `list`, `get`, `create` | Fixed typed entity operations on the target world. |
| `WorldRelationship` | `list`, `get` | Read-only for Apps; App-side relationship creation is not exposed. |

### Planned World State and World History (Design Reference)

`World State` and `World History` are planned standalone contracts. Currently, there are no approved controllers, tracked OpenAPI read/write operations, or general App write/subscription surfaces for shared world state or history.

- **Scope of `WorldState`**: Covers persistent shared world state only. It excludes App story runtime variables, prompt context, rendering state, cursors, and ephemeral session state.
- **Commit Envelope**: Planned state submissions carry `worldId`, `appId`, `sessionId`, `effectClass`, `scope`, `schemaId`, `schemaVersion`, `actorRefs`, `reason`, and `evidenceRefs`.
- **Target Scope & Effect Class**: `scope` is constrained to `WORLD`, `ENTITY`, or `RELATION` (`ENTITY` and `RELATION` do not accept arbitrary generic JSON structures). `effectClass` must be explicitly specified as `NONE`, `STATE_ONLY`, or `STATE_AND_HISTORY` with no assumed default.
- **Mutation Authorization**: `REPLAY` contexts are strictly forbidden from committing shared State or appending History without exception. `CANON_MUTATION` additionally requires matching an explicit `app` / `schema` / `effect` / `scope` authorization matrix.
- **History Semantics**: `World History` records only admitted factual events. Corrections append superseding or invalidating entries rather than performing silent hard deletes, and private story logs do not automatically become world history.

## 4. Avatar Readiness

Avatar selects its shell view from the current App session, launch context, driver, and model prerequisites. Product interaction additionally requires a ready backend presentation.

| Condition | Visible result | Product interaction |
| --- | --- | --- |
| Shell or Runtime preparation is incomplete | Loading view | Unavailable |
| Session, launch, driver, or model prerequisites fail | Diagnostic view with the failure reason | Unavailable |
| Validated development preview (`fixture_not_verified`) | Model preview, explicitly marked as development output | Unavailable; a rendered preview does not prove a valid Runtime binding |
| Runtime-backed App session and required prerequisites are valid; backend presentation is ready | Product model view; Companion surface when requested | Available |

The App-local diagnostic values and launch-field requirements are described in [Avatar Instance Lifecycle](/avatar/instance-lifecycle).

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
