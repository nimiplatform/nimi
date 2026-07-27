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
| `nimi init` | Initialize runtime configuration |
| `nimi serve` | Run the daemon in the foreground |
| `nimi start` | Start the daemon in the background |
| `nimi stop` | Stop the daemon |
| `nimi status` | Show daemon state |
| `nimi logs` | Read the daemon's log |
| `nimi doctor` | Diagnose daemon, providers, models, audit volume, replication backlog |
| `nimi version` | Show CLI and daemon version |
| `nimi run` / `nimi chat` | Generate text through the default or selected runtime route |
| `nimi provider` | Configure and test cloud providers |
| `nimi model` | List, pull, remove, and check local models |

The CLI is not a remote-control surface for arbitrary state. It is
a small set of bounded operations that match the daemon's lifecycle
and observability needs. New verbs require admitted contract
extensions.

## First-Run Flow

The CLI does not have an install wizard. A source checkout or locally
built binary follows an explicit command path:

```bash
nimi init
nimi provider set gemini --api-key-env GEMINI_API_KEY --default
nimi start
nimi run "What is Nimi?"
nimi doctor
```

For local-first setup, replace the provider step with the relevant
local model pull and readiness checks:

```bash
nimi model list
nimi model pull --model-ref <admitted-model-ref>
nimi model health --model-id <installed-model-id>
```

Both cloud and local paths converge on a daemon that is `READY` with
at least one admitted route to AI capability. If a required provider
or local model is missing, the CLI reports the missing route instead
of silently falling back to another execution path.

## Reader Scenario: Going From Install To First Generation

You have just installed Nimi and want to confirm everything works.

1. **Initialize config.** `nimi init` creates the runtime config
   when it is missing.
2. **Configure a route.** For cloud, `nimi provider set <provider>`
   writes provider credentials or credential references into runtime
   config. For local execution, `nimi model pull` installs an
   admitted local model bundle.
3. **Daemon start.** `nimi serve` (or `nimi start` for
   background). The daemon's lifecycle moves through
   `STARTING → READY`.
4. **Verify.** `nimi doctor` reports daemon `READY`, provider
   health green, model readiness green, audit volume zero,
   replication backlog zero.
5. **First generation.** `nimi run "What is Nimi?"` or an app
   connecting through the SDK issues a request. Runtime routes the
   request through the configured cloud or local target and returns a
   typed result or typed failure.

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

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`docs/spec/runtime-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/runtime-domain-index.md)
- [`config/spec-frozen/runtime/tables/daemon-health-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/spec-frozen/runtime/tables/daemon-health-states.yaml)
