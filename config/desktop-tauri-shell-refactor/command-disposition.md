# Desktop Tauri App-Local Command Disposition

Date: 2026-07-09

This tracked config report is machine-checkable audit evidence for the Desktop Tauri shell refactor. It is not parallel authority. The executable command surface remains `.nimi/spec/desktop/kernel/tables/ipc-commands.yaml` and `apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs`; execution classification machine config is `config/desktop-command-execution-classification.yaml`, and its normative authority is `.nimi/spec/canonical/desktop/command-execution.authority.yaml`.

Current command accounting after the Agent Center Kit-shell hardcut:

| Bucket | Count |
| --- | ---: |
| Registered Desktop Tauri commands | 106 |
| Kit/shared injected commands | 46 |
| App-local Desktop commands | 60 |
| Dormant annotated commands | 17 |

Owner bucket vocabulary:

| Bucket | Meaning |
| --- | --- |
| `desktop-product` | Desktop product orchestration, shell lifecycle, product configuration, or app-specific resource policy. |
| `desktop-packaging` | Desktop release, updater, packaging, or restart behavior. |
| `desktop-acceptance-instrumentation` | Fixture-gated smoke or acceptance instrumentation, not product UI. |
| `runtime-domain-retained` | Desktop command retained because it currently bridges a runtime-owned domain or runtime-local asset contract. |
| `desktop-support` | Support logs, cleanup, diagnostics, or user support workflows. |
| `future-redesign-retained` | Retained app-local only until a separate authority redesign admits a future owner. |

