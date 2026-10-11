# Runtime CLI and Startup Paths

The source development supervisor and an installed fixed service use different entry points. Identify the environment before choosing startup or diagnostic commands.

## Source Development

At the Nimi repository root, run this in a dedicated terminal:

```sh
pnpm dev:runtime
```

The script starts the current-user source Runtime supervisor and prints its logs in the terminal. Then run `pnpm dev:desktop` and sign in through Home. Prepare dependencies, Realm/Web, and OS prerequisites using [Development Environment Setup](/start/install) and the repository's LOCAL_DEVELOPMENT.md.

An ordinary Windows development terminal cannot use `nimi serve` as a substitute. That command enters the production daemon path and requires the fixed Windows service identity.

## Installed Windows Fixed Service

These commands require the corresponding fixed service to be installed and its control prerequisites to be satisfied. The current macOS/Linux builds do not provide this background service controller. These commands also do not manage the source supervisor.

| Command | Purpose |
| --- | --- |
| `nimi status` | Inspect fixed-service status |
| `nimi start` | Start the installed fixed service |
| `nimi stop` | Stop that fixed service |
| `nimi logs` | Inspect its logs |

`nimi serve` is a production daemon entry point, not permission to start the protected service from an ordinary terminal.

## Environment and Service Diagnostics

- `nimi doctor` checks local environment and dependency prerequisites.
- `nimi version` reports the binary version.
- `nimi health --json` reads the corresponding running service's health summary, subject to reachability and its access conditions.

READY means the daemon is serving RPCs. A particular AI operation still needs a valid Loadout, model, session, and execution configuration. The source supervisor's current-user mode does not establish the identity or configuration of a production fixed service.

## Related Documentation

- [Runtime Configuration](/runtime/config-contract)
- [App Troubleshooting](/start/troubleshooting)

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`scripts/dev-runtime.mjs`](https://github.com/nimiplatform/nimi/blob/main/scripts/dev-runtime.mjs)
- [`runtime/internal/entrypoint/runtime_production_windows.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/entrypoint/runtime_production_windows.go)
- [`runtime/internal/daemonctl/manager.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/daemonctl/manager.go)
- [`runtime/internal/daemonctl/protected_service_controller_stub.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/daemonctl/protected_service_controller_stub.go)
