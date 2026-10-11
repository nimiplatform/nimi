# Core State Machines Reference

Runtime health, asynchronous jobs, and Realm bindings have separate lifecycles. Avatar availability depends on the current App session and presentation prerequisites.

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

## 3. Realm App-World Binding States

| Binding State | Definition |
| --- | --- |
| `(new)` | World exists with zero registered extension apps |
| `active` | One extension app verified and actively writing state |
| `suspended` | Binding paused temporarily; state mutations blocked |
| `revoked` | Binding detached; world open for new applicant bindings |

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
