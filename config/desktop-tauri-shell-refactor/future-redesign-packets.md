# Desktop Tauri Shell Refactor Future Redesign Packets

Date: 2026-07-09

This tracked config file records commands and capability names that remain out of scope for the current Tauri-first refactor batch. It is audit evidence only. Executable authority stays in `.nimi/spec/desktop/kernel/tables/ipc-commands.yaml`, `.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml`, and the active Tauri registration surface.

| Command or capability | Current batch disposition | Current owner bucket | Future redesign target | Blocker before migration |
| --- | --- | --- | --- | --- |
| `http_request` | Retained app-local | `desktop-admitted-shell-network` | kit shell host network capability | Requires a shell-network authority redesign covering allowed callers, URL policy, auth/header custody, error envelope, and Electron parity before Kit registration. |
| `get_system_resource_snapshot` | Retained app-local | `desktop-device-profile` | kit device-probe | Requires a device-probe authority redesign covering platform data shape, privacy boundary, command execution policy, and non-Tauri host behavior. |
| `desktop_agent_center_avatar_asset_import` | Retained app-local | `desktop-agent-center-resource-store` | kit/features/avatar custody/import capability | Requires an avatar custody/import authority redesign covering digest validation, resource admission, runtime manifest projection, and package ownership. |
| `desktop_agent_center_avatar_asset_validate` | Retained app-local | `desktop-agent-center-resource-store` | kit/features/avatar custody/import capability | Requires the same avatar custody/import redesign as import; validation must not become a parallel app-local truth after migration. |
| `nimi.shell.aiProfile.get` | Not implemented or registered in this batch | Desktop renderer host service/storage remains current AI config surface | AI config authority redesign | Current authority is not a Tauri/Kit Rust store. Migration requires an admitted AI config owner and custody model before adding standard shell storage commands. |
| `nimi.shell.aiConfig.get` | Not implemented or registered in this batch | Desktop renderer host service/storage remains current AI config surface | AI config authority redesign | Same authority blocker as `nimi.shell.aiProfile.get`; no Kit command may compute or persist AI config in this batch. |
| `nimi.shell.aiConfig.set` | Not implemented or registered in this batch | Desktop renderer host service/storage remains current AI config surface | AI config authority redesign | Same authority blocker as `nimi.shell.aiProfile.get`; no Kit command may compute or persist AI config in this batch. |
| `chat_ai_*` | Retained app-local | `desktop-chat-local-store` | pending explicit decision between admitted Desktop local truth and runtime ownership | Requires a product authority decision before moving local SQLite chat state into runtime or admitting it as durable Desktop-local truth. |

Batch invariant: none of the rows above are in-batch Kit migration candidates. They may only move after a separate redesign preflight updates canonical authority first.
