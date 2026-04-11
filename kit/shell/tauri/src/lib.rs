// nimi-kit-shell-tauri: Shared Tauri host glue for Nimi apps
//
// Single shared owner for app-agnostic Rust/Tauri host glue:
// - runtime_bridge: gRPC-over-IPC bridge (channel pool, codec, unary/stream, daemon manager)
// - runtime_defaults: env reading, loopback normalization, realm/runtime defaults
// - session_logging: panic hook, renderer log_renderer_event sink, stderr echo
// - auth_session_commands: auth session load/save/clear
// - oauth_commands: token exchange, listen for code, open external URL
// - desktop_paths: nimi directory resolution

pub mod runtime_bridge;
pub mod runtime_defaults;
pub mod session_logging;
pub mod auth_session_commands;
pub mod oauth_commands;
pub mod desktop_paths;

#[cfg(test)]
mod test_support;
