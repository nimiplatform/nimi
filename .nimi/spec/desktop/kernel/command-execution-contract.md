# Desktop Tauri Command Execution Contract

> Owner Domain: `D-GATE-*`

This contract governs Desktop Tauri invoke command execution posture. It is the normative authority for command responsiveness classification; external-host task state and execution dossiers are non-authoritative evidence only.

## D-GATE-092 Command Execution Classes

Every Desktop Tauri command registered through `tauri::generate_handler![...]` must belong to exactly one execution class in `tables/command-execution-classification.yaml`:

- `ui_sync`: pure in-memory or constant configuration reads only. No I/O, process, network, dialog, lock wait, recursive walk, hashing, archive, socket, sleep, raw thread, `spawn_blocking`, or `block_on` may be reachable.
- `request_response_async`: async request/response command. Network, runtime bridge unary/stream, daemon status, and package-owned async bridge work must stay async-aware and must not hide sync blocking work as success.
- `background_job`: long-running transfer, install, archive, copy, import, hash, scan, migration, rebuild, or bulk mutation. The invoke response must be an accepted job/progress contract or an equivalent already-admitted background handoff; cancellation, progress, failure, and rollback semantics must be owned by the command family before true close.
- `bounded_blocking_with_admission`: explicitly admitted small synchronous work with a named risk family, owner, and bound. This class is for native UI handoff, one-shot local store reads/writes, small fixture reads, and user-triggered OS actions only.
- `registered_disabled_stub`: registered command that intentionally returns a fail-closed error and no active side effect. This is not a risk waiver; re-enabling requires reclassification before registration.

An `async fn` signature is not sufficient evidence of responsiveness. A `spawn_blocking` wrapper is not a final execution model unless the command family is admitted as `background_job` or `bounded_blocking_with_admission` with explicit ownership and observability.

## D-GATE-093 Registered Invoke Surface SSOT

The registered invoke surface is the balanced parse of `tauri::generate_handler![...]` in `apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs`, resolved against annotated command definitions across these admitted roots:

- `apps/desktop/src-tauri/src/**`
- `kit/shell/tauri/src/**`

The gate must fail closed when the registered command count is zero, when the macro cannot be parsed by bracket balance, when a registered command has no cross-crate annotated definition, or when a registered command has no classification match.

Package-owned command families are first-class Desktop invoke surface:

- `oauth_*`
- `runtime_bridge_*`
- `log_renderer_event`
- `open_external_url`
- shared `runtime_defaults` implementations when registered by a host app

They must not be treated as unscannable or outside risk classification.

## D-GATE-094 Blocking Risk Admission Catalog

The Desktop command execution gate must classify at least these risk families before a command can be admitted:

- blocking HTTP or synchronous DNS/connect
- runtime bridge synchronous `block_on`, `tokio::runtime::Handle::block_on`, `futures::executor::block_on`, and `tokio::task::block_in_place`
- process spawn/probe
- archive or compression extraction
- synchronous SQLite
- filesystem read/write/copy/walk/remove/reveal
- native dialog
- sleep or polling wait
- raw thread spawn
- `spawn_blocking`
- synchronous lock contention
- CPU-heavy hash, codec, or bundle verification
- synchronous socket bind/probe
- OS/browser/window handoff
- keyring or credential dialog

New command code that touches one of these sources without classification and explicit admission must fail the gate. Existing debt may be marked `remediation_required: true`; that marker is a W3 obligation, not closure.

## D-GATE-095 Dormant Command Boundary

Annotated but unregistered Tauri commands are not active invoke surface. They must still be classified as either:

- `dormant_admitted`: intentionally retained but unavailable through `generate_handler!`; re-registration requires active command classification first.
- `dead_for_removal`: not needed and must be deleted before closure.

A dormant command must never satisfy active remediation counts, and a registered command must never remain under dormant classification.

## D-GATE-096 Command Execution Gate

`pnpm check:desktop-tauri-command-execution` is the hard gate for this contract. It must:

- parse the registered invoke surface with a balanced parser;
- scan both app-local and `kit/shell/tauri` command roots;
- validate every registered command against `tables/command-execution-classification.yaml`;
- validate every annotated unregistered command against a dormant/dead classification;
- reject zero-command parses, missing command definitions, missing risk catalog entries, and unadmitted direct blocking risks;
- report current `remediation_required` command families without treating them as closed.

Remediation must consume the classification table as its starting backlog and may only move a family out of `remediation_required` after implementation and gate evidence prove the target execution class.
