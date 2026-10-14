# Runtime CLI and Startup Paths

The source development supervisor and the installed fixed service rely on different entry points. Identify your target environment before choosing startup or diagnostic commands.

## Source Development

At the Nimi repository root, run this in a dedicated terminal:

```sh
pnpm dev:runtime
```

The script starts the current-user source Runtime supervisor and prints its logs directly to the terminal. Next, run `pnpm dev:desktop` and sign in through Home. Ensure dependencies, Realm/Web, and OS prerequisites are prepared according to [Development Environment Setup](/start/install) and the repository's LOCAL_DEVELOPMENT.md.

You cannot substitute `pnpm dev:runtime` with `nimi serve` in a standard Windows development terminal. The `nimi serve` command enters the production daemon lifecycle and requires the fixed Windows service identity.

## Installed Windows Fixed Service

These commands require the corresponding fixed service to be installed and its control prerequisites satisfied. Current macOS/Linux builds do not provide this background service controller. These commands also do not manage the source supervisor.

| Command | Purpose |
| --- | --- |
| `nimi status` | Inspect fixed-service status |
| `nimi start` | Start the installed fixed service |
| `nimi stop` | Stop that fixed service |
| `nimi logs` | Inspect its logs |

`nimi serve` is an entry point for the production daemon itself; executing it in an unprivileged terminal will not launch or manage the protected service.

## Environment and Service Diagnostics

- `nimi doctor` checks local environment and dependency prerequisites.
- `nimi version` reports the binary version.
- `nimi health --json` reads the running service's health summary, subject to reachability and access conditions.

A `READY` state indicates that the daemon is actively serving RPC requests. However, executing a specific AI operation still requires a valid session and execution configuration, plus a ready local Loadout or supported cloud target according to the selected route. Running the source supervisor in current-user mode does not establish the identity or configuration of a production fixed service.

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
