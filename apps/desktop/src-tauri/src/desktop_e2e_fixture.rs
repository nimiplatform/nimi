use crate::desktop_release::DesktopReleaseInfo;
use crate::runtime_bridge::RuntimeBridgeDaemonStatus;
use crate::RuntimeDefaults;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::sync::{Mutex, OnceLock};

const E2E_FIXTURE_PATH_ENV: &str = "NIMI_E2E_FIXTURE_PATH";
const E2E_BACKEND_LOG_PATH_ENV: &str = "NIMI_E2E_BACKEND_LOG_PATH";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2EFixtureManifest {
    tauri_fixture: Option<DesktopE2ETauriFixture>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2ETauriFixture {
    bootstrap_error: Option<String>,
    runtime_defaults: Option<RuntimeDefaults>,
    runtime_bridge_status: Option<RuntimeBridgeDaemonStatus>,
    desktop_release_info: Option<DesktopReleaseInfo>,
    confirm_dialog: Option<DesktopE2EConfirmDialogOverride>,
    agent_memory_bind_standard: Option<DesktopE2EAgentMemoryBindStandardOverride>,
    macos_smoke: Option<DesktopE2EMacosSmokeOverride>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2EConfirmDialogOverride {
    responses: Option<Vec<DesktopE2EConfirmDialogResponse>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2EConfirmDialogResponse {
    confirmed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopE2EAgentMemoryBindStandardOverride {
    pub already_bound: bool,
    pub bank_id: String,
    pub embedding_profile_model_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopE2EMacosSmokeOverride {
    pub enabled: bool,
    pub scenario_id: Option<String>,
    pub report_path: Option<String>,
    pub artifacts_dir: Option<String>,
    pub disable_runtime_bootstrap: Option<bool>,
}

fn confirm_dialog_override_index_store() -> &'static Mutex<usize> {
    static STORE: OnceLock<Mutex<usize>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(0))
}

fn fixture_path() -> Option<String> {
    std::env::var(E2E_FIXTURE_PATH_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn load_fixture_manifest() -> Result<Option<DesktopE2EFixtureManifest>, String> {
    let Some(path) = fixture_path() else {
        return Ok(None);
    };
    append_backend_log(&format!("load_fixture_manifest path={path}"));
    let raw = fs::read_to_string(path.as_str()).map_err(|error| {
        format!("DESKTOP_E2E_FIXTURE_READ_FAILED: failed to read {path}: {error}")
    })?;
    let parsed =
        serde_json::from_str::<DesktopE2EFixtureManifest>(raw.as_str()).map_err(|error| {
            format!("DESKTOP_E2E_FIXTURE_PARSE_FAILED: failed to parse {path}: {error}")
        })?;
    Ok(Some(parsed))
}

pub fn fixture_manifest_path() -> Option<String> {
    fixture_path()
}

pub fn append_backend_log_message(message: &str) {
    let Some(path) = std::env::var(E2E_BACKEND_LOG_PATH_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path.as_str())
    {
        let _ = writeln!(file, "{message}");
    }
}

fn append_backend_log(message: &str) {
    append_backend_log_message(message);
}

pub fn runtime_defaults_override() -> Result<Option<RuntimeDefaults>, String> {
    let Some(manifest) = load_fixture_manifest()? else {
        return Ok(None);
    };
    if let Some(message) = manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.bootstrap_error.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        append_backend_log(&format!(
            "runtime_defaults_override bootstrap_error={message}"
        ));
        return Err(format!("DESKTOP_E2E_BOOTSTRAP_ERROR: {message}"));
    }
    let override_present = manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.runtime_defaults.as_ref())
        .is_some();
    append_backend_log(&format!(
        "runtime_defaults_override override_present={override_present}"
    ));
    Ok(manifest
        .tauri_fixture
        .and_then(|fixture| fixture.runtime_defaults))
}

pub fn runtime_bridge_status_override() -> Result<Option<RuntimeBridgeDaemonStatus>, String> {
    let status = load_fixture_manifest()?
        .and_then(|manifest| manifest.tauri_fixture)
        .and_then(|fixture| fixture.runtime_bridge_status);
    append_backend_log(&format!(
        "runtime_bridge_status_override override_present={}",
        status.is_some()
    ));
    Ok(status)
}

pub fn desktop_release_info_override() -> Result<Option<DesktopReleaseInfo>, String> {
    let info = load_fixture_manifest()?
        .and_then(|manifest| manifest.tauri_fixture)
        .and_then(|fixture| fixture.desktop_release_info);
    append_backend_log(&format!(
        "desktop_release_info_override override_present={}",
        info.is_some()
    ));
    Ok(info)
}

pub fn next_confirm_dialog_override() -> Result<Option<bool>, String> {
    let responses = load_fixture_manifest()?
        .and_then(|manifest| manifest.tauri_fixture)
        .and_then(|fixture| fixture.confirm_dialog)
        .and_then(|fixture| fixture.responses);
    let Some(responses) = responses else {
        append_backend_log("confirm_dialog_override override_present=false");
        if let Ok(mut index) = confirm_dialog_override_index_store().lock() {
            *index = 0;
        }
        return Ok(None);
    };

    let mut index = confirm_dialog_override_index_store()
        .lock()
        .map_err(|_| "DESKTOP_E2E_CONFIRM_DIALOG_OVERRIDE_LOCK_FAILED".to_string())?;
    let selected = responses
        .get(*index)
        .or_else(|| responses.last())
        .map(|item| item.confirmed);
    if *index < responses.len() {
        *index += 1;
    }
    append_backend_log(&format!(
        "confirm_dialog_override override_present=true index={} selected={}",
        index.saturating_sub(1),
        selected.unwrap_or(false)
    ));
    Ok(selected)
}

pub fn agent_memory_bind_standard_override(
) -> Result<Option<DesktopE2EAgentMemoryBindStandardOverride>, String> {
    let override_payload = load_fixture_manifest()?
        .and_then(|manifest| manifest.tauri_fixture)
        .and_then(|fixture| fixture.agent_memory_bind_standard);
    append_backend_log(&format!(
        "agent_memory_bind_standard_override override_present={}",
        override_payload.is_some()
    ));
    Ok(override_payload)
}

pub fn macos_smoke_override() -> Result<Option<DesktopE2EMacosSmokeOverride>, String> {
    let override_payload = load_fixture_manifest()?
        .and_then(|manifest| manifest.tauri_fixture)
        .and_then(|fixture| fixture.macos_smoke);
    append_backend_log(&format!(
        "macos_smoke_override override_present={}",
        override_payload.is_some()
    ));
    Ok(override_payload)
}
