#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::Manager;

// Shared modules from kit/shell/tauri crate
use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::desktop_paths;
use nimi_kit_shell_tauri::oauth_commands;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use nimi_kit_shell_tauri::session_logging;

// App-local modules
mod attachment_store;
mod child_avatar;
mod dropped_file;
mod journal_audio;
mod journal_photo;
mod sqlite;
#[cfg(test)]
mod test_support;

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

#[tauri::command]
fn parentos_start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        window.start_dragging().map_err(|error| error.to_string())
    })) {
        Ok(result) => result,
        Err(_) => Err("window drag unavailable".to_string()),
    }
}

fn load_dotenv_files() {
    let root_env_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.env");
    if root_env_path.exists() {
        match dotenvy::from_path_iter(&root_env_path) {
            Ok(iter) => {
                for item in iter.flatten() {
                    let (key, value) = item;
                    // NIMI_* vars always override; others only set if missing
                    let should_override = key.starts_with("NIMI_") || key.starts_with("VITE_NIMI_");
                    if should_override || std::env::var_os(&key).is_none() {
                        std::env::set_var(&key, &value);
                    }
                }
                eprintln!("[parentos] dotenv loaded path={}", root_env_path.display());
            }
            Err(error) => {
                eprintln!(
                    "[parentos] dotenv load failed path={} error={error}",
                    root_env_path.display()
                );
            }
        }
    }
}

/// Cloud AI provider configuration resolved from env vars.
/// Tries providers in priority order: DEEPSEEK, GEMINI, DASHSCOPE.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudAIConfig {
    provider_endpoint: String,
    provider_model: String,
    provider_api_key: String,
    provider_type: String,
    available: bool,
}

fn env_value_trimmed(key: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_default()
}

