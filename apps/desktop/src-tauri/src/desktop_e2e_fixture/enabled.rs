use crate::desktop_release::DesktopReleaseInfo;
use crate::runtime_bridge::{
    generated as runtime_bridge_generated, RuntimeBridgeAccountEventsOpenPayload,
    RuntimeBridgeAccountEventsOpenResult, RuntimeBridgeDaemonStatus,
    RuntimeBridgeDesktopAccountProjection, RuntimeBridgeDesktopAccountSessionStatus,
    RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
};
use crate::RuntimeDefaults;
use base64::Engine;
use prost::Message;
use serde::Deserialize;
use std::fs;
use std::io::Write;
use std::sync::{Mutex, OnceLock};

const E2E_FIXTURE_PATH_ENV: &str = "NIMI_E2E_FIXTURE_PATH";
const E2E_BACKEND_LOG_PATH_ENV: &str = "NIMI_E2E_BACKEND_LOG_PATH";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2EFixtureManifest {
    tauri_fixture: Option<DesktopE2ETauriFixture>,
    realm_fixture: Option<DesktopE2ERealmFixture>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopE2ETauriFixture {
    bootstrap_error: Option<String>,
    runtime_defaults: Option<RuntimeDefaults>,
    runtime_bridge_status: Option<RuntimeBridgeDaemonStatus>,
    desktop_release_info: Option<DesktopReleaseInfo>,
    confirm_dialog: Option<DesktopE2EConfirmDialogOverride>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2ERealmFixture {
    current_user: Option<DesktopE2ECurrentUser>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2ECurrentUser {
    id: String,
    display_name: Option<String>,
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
        let message = format!("DESKTOP_E2E_FIXTURE_READ_FAILED: failed to read {path}: {error}");
        append_backend_log(&message);
        message
    })?;
    let parsed =
        serde_json::from_str::<DesktopE2EFixtureManifest>(raw.as_str()).map_err(|error| {
            let message =
                format!("DESKTOP_E2E_FIXTURE_PARSE_FAILED: failed to parse {path}: {error}");
            append_backend_log(&message);
            message
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

pub(super) fn encode_unary_response<Response>(response: Response) -> RuntimeBridgeUnaryResult
where
    Response: Message,
{
    RuntimeBridgeUnaryResult {
        response_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(response.encode_to_vec()),
        response_metadata: None,
    }
}

pub(super) fn decode_unary_request<Request>(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<Request, String>
where
    Request: Message + Default,
{
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.request_bytes_base64.trim())
        .map_err(|_| "DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_DECODE_FAILED".to_string())?;
    Request::decode(bytes.as_slice())
        .map_err(|error| format!("DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_INVALID: {error}"))
}

#[path = "runtime_agent.rs"]
mod runtime_agent;
#[path = "runtime_app.rs"]
mod runtime_app;

use runtime_agent::*;
use runtime_app::*;

pub fn runtime_bridge_unary_override(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
    let Some(manifest) = load_fixture_manifest()? else {
        return Ok(None);
    };
    let method_id = payload.method_id.trim();
    if method_id.contains("/nimi.runtime.v1.RuntimeAgentService/") {
        append_backend_log(&format!(
            "runtime_agent_fixture method=received method_id={method_id}"
        ));
    }
    let projection = account_projection_from_fixture(manifest.realm_fixture.as_ref());
    match method_id {
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AUTH_REGISTER_APP_METHOD_ID => {
        append_backend_log("runtime_auth_fixture method=registerApp accepted=true");
        runtime_register_app_response(payload).map(Some)
    }
    "/nimi.runtime.v1.RuntimeAuthService/OpenSession" => {
        append_backend_log("runtime_auth_fixture method=openSession accepted=true");
        runtime_open_session_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID => {
        append_backend_log(&format!(
            "runtime_account_fixture method=getAccountSessionStatus authenticated={}",
            projection.is_some()
        ));
        Ok(Some(encode_unary_response(
            runtime_account_status_response(projection),
        )))
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_APP_STORAGE_METHOD_ID => {
        append_backend_log("runtime_app_fixture method=getAppStorage accepted=true");
        runtime_app_storage_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID => {
        append_backend_log(&format!(
            "runtime_app_fixture method=getAccountAppInventory authenticated={}",
            projection.is_some()
        ));
        runtime_account_app_inventory_response(projection).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID => {
        append_backend_log("runtime_app_fixture method=getAppPackageReadiness accepted=false authority=0p-unavailable");
        runtime_app_package_readiness_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_GET_AGENT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getAgent accepted=true");
        runtime_agent_get_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_INITIALIZE_AGENT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=initializeAgent accepted=true");
        runtime_agent_initialize_response(payload).map(Some)
    }
    RUNTIME_AGENT_GET_AGENT_STATE_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getAgentState accepted=true");
        runtime_agent_get_state_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_SET_AGENT_PRESENTATION_PROFILE_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=setAgentPresentationProfile accepted=true");
        runtime_agent_set_presentation_profile_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=openConversationAnchor accepted=true");
        runtime_agent_open_anchor_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getConversationAnchorSnapshot accepted=true");
        runtime_agent_get_anchor_snapshot_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=listAgentConversationSummaries accepted=true");
        runtime_agent_list_conversation_summaries_response(payload).map(Some)
    }
    RUNTIME_AGENT_GET_PUBLIC_CHAT_SESSION_SNAPSHOT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getPublicChatSessionSnapshot accepted=true");
        runtime_agent_public_chat_session_snapshot_response(payload).map(Some)
    }
    RUNTIME_AGENT_LIST_PENDING_HOOKS_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=listPendingHooks accepted=true");
        runtime_agent_list_pending_hooks_response(payload).map(Some)
    }
    RUNTIME_AGENT_GET_CANONICAL_MEMORY_BANK_STATUS_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getAgentCanonicalMemoryBankStatus accepted=true");
        runtime_agent_get_canonical_memory_bank_status_response(payload).map(Some)
    }
    RUNTIME_AGENT_REQUEST_CANONICAL_MEMORY_BANK_BIND_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=requestAgentCanonicalMemoryBankBind accepted=true");
        runtime_agent_request_canonical_memory_bank_bind_response(payload).map(Some)
    }
    _ => {
        if payload
            .method_id
            .contains("/nimi.runtime.v1.RuntimeAgentService/")
        {
            append_backend_log(&format!(
                "runtime_agent_fixture method=unhandled method_id={}",
                payload.method_id.trim()
            ));
        }
        Ok(None)
    }
}
}

pub fn runtime_account_session_status_override(
) -> Result<Option<RuntimeBridgeDesktopAccountSessionStatus>, String> {
    let Some(manifest) = load_fixture_manifest()? else {
        return Ok(None);
    };
    let projection = account_projection_from_fixture(manifest.realm_fixture.as_ref());
    let authenticated = projection.is_some();
    append_backend_log(&format!(
        "runtime_account_fixture transport=protected-carrier method=getAccountSessionStatus authenticated={authenticated}"
    ));
    Ok(Some(RuntimeBridgeDesktopAccountSessionStatus {
        sequence: "1".to_string(),
        state: if authenticated {
            "authenticated"
        } else {
            "anonymous"
        }
        .to_string(),
        reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
        account_projection: projection.map(|value| RuntimeBridgeDesktopAccountProjection {
            account_id: value.account_id,
            display_name: value.display_name,
            realm_environment_id: value.realm_environment_id,
        }),
    }))
}

pub fn runtime_account_session_events_open_override(
    payload: &RuntimeBridgeAccountEventsOpenPayload,
) -> Result<Option<RuntimeBridgeAccountEventsOpenResult>, String> {
    if load_fixture_manifest()?.is_none() {
        return Ok(None);
    }
    let after_sequence = payload.after_sequence.as_str();
    if after_sequence != after_sequence.trim()
        || after_sequence.is_empty()
        || after_sequence.len() > 20
        || (after_sequence.len() > 1 && after_sequence.starts_with('0'))
        || after_sequence.parse::<u64>().is_err()
    {
        return Err("DESKTOP_E2E_ACCOUNT_EVENT_SEQUENCE_INVALID".to_string());
    }
    append_backend_log(&format!(
        "runtime_account_fixture transport=protected-carrier method=openAccountSessionEvents after_sequence={after_sequence}"
    ));
    Ok(Some(RuntimeBridgeAccountEventsOpenResult {
        stream_id: format!("e2e-account-session-{after_sequence}"),
    }))
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

#[cfg(test)]
#[path = "fixture_tests.rs"]
mod fixture_tests;
