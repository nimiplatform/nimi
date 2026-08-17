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
| `nimi start` | Start the daemon through an admitted background/service controller |
| `nimi stop` | Stop the daemon through that admitted controller |
| `nimi status` | Show admitted daemon-manager state |
| `nimi logs` | Read an admitted background manager's log |
| `nimi doctor` | Diagnose daemon and SDK attachment prerequisites |
| `nimi version` | Show CLI and daemon version |
| `nimi health` | Read the sanitized daemon-manager summary |

The CLI is not a remote-control surface for arbitrary state. It is
a small set of bounded operations that match the daemon's lifecycle
and observability needs. New verbs require admitted contract
extensions.

## First-Run Flow

The CLI does not have an install wizard. A source checkout or locally built
binary follows an explicit foreground path; background commands are available
only when that build has an admitted manager or service controller:

```bash
nimi init
nimi serve
```

Connector custody and ModelAsset/Loadout intent are committed through Desktop's
verified protected Runtime surface. An App then performs generation through the
typed SDK. The CLI does not provide a parallel provider, model-selection, or
generation configuration owner.

## Reader Scenario: Going From Install To First Generation

You have just installed Nimi and want to confirm everything works.

1. **Initialize config.** `nimi init` creates the runtime config
   when it is missing.
2. **Configure Runtime.** Use Desktop's protected Connector and ModelAsset /
   Loadout surfaces for the required capability intent.
3. **Daemon start.** Use `nimi serve`, or `nimi start` only on a build with an
   admitted background/service controller. The daemon's lifecycle moves through
   `STARTING → READY`.
4. **Verify.** On an admitted background topology, `nimi doctor` reports daemon
   and SDK attachment prerequisites and `nimi health --json` reads the
   sanitized daemon-manager summary. A build without that topology fails these
   commands explicitly instead of starting a fallback process.
5. **First generation.** The configured App connects through the SDK and issues
   a request. Runtime returns a typed result or typed failure.

The CLI surfaces bounded lifecycle and public health facts without exposing
Connector or ModelAsset custody state.

## Reader Scenario: Recovering From Degraded State

The daemon enters `DEGRADED` because a Runtime-owned subsystem can no longer
serve its declared contract. Detailed Runtime health remains on Desktop's
verified protected surface.

1. **The owning protected surface reports the typed degradation.** The daemon
   may still be serving with reduced capability.
2. **`nimi health --json`**, where background management is admitted, reports
   only whether the daemon is reachable,
   unreachable, service-running, or stopped without exposing private reasons.
3. **Action.** Use the owning protected surface to inspect or act on the typed
   reason.
4. **The protected health surface returns to `READY`.** Streams that were live
   during degradation either completed under the contract or
   were terminated with typed failure frames; new streams behave
   normally.

The typed state remains recoverable without projecting private ExecutionHost or
provider detail through the public CLI.

## Credential Custody

Connector credentials remain in Runtime custody and are managed through
Desktop's verified protected surface. The CLI has no provider or Connector
custody namespace. Ordinary App capability requests never inject provider
credentials or select a credential record.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