#[tauri::command]
fn parentos_cloud_ai_config() -> CloudAIConfig {
    // Try DeepSeek first
    let deepseek_key = env_value_trimmed("DEEPSEEK_API_KEY");
    if !deepseek_key.is_empty() {
        return CloudAIConfig {
            provider_endpoint: "https://api.deepseek.com/v1".into(),
            provider_model: "deepseek-chat".into(),
            provider_api_key: deepseek_key,
            provider_type: "openai_compat".into(),
            available: true,
        };
    }
    // Try Dashscope (Alibaba/Qwen)
    let dashscope_key = env_value_trimmed("DASHSCOPE_API_KEY");
    if !dashscope_key.is_empty() {
        return CloudAIConfig {
            provider_endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
            provider_model: "qwen-plus".into(),
            provider_api_key: dashscope_key,
            provider_type: "openai_compat".into(),
            available: true,
        };
    }
    CloudAIConfig {
        provider_endpoint: String::new(),
        provider_model: String::new(),
        provider_api_key: String::new(),
        provider_type: String::new(),
        available: false,
    }
}

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    load_dotenv_files();
    configure_runtime_bridge_env();
    session_logging::set_app_session_prefix("parentos");
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("parentos main() entered");

    tauri::Builder::default()
        .setup(|app| {
            let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
            app.state::<tauri::Scopes>()
                .allow_directory(&nimi_data_dir, true)
                .map_err(|error| {
                    format!(
                        "failed to allow nimi_data_dir in asset scope ({}): {error}",
                        nimi_data_dir.display()
                    )
                })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            parentos_start_window_drag,
            parentos_cloud_ai_config,
            defaults::runtime_defaults,
            auth_session_commands::auth_session_load,
            auth_session_commands::auth_session_save,
            auth_session_commands::auth_session_clear,
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
            child_avatar::save_child_avatar,
            journal_photo::delete_journal_photo,
            dropped_file::read_dropped_image_as_base64,
            dropped_file::pick_image_files,
            // Family & Children
            sqlite::queries::create_family,
            sqlite::queries::get_family,
            sqlite::queries::get_child,
            sqlite::queries::create_child,
            sqlite::queries::get_children,
            sqlite::queries::update_child,
            sqlite::queries::delete_child,
            // Growth Measurements
            sqlite::queries::insert_measurement,
            sqlite::queries::get_measurements,
            sqlite::queries::update_measurement,
            sqlite::queries::delete_measurement,
            // Milestone Records
            sqlite::queries::upsert_milestone_record,
            sqlite::queries::get_milestone_records,
            sqlite::queries::delete_milestone_record,
            // Reminder States
            sqlite::queries::upsert_reminder_state,
            sqlite::queries::get_reminder_states,
            sqlite::queries::get_active_reminders,
            sqlite::queries::upsert_reminder_consultation,
            sqlite::queries::clear_reminder_consultation,
            // Custom Todos
            sqlite::queries::insert_custom_todo,
            sqlite::queries::update_custom_todo,
            sqlite::queries::complete_custom_todo,
            sqlite::queries::advance_custom_todo_due_date,
            sqlite::queries::uncomplete_custom_todo,
            sqlite::queries::delete_custom_todo,
            sqlite::queries::get_custom_todos,
            // Vaccine Records
            sqlite::queries::insert_vaccine_record,
            sqlite::queries::get_vaccine_records,
            // Journal Entries
            sqlite::queries::insert_journal_entry,
            sqlite::queries::insert_journal_entry_with_tags,
            sqlite::queries::update_journal_entry_with_tags,
            sqlite::queries::update_journal_keepsake,
            sqlite::queries::delete_journal_entry,
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
            sqlite::queries::update_growth_report_content,
            // App Settings
            sqlite::queries::set_app_setting,
            sqlite::queries::get_app_setting,
            // Dental Records
            sqlite::queries::insert_dental_record,
            sqlite::queries::update_dental_record,
            sqlite::queries::delete_dental_record,
            sqlite::queries::get_dental_records,
            sqlite::queries::insert_ortho_clinical_dental_record,
            // Attachments
            attachment_store::save_attachment,
            attachment_store::get_attachments,
            attachment_store::get_attachments_by_owner,
            attachment_store::delete_attachment,
            // Allergy Records
            sqlite::queries::insert_allergy_record,
            sqlite::queries::update_allergy_record,
            sqlite::queries::get_allergy_records,
            // Sleep Records
            sqlite::queries::upsert_sleep_record,
            sqlite::queries::delete_sleep_record,
            sqlite::queries::get_sleep_records,
            // Medical Events
            sqlite::queries::insert_medical_event,
            sqlite::queries::update_medical_event,
            sqlite::queries::get_medical_events,
            // Tanner Assessments
            sqlite::queries::insert_tanner_assessment,
            sqlite::queries::get_tanner_assessments,
            sqlite::queries::delete_tanner_assessment,
            // Fitness Assessments
            sqlite::queries::insert_fitness_assessment,
            sqlite::queries::get_fitness_assessments,
            sqlite::queries::delete_fitness_assessment,
            // Outdoor Records
            sqlite::queries::insert_outdoor_record,
            sqlite::queries::update_outdoor_record,
            sqlite::queries::delete_outdoor_record,
            sqlite::queries::get_outdoor_records,
            sqlite::queries::get_outdoor_goal,
            sqlite::queries::set_outdoor_goal,
            // Profile Section Summaries
            sqlite::queries::get_profile_section_summaries,
            // Orthodontic (PO-ORTHO-*)
            sqlite::queries::insert_orthodontic_case,
            sqlite::queries::update_orthodontic_case,
            sqlite::queries::delete_orthodontic_case,
            sqlite::queries::get_orthodontic_cases,
            sqlite::queries::insert_orthodontic_appliance,
            sqlite::queries::update_orthodontic_appliance_status,
            sqlite::queries::update_orthodontic_appliance_review,
            sqlite::queries::delete_orthodontic_appliance,
            sqlite::queries::get_orthodontic_appliances,
            sqlite::queries::insert_orthodontic_checkin,
            sqlite::queries::delete_orthodontic_checkin,
            sqlite::queries::get_orthodontic_checkins,
            sqlite::queries::get_orthodontic_dashboard,
            // DB init
            sqlite::db_init,
        ])
        .run(tauri::generate_context!())
        .expect("error running parentos");
}
