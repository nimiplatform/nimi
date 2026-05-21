#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::oauth_commands;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::session_logging;
mod account_apps_projection;
mod account_profile_library;
mod account_profile_library_commands;
mod account_profile_library_files;
mod apps_bridge_projection;
mod apps_packages_projection;
mod apps_registry_projection;
mod chat_agent_store;
mod chat_ai_store;
mod desktop_agent_center_store;
mod desktop_ai_config_library;
mod desktop_avatar_instance_registry;
mod desktop_e2e_fixture;
mod desktop_paths;
mod desktop_product_control;
mod desktop_product_control_admission;
mod desktop_release;
mod desktop_updates;
mod external_agent_gateway;
mod factory_profile_index;
mod local_config_migration;
mod local_runtime;
mod main_parts;
mod menu_bar_shell;
mod nimi_data_migration;
mod platform_ai_profile_factory_catalog;
mod platform_nimi_app_registry;
mod runtime_mod;
#[cfg(test)]
mod test_support;

pub(crate) use main_parts::RuntimeDefaults;

fn main() {
    main_parts::run();
}
