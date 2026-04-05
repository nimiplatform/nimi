#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chat_agent_store;
mod chat_ai_store;
mod desktop_e2e_fixture;
mod desktop_paths;
mod desktop_release;
mod desktop_updates;
mod external_agent_gateway;
#[path = "../../../shared-tauri/auth_session_commands.rs"]
mod auth_session_commands;
mod local_runtime;
mod main_parts;
mod menu_bar_shell;
mod runtime_bridge;
mod runtime_mod;
#[cfg(test)]
mod test_support;

pub(crate) use main_parts::RuntimeDefaults;

fn main() {
    main_parts::run();
}
