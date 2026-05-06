# CLI And Daemon

Runtime is a single Go binary daemon plus a CLI. This page describes
the user-facing surface — what the daemon is, what the CLI does, and
how a typical first run looks.

## The Daemon

The Runtime daemon is the long-running process that owns AI
execution on your machine. Apps connect to it via gRPC. It is the
single seat for text / image / video / audio / embedding / STT / TTS
work, GPU arbitration, model lifecycle, and the local audit ledger.

| Property | Value |
| --- | --- |
| Binary | Single Go binary |
| Transport | gRPC |
| Lifecycle | `STARTING → READY → DEGRADED → STOPPING` |
| Multi-agent | Hosts multiple `agent_id` lifecycles concurrently |
| Default current agent | None (multi-agent by default) |

Daemon health states have explicit semantics. Streams cancel
cleanly on `STOPPING`; the daemon does not abandon in-flight
streams without a typed terminal frame.

## The CLI (`nimi`)

The CLI is the user-facing tool that drives the daemon and reports
on its state.

| Command | Purpose |
| --- | --- |
| `nimi install` | First-time install path |
| `nimi serve` | Run the daemon in the foreground |
| `nimi start` | Start the daemon in the background |
| `nimi stop` | Stop the daemon |
| `nimi status` | Show daemon state |
| `nimi logs` | Read the daemon's log |
| `nimi doctor` | Diagnose daemon, providers, models, audit volume, replication backlog |
| `nimi version` | Show CLI and daemon version |

The CLI is not a remote-control surface for arbitrary state. It is
a small set of bounded operations that match the daemon's lifecycle
and observability needs. New verbs require admitted contract
extensions.

## First-Run Flow

The first run has a defined shape so users do not face an undefined
"what now" moment after install.

```
install → first-run choice
                │
       ┌────────┴────────┐
       ▼                 ▼
provider-first    local-model-first
cloud setup       install
       │                 │
       └─────────┬───────┘
                 ▼
           daemon ready
```

| Path | When to take it |
| --- | --- |
| Provider-first cloud setup | You have an admitted cloud provider account and want to start with cloud capability |
| Local model first | You want to start fully local; install a local engine and a model bundle |

Both paths converge on a daemon that is `READY` with at least one
admitted route to AI capability.

## Reader Scenario: Going From Install To First Generation

You have just installed Nimi and want to confirm everything works.

1. **Install.** `nimi install` runs the install path. The
   daemon binary is placed; configuration is bootstrapped.
2. **First-run choice.** The CLI presents the provider-first or
   local-model first choice. You pick provider-first because you
   already have a provider account.
3. **Connector setup.** You add a connector — a managed identity
   for the provider. Credentials are validated; the connector
   reports the models it can route to.
4. **Daemon start.** `nimi serve` (or `nimi start` for
   background). The daemon's lifecycle moves through
   `STARTING → READY`.
5. **Verify.** `nimi doctor` reports daemon `READY`, provider
   health green, model readiness green, audit volume zero,
   replication backlog zero.
6. **First generation.** An app connects via gRPC and issues a
   request. The request becomes a `ScenarioJob`; the workflow
   moves through `ACCEPTED → QUEUED → RUNNING → COMPLETED`.

The CLI surfaces enough to confirm health without exposing
internal state. If `nimi doctor` reports anything yellow or red,
the report names the area and points at the relevant kernel rule
context.

## Reader Scenario: Recovering From Degraded State

The daemon enters `DEGRADED` — perhaps a provider went unhealthy
mid-session, perhaps replication is backlogged.

1. **`nimi status` reports `DEGRADED`.** The daemon is still
   serving but with reduced capability.
2. **`nimi doctor`** reports the specific degradation: provider
   X health red, replication backlog N.
3. **Action.** You fix the underlying issue (swap to another
   admitted provider, wait for backlog to drain, restart a stuck
   sub-component).
4. **`nimi status` reports `READY`.** Streams that were live
   during degradation either completed under the contract or
   were terminated with typed failure frames; new streams behave
   normally.

The state machine is what makes this recoverable. A binary
"healthy / unhealthy" report would not tell you what is actually
wrong; the typed degradation lets the CLI point at the area.

## Credential Plane Split

The CLI manages credentials under a strict isolation boundary:

| Plane | Purpose |
| --- | --- |
| `daemon-config` | Config-driven API keys (set once, persistent) |
| `request-credential` | Request-time injection from trusted hosts |

The two planes are strictly isolated. A `daemon-config` key never
leaks into a `request-credential` request, and vice versa. This
matters because the trust boundary differs: daemon config keys are
admitted at startup; request credentials are admitted per request.

## Source Basis

- [`.nimi/spec/runtime/cli.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/cli.md)
- [`.nimi/spec/runtime/config.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/config.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/daemon-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/daemon-lifecycle.md)
- [`.nimi/spec/runtime/kernel/config-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/config-contract.md)
- [`.nimi/spec/runtime/kernel/tables/daemon-health-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/daemon-health-states.yaml)
