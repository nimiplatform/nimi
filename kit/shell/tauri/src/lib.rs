// nimi-shell-tauri: Shared Tauri host glue for Nimi apps
//
// Single shared owner for app-agnostic Rust/Tauri host glue:
// - runtime_bridge: gRPC-over-IPC bridge (channel pool, codec, unary/stream, daemon manager)
// - runtime_local_agent_identity: Runtime local-agent identity parsing/projection
// - runtime_defaults: env reading, loopback normalization, realm/runtime defaults
// - session_logging: panic hook, renderer log_renderer_event sink, stderr echo
// - oauth_commands: listen for code and open external URL
// - desktop_paths: nimi directory resolution
// - governed_config: shared `.nimi` current-schema repair routing
// - nimi_data_directory: shared `nimi_data` layout and cleanup primitives
// - platform_projection: deterministic host projection record builders
// - agent_center_avatar_asset: shared Agent Center Avatar local asset resolution
// - standard_agent_center: shared Agent Center local asset custody commands

mod agent_center_avatar_asset;
pub mod capabilities;
pub mod command_registration;
mod desktop_paths;
mod governed_config;
mod nimi_data_directory;
mod oauth_commands;
mod platform_catalog;
mod platform_projection;
mod runtime_account_caller;
mod runtime_app_storage;
mod runtime_bridge;
mod runtime_defaults;
mod runtime_local_agent_identity;
mod session_logging;
mod shell_ui_hooks;
mod standard_agent_center;
mod standard_artifacts;
mod standard_desktop_open;
mod standard_export;
mod standard_file_dialog;
mod standard_file_reveal;
pub mod standard_floating_window;
mod standard_local_agent;
mod standard_local_app;
mod standard_local_assets;
mod standard_platform_projection;

#[cfg(target_os = "windows")]
pub use nimi_shell_protected_local::{prepare_fixed_runtime_data_root, FixedRuntimeDataRootError};

#[cfg(test)]
mod agent_center_avatar_asset_tests;
#[cfg(test)]
mod command_registration_tests;
#[cfg(test)]
mod test_support;
