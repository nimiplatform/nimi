// nimi-shell-tauri: Shared Tauri host glue for Nimi apps
//
// Single shared owner for app-agnostic Rust/Tauri host glue:
// - runtime_bridge: gRPC-over-IPC bridge (channel pool, codec, unary/stream, daemon manager)
// - runtime_ai_config_projection: Runtime execution proof -> AIConfig binding projection
// - runtime_local_assets: local Runtime asset picker/reveal path helpers
// - runtime_local_agent_identity: Runtime local-agent identity parsing/projection
// - runtime_defaults: env reading, loopback normalization, realm/runtime defaults
// - session_logging: panic hook, renderer log_renderer_event sink, stderr echo
// - auth_session_commands: auth session load/save/clear
// - oauth_commands: token exchange, listen for code, open external URL
// - desktop_paths: nimi directory resolution
// - governed_config: shared `.nimi` current-schema repair routing
// - nimi_data_directory: shared `nimi_data` layout and cleanup primitives
// - platform_projection: deterministic host projection record builders
// - renderer_entry_probe: shared page-load renderer entry smoke probe script
// - agent_center_avatar_asset: shared Agent Center Avatar local asset resolution

pub mod capabilities;
mod agent_center_avatar_asset;
mod auth_session_commands;
pub mod command_registration;
mod desktop_paths;
mod governed_config;
mod nimi_data_directory;
mod oauth_commands;
mod platform_catalog;
mod platform_projection;
mod renderer_entry_probe;
mod runtime_account_caller;
mod runtime_ai_config_projection;
mod runtime_app_storage;
mod runtime_bridge;
mod runtime_defaults;
mod runtime_local_agent_identity;
mod runtime_local_assets;
mod session_logging;

#[cfg(test)]
mod agent_center_avatar_asset_tests;
#[cfg(test)]
mod test_support;