| Command | Owner bucket | Renderer consumer | Reason retained | Future owner or redesign target |
| --- | --- | --- | --- | --- |
| `desktop_release_info_get` | `desktop-packaging` | `runtime-bridge/desktop-release.ts`, `runtime-parsers.ts` | Reads packaged Desktop release metadata and bundled runtime state. | None admitted. |
| `desktop_update_state_get` | `desktop-packaging` | `runtime-bridge/desktop-release.ts`, `runtime-parsers.ts` | Reads Desktop updater state machine. | None admitted. |
| `desktop_update_check` | `desktop-packaging` | `runtime-bridge/desktop-release.ts`, `runtime-parsers.ts` | Starts Desktop updater check against packaged update policy. | None admitted. |
| `desktop_update_download` | `desktop-packaging` | `runtime-bridge/desktop-release.ts` | Downloads Desktop update payload under updater custody. | None admitted. |
| `desktop_update_install` | `desktop-packaging` | `runtime-bridge/desktop-release.ts` | Installs downloaded Desktop update payload. | None admitted. |
| `desktop_update_restart` | `desktop-packaging` | `runtime-bridge/desktop-release.ts` | Hands off to Desktop updater restart behavior. | None admitted. |
| `desktop_open_intent_set_ready` | `desktop-product` | `runtime-bridge/desktop-open-intent.ts` | Marks Desktop renderer readiness for product open-intent delivery. | None admitted. |
| `developer_mode_status` | `desktop-product` | `features/developer/developer-mode.ts` | Reads the fixed-service Developer Mode projection through the protected Tauri carrier. | Runtime Developer Mode authority remains current. |
| `developer_mode_set` | `desktop-product` | `features/developer/developer-mode.ts` | Enables or disables fixed-service Developer Mode through the protected Tauri carrier. | Runtime Developer Mode authority remains current. |
| `local_development_pending_approvals` | `desktop-product` | `features/local-development/local-development-bridge.ts` | Lists pending local-development project admissions from Runtime truth. | Runtime local-development authority remains current. |
| `local_development_decide` | `desktop-product` | `features/local-development/local-development-bridge.ts` | Records the user decision for a Runtime-owned local-development admission. | Runtime local-development authority remains current. |
| `local_development_authorizations_list` | `desktop-product` | `features/local-development/local-development-bridge.ts` | Lists Runtime-owned allow-project authorizations. | Runtime local-development authority remains current. |
| `local_development_runs_list` | `desktop-product` | `features/local-development/local-development-bridge.ts` | Projects supervised local-development runs from Runtime truth. | Runtime local-development authority remains current. |
| `local_development_authorization_revoke` | `desktop-product` | `features/local-development/local-development-bridge.ts` | Revokes a Runtime-owned allow-project authorization. | Runtime local-development authority remains current. |
| `product_control_record_get` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Bridges runtime product-control record read. | Runtime owner remains current. |
| `product_control_selected_data_root_get` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Bridges selected data-root projection from product-control record. | Runtime owner remains current. |
| `product_control_record_ensure_created` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Creates canonical product-control record through runtime-domain admission. | Runtime owner remains current. |
| `product_control_record_select_data_root` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Selects data root through product-control admission. | Runtime owner remains current. |
| `product_control_record_complete_first_run_device_environment_scan` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Completes first-run device-environment scan evidence. | Runtime owner remains current. |
| `product_control_default_data_root_directory` | `desktop-product` | `runtime-bridge/product-control.ts` | Proposes Desktop default data-root path without mutating runtime truth. | None admitted. |
| `product_control_record_set_first_run_install_level` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Sets first-run install level through runtime-domain admission. | Runtime owner remains current. |
| `product_control_record_ensure_account_default_profile` | `desktop-product` | `runtime-bridge/product-control.ts` | Materializes Desktop account-default profile evidence for first-run readiness. | AI/profile authority redesign required before any Kit move. |
| `product_control_record_prepare_first_run_local_ai_ready` | `desktop-product` | `runtime-bridge/product-control.ts` | Materializes Desktop local-AI readiness evidence for first-run admission. | AI config authority redesign required before any Kit move. |
| `product_control_record_reconcile_first_run_setup_state` | `desktop-product` | `runtime-bridge/product-control.ts` | Reconciles Desktop first-run setup evidence against product-control state. | AI config authority redesign required before any Kit move. |
| `account_default_profile_for_scope_init` | `desktop-product` | `runtime-bridge/product-control.ts` | Initializes scoped account default profile evidence. | AI/profile authority redesign required before any Kit move. |
| `built_in_ai_config_for_scope_init` | `desktop-product` | `runtime-bridge/product-control.ts` | Initializes built-in Desktop AI config evidence for a scope. | AI config authority redesign required before any Kit move. |
| `account_profile_library_list` | `desktop-product` | `runtime-bridge/account-profile-library.ts` | Lists Desktop account profile library records. | None admitted. |
| `account_profile_library_create` | `desktop-product` | `runtime-bridge/account-profile-library.ts` | Creates Desktop account profile library record and files. | None admitted. |
| `account_profile_library_edit` | `desktop-product` | `runtime-bridge/account-profile-library.ts` | Edits Desktop account profile library record. | None admitted. |
| `account_profile_library_import` | `desktop-product` | `runtime-bridge/account-profile-library.ts` | Imports Desktop account profile library records. | None admitted. |
| `account_profile_library_export` | `desktop-product` | `runtime-bridge/account-profile-library.ts` | Exports Desktop account profile library records. | None admitted. |
| `account_profile_library_delete` | `desktop-product` | `runtime-bridge/account-profile-library.ts` | Deletes Desktop account profile library record and index state. | None admitted. |
| `product_control_record_admit_ready_for_use` | `runtime-domain-retained` | `runtime-bridge/product-control.ts` | Admits product-control ready-for-use state through runtime-domain checks. | Runtime owner remains current. |
| `nimi_data_cleanup_plan` | `desktop-support` | `runtime-bridge/nimi-data-directory.ts` | Plans Desktop support cleanup for Nimi data directories. | None admitted. |
| `nimi_data_cleanup_execute` | `desktop-support` | `runtime-bridge/nimi-data-directory.ts` | Executes admitted Desktop support cleanup. | None admitted. |
| `desktop_logs_export` | `desktop-support` | `runtime-bridge/support-logs-export.ts`, `features/support/support-logs-section.tsx` | Exports Desktop support logs archive for user support. | None admitted. |
| `get_system_resource_snapshot` | `future-redesign-retained` | `runtime-bridge/system-resources.ts`, `runtime-parsers.ts` | Retained app-local device profile probe. | Future redesign target: kit device-probe. |
| `http_request` | `future-redesign-retained` | `runtime-bridge/http.ts`, `runtime-bridge/invoke.ts` | Retained admitted shell network helper. | Future redesign target: kit shell host network capability. |
| `desktop_avatar_launch_handoff` | `desktop-product` | `runtime-bridge/chat-agent-avatar-launcher.ts` | Launches Desktop avatar process/window handoff. | None admitted. |
| `desktop_avatar_close_handoff` | `desktop-product` | `runtime-bridge/chat-agent-avatar-launcher.ts` | Closes Desktop avatar process/window handoff. | None admitted. |
| `desktop_avatar_instance_registry_list` | `desktop-product` | `runtime-bridge/chat-agent-avatar-instance-registry.ts` | Lists Desktop avatar instance registry projection. | None admitted. |
| `desktop_macos_smoke_context_get` | `desktop-acceptance-instrumentation` | `runtime-bridge/macos-smoke.ts`, `runtime-parsers.ts` | Fixture-gated macOS smoke context read. | Remove only after equivalent real shell acceptance runner exists. |
| `desktop_macos_smoke_report_write` | `desktop-acceptance-instrumentation` | `runtime-bridge/macos-smoke.ts`, `runtime-parsers.ts` | Fixture-gated macOS smoke report writer. | Remove only after equivalent real shell acceptance runner exists. |
| `desktop_macos_smoke_ping` | `desktop-acceptance-instrumentation` | `runtime-bridge/macos-smoke.ts`, `main.tsx` | Fixture-gated macOS smoke backend stage ping. | Remove only after equivalent real shell acceptance runner exists. |
| `menu_bar_sync_runtime_health` | `desktop-product` | `runtime-bridge/menu-bar.ts` | Synchronizes Desktop menu-bar runtime health projection. | None admitted. |
| `menu_bar_complete_quit` | `desktop-product` | `runtime-bridge/menu-bar.ts` | Completes Desktop menu-bar quit lifecycle. | None admitted. |
| `chat_ai_list_threads` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite chat thread list. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_get_thread_bundle` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite thread bundle read. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_create_thread` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite thread creation. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_update_thread_metadata` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite thread metadata update. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_create_message` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite message creation. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_update_message` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite message update. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_get_draft` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite draft read. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_put_draft` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite draft write. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `chat_ai_delete_draft` | `future-redesign-retained` | `runtime-bridge/chat-ai-store.ts` | Retained Desktop local SQLite draft deletion. | Pending decision: admitted Desktop local truth or runtime ownership. |
| `runtime_local_pick_asset_manifest_path` | `runtime-domain-retained` | `runtime-bridge/local-runtime-os-helpers.ts` | Keeps manifest picker tied to runtime-local manifest canonicalization rules. | None admitted. |
