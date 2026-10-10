# CLI and Daemon

Runtime is Nimi's local execution service. Formal Apps reach its admitted operations through the Desktop-supervised Host and typed SDK, not an ordinary gRPC connection with a caller-selected App ID.

## Management Commands

| Command | Purpose |
| --- | --- |
| `nimi serve` | Run the explicit foreground Runtime path |
| `nimi start` / `nimi stop` | Request the admitted background or service controller |
| `nimi status` / `nimi health --json` | Read the sanitized manager or service summary |
| `nimi logs` | Read the admitted background manager's logs |
| `nimi doctor` | Diagnose the supported Runtime attachment and process prerequisites |
| `nimi version` | Report version information |
| `nimi init` / `nimi config` | Manage admitted configuration; not provider credentials or product data-root selection |

Background commands fail explicitly when the build has no admitted manager; they do not create a substitute process or probe private capability methods. A daemon process being present does not prove protected access, model preparation, or successful inference.

## Development and Production

For Home/App development, use the repository's supported development launch and Developer Mode flow. Windows and macOS local development use a per-user, non-elevated Runtime; the production service topology is not a prerequisite for that journey. Linux local App support remains deferred.

`nimi serve` is useful for explicit Runtime source development, but a foreground daemon alone does not authorize a formal App. Production service installation, custody, update, and uninstall have their own product lifecycle.

Product data discovery uses `~/.nimi/nimi.json`. The optional `NIMI_RUNTIME_CONFIG_PATH` is an explicit nonproduction portable mode with no default portable path. See [Runtime Configuration](/runtime/config-contract) before invoking configuration initialization; do not use a retired config path or create a second data-root authority.

## Configure AI in Home

Use Cloud Services for protected Connector custody and AI Capabilities for Loadouts, resources, and machine selection. Save the App or shared LocalAgent AIConfig separately. The CLI has no parallel provider credential, model selection, or generation configuration owner, and Knowledge V1 has no CLI path.

## Shutdown and Recovery

Daemon health uses `STARTING`, `READY`, `DEGRADED`, and `STOPPING`. Shutdown closes affected streams; transport closure may prevent a terminal frame from arriving. Never infer a successful generation from a closed connection. Re-establish authorized state and observe an existing Job or Conversation through its owner recovery contract; do not replay business work.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
