#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

mod defaults;
mod desktop_paths;
mod journal_audio;
mod journal_photo;
#[path = "../../../shared-tauri/oauth_commands.rs"]
mod oauth_commands;
#[path = "../../../forge/src-tauri/src/runtime_bridge/mod.rs"]
mod runtime_bridge;
mod session_logging;
mod sqlite;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentOSStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
    parentos_db_path: String,
}

#[tauri::command]
fn get_storage_dirs() -> Result<ParentOSStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    let parentos_db_path = sqlite::resolve_db_path()?;
    Ok(ParentOSStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
        parentos_db_path: parentos_db_path.display().to_string(),
    })
}

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    configure_runtime_bridge_env();
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("parentos main() entered");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            defaults::runtime_defaults,
            oauth_commands::open_external_url,
            oauth_commands::oauth_token_exchange,
            oauth_commands::oauth_listen_for_code,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart,
            runtime_bridge::runtime_bridge_config_get,
            runtime_bridge::runtime_bridge_config_set,
            session_logging::log_renderer_event,
            journal_audio::save_journal_voice_audio,
            journal_audio::delete_journal_voice_audio,
            journal_photo::save_journal_photo,
            journal_photo::delete_journal_photo,
            // Family & Children
            sqlite::queries::create_family,
            sqlite::queries::get_family,
            sqlite::queries::create_child,
            sqlite::queries::get_children,
            sqlite::queries::update_child,
            sqlite::queries::delete_child,
            // Growth Measurements
            sqlite::queries::insert_measurement,
            sqlite::queries::get_measurements,
            // Milestone Records
            sqlite::queries::upsert_milestone_record,
            sqlite::queries::get_milestone_records,
            // Reminder States
            sqlite::queries::upsert_reminder_state,
            sqlite::queries::get_reminder_states,
            sqlite::queries::get_active_reminders,
            // Vaccine Records
            sqlite::queries::insert_vaccine_record,
            sqlite::queries::get_vaccine_records,
            // Journal Entries
            sqlite::queries::insert_journal_entry,
            sqlite::queries::insert_journal_entry_with_tags,
            sqlite::queries::get_journal_entries,
            sqlite::queries::insert_journal_tag,
            sqlite::queries::get_journal_tags,
            // AI Conversations
            sqlite::queries::create_conversation,
            sqlite::queries::get_conversations,
            sqlite::queries::insert_ai_message,
            sqlite::queries::get_ai_messages,
            // Growth Reports
            sqlite::queries::insert_growth_report,
            sqlite::queries::get_growth_reports,
            // App Settings
            sqlite::queries::set_app_setting,
            sqlite::queries::get_app_setting,
            // Dental Records
            sqlite::queries::insert_dental_record,
            sqlite::queries::get_dental_records,
            // Allergy Records
            sqlite::queries::insert_allergy_record,
            sqlite::queries::update_allergy_record,
            sqlite::queries::get_allergy_records,
            // Sleep Records
            sqlite::queries::upsert_sleep_record,
            sqlite::queries::get_sleep_records,
            // Medical Events
            sqlite::queries::insert_medical_event,
            sqlite::queries::update_medical_event,
            sqlite::queries::get_medical_events,
            // Tanner Assessments
            sqlite::queries::insert_tanner_assessment,
            sqlite::queries::get_tanner_assessments,
            // Fitness Assessments
            sqlite::queries::insert_fitness_assessment,
            sqlite::queries::get_fitness_assessments,
            // DB init
            sqlite::db_init,
        ])
        .run(tauri::generate_context!())
        .expect("error running parentos");
}
