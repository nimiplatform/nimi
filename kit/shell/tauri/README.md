# nimi-shell-tauri

Shared Rust/Tauri host glue for Nimi apps.

This crate owns app-agnostic shell behavior only and consumes the shared native
`kit/shell/protected-local` carrier for protected Runtime access:

- public/binding-only runtime bridge commands and stream lifecycle;
- typed fixed-service status, start, and Runtime-self-exit/service-manager restart;
- non-security runtime defaults;
- renderer diagnostic logging;
- native browser/callback observation helpers; Runtime owns OAuth exchange;
- desktop path resolution helpers.

It does not own app business logic, a host-loaded plugin model, Realm login, or
generated app token exchange. Apps keep product commands in their own
`src-tauri` crate and register them separately.

It also does not own or expose Runtime stop, binary/service/path selection,
generic Runtime config documents, Realm/provider credentials, protected
session/process/trust material, or a renderer-selectable protected gRPC proxy.

## Package Boundary

The public crate name is `nimi-shell-tauri`, imported from Rust as
`nimi_shell_tauri`. The initial version is `0.1.0`.

Workspace apps may consume it with a path dependency:

```toml
nimi-shell-tauri = { path = "../../../kit/shell/tauri" }
```

Standalone apps consume the published crate after publication is performed by a
human release owner.

## Command Registration

Apps may keep explicit `tauri::generate_handler!` registration for narrow
command sets, or use one of the scoped macros when the app wants that exact
shared shell set plus app-local commands:

```rust
tauri::Builder::default()
    .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_oauth_runtime_bridge_handler![
        app_local_command,
    ]);
```

Available macros:

- `nimi_shell_tauri_runtime_bridge_handler!`
- `nimi_shell_tauri_oauth_runtime_bridge_handler!`
- `nimi_shell_tauri_local_app_standard_shell_handler!` (the isolated catalogued
  Local App carrier only, including owner-free App AIConfig get/overwrite and
  Runtime-selected foreground text candidates)

The command catalog is also exposed through
`nimi_shell_tauri::command_registration` for tests, audits, and apps that need
to keep registration fully explicit.
