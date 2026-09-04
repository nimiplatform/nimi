# Runtime Configuration

> Status: Running today. Active authority is
> `.nimi/spec/runtime/protected-session.authority.yaml` and
> `.nimi/spec/runtime/service-operations.authority.yaml`.

Runtime configuration and Product Control are separate:

- `~/.nimi/nimi.json` is the fixed Product Control record and the only
  product-discovery authority for `dataRoot.path`.
- On Windows, `%ProgramData%\Nimi\Runtime\Protected` contains
  service-principal-owned private state, configuration, credentials, sessions,
  audit, and data-root verification evidence.
- Protected Runtime state may contain only a derived binding to the Product
  Control selection. It cannot select or override `dataRoot.path`; disagreement
  fails closed and enters repair.

## Production

Production Runtime does not discover a user-writable portable config file. Its
private configuration location is fixed by the installed protected service and
is neither user-configurable nor reported as an ordinary physical path.

The selected data plane is always read from Product Control and derives exactly:

```text
<dataRoot>/models
<dataRoot>/dependencies
<dataRoot>/environments
<dataRoot>/apps
<dataRoot>/accounts
<dataRoot>/logs
<dataRoot>/audit
```

Environment variables, argv, Desktop state, tests, and protected Runtime state
cannot supply another product data root.

## Explicit nonproduction portable mode

`NIMI_RUNTIME_CONFIG_PATH` exists only as an explicit nonproduction portable
configuration entry. There is no default portable config path. In particular,
`~/.nimi/runtime/config.json` and `~/.nimi/config.json` are retired and are not
discovery or migration inputs.

Portable configuration:

- must use the current schema and fail closed on invalid content;
- may configure nonproduction Runtime behavior and provider setup;
- must not contain `dataRootRef` or any `managedRoots` value;
- must not become Product Control or production Runtime private state;
- is shown by `nimi doctor` or `nimi version` only when explicitly supplied,
  and then only with a nonproduction label.

Portable configuration never owns provider credentials. CLI attempts to mutate
`providers.*` fail closed; production credentials and configuration remain in
protected Connector service custody.

## Validation and writes

Configuration validation is fail-closed; partial success is not admitted.
Service-owned and explicit portable writes use atomic replacement. Reload
behavior must be declared per field; an undeclared field is not assumed to
hot-reload.

## What Runtime configuration does not do

- It does not locate or choose `dataRoot.path`.
- It does not read Product Control from ProgramData.
- It does not default to a file below `~/.nimi/runtime`.
- It does not expose production private configuration paths through
  `doctor`, `version`, Desktop, SDK, or app surfaces.
- It does not allow a portable config to override Product Control or protected
  Runtime-derived data-root verification.

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
