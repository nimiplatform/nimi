// nimi-shell-tauri: Shared Tauri host glue for Nimi apps
//
// Single shared owner for app-agnostic Rust/Tauri host glue:
// - runtime_bridge: gRPC-over-IPC bridge (channel pool, codec, unary/stream, daemon manager)
// - runtime_ai_config_projection: Runtime execution proof -> AIConfig binding projection
// - runtime_local_assets: local Runtime asset picker/reveal path helpers
// - runtime_defaults: env reading, loopback normalization, realm/runtime defaults
// - session_logging: panic hook, renderer log_renderer_event sink, stderr echo
// - auth_session_commands: auth session load/save/clear
// - oauth_commands: token exchange, listen for code, open external URL
// - desktop_paths: nimi directory resolution
// - governed_config: shared `.nimi` current-schema repair routing
// - nimi_data_directory: shared `nimi_data` layout and cleanup primitives
// - platform_projection: deterministic host projection record builders
// - renderer_entry_probe: shared page-load renderer entry smoke probe script

pub mod auth_session_commands;
pub mod command_registration;
pub mod desktop_paths;
pub mod governed_config;
pub mod nimi_data_directory;
pub mod oauth_commands;
pub mod platform_catalog;
pub mod platform_projection;
pub mod renderer_entry_probe;
pub mod runtime_account_caller;
pub mod runtime_ai_config_projection;
pub mod runtime_app_storage;
pub mod runtime_bridge;
pub mod runtime_defaults;
pub mod runtime_local_assets;
pub mod session_logging;

#[cfg(test)]
mod test_support;
