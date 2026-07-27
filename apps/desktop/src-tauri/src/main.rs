#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nimi_shell_tauri::capabilities::runtime as runtime_bridge;
mod account_profile_library;
mod account_profile_library_commands;
mod account_profile_library_files;
mod chat_ai_store;
mod desktop_ai_config_library;
mod desktop_avatar_instance_registry;
mod desktop_local_development;
mod desktop_logs_export;
mod desktop_open_intent;
#[cfg(test)]
mod desktop_open_intent_tests;
mod desktop_paths;
mod desktop_product_control;
mod desktop_product_control_admission;
mod desktop_release;
mod desktop_updates;
#[cfg(test)]
mod factory_profile_index;
mod local_runtime;
mod main_parts;
mod menu_bar_shell;
mod nimi_data_directory;
#[cfg(test)]
mod test_support;

fn main() {
    main_parts::run();
}
