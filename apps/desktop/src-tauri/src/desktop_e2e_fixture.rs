use crate::desktop_product_control::ProductControlRecord;
use crate::desktop_release::DesktopReleaseInfo;
use crate::runtime_bridge::{
    generated as runtime_bridge_generated, RuntimeBridgeDaemonStatus, RuntimeBridgeUnaryPayload,
    RuntimeBridgeUnaryResult,
};
use crate::RuntimeDefaults;
use base64::Engine;
use prost::Message;
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
    realm_fixture: Option<DesktopE2ERealmFixture>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2ETauriFixture {
    bootstrap_error: Option<String>,
    runtime_defaults: Option<RuntimeDefaults>,
    runtime_bridge_status: Option<RuntimeBridgeDaemonStatus>,
    desktop_release_info: Option<DesktopReleaseInfo>,
    product_control_record: Option<ProductControlRecord>,
    confirm_dialog: Option<DesktopE2EConfirmDialogOverride>,
    macos_smoke: Option<DesktopE2EMacosSmokeOverride>,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopE2EMacosSmokeOverride {
    pub enabled: bool,
    pub scenario_id: Option<String>,
    pub report_path: Option<String>,
    pub artifacts_dir: Option<String>,
    pub disable_runtime_bootstrap: Option<bool>,
    pub bootstrap_timeout_ms: Option<u64>,
    pub avatar_product_local_asset_fault: Option<DesktopE2EMacosSmokeAvatarProductLocalAssetFault>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopE2EMacosSmokeAvatarProductLocalAssetFault {
    pub fault_kind: String,
    pub package_dir: String,
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

fn encode_unary_response<Response>(response: Response) -> RuntimeBridgeUnaryResult
where
    Response: Message,
{
    RuntimeBridgeUnaryResult {
        response_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(response.encode_to_vec()),
        response_metadata: None,
    }
}

fn decode_unary_request<Request>(payload: &RuntimeBridgeUnaryPayload) -> Result<Request, String>
where
    Request: Message + Default,
{
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.request_bytes_base64.trim())
        .map_err(|_| "DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_DECODE_FAILED".to_string())?;
    Request::decode(bytes.as_slice())
        .map_err(|error| format!("DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_INVALID: {error}"))
}

fn runtime_register_app_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::RegisterAppRequest = decode_unary_request(payload)?;
    Ok(encode_unary_response(
        runtime_bridge_generated::RegisterAppResponse {
            app_instance_id: request.app_instance_id,
            accepted: true,
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        },
    ))
}

fn account_projection_from_fixture(
    fixture: Option<&DesktopE2ERealmFixture>,
) -> Option<runtime_bridge_generated::AccountProjection> {
    let user = fixture.and_then(|realm| realm.current_user.as_ref())?;
    let account_id = user.id.trim();
    if account_id.is_empty() {
        return None;
    }
    Some(runtime_bridge_generated::AccountProjection {
        account_id: account_id.to_string(),
        display_name: user
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(account_id)
            .to_string(),
        realm_environment_id: "e2e-fixture".to_string(),
        workspace_memberships: Vec::new(),
    })
}

fn uses_real_runtime_account_projection(manifest: &DesktopE2EFixtureManifest) -> bool {
    manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.macos_smoke.as_ref())
        .and_then(|smoke| smoke.scenario_id.as_deref())
        .map(str::trim)
        .is_some_and(is_live2d_avatar_product_smoke_scenario)
}

fn is_live2d_avatar_product_smoke_scenario(scenario_id: &str) -> bool {
    matches!(
        scenario_id,
        "chat.live2d-avatar-product-smoke" | "chat.live2d-avatar-local-asset-missing-smoke"
    )
}

fn runtime_account_status_response(
    projection: Option<runtime_bridge_generated::AccountProjection>,
) -> runtime_bridge_generated::GetAccountSessionStatusResponse {
    if let Some(account_projection) = projection {
        return runtime_bridge_generated::GetAccountSessionStatusResponse {
            state: runtime_bridge_generated::AccountSessionState::Authenticated as i32,
            account_projection: Some(account_projection),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
            production_inert: false,
        };
    }
    runtime_bridge_generated::GetAccountSessionStatusResponse {
        state: runtime_bridge_generated::AccountSessionState::Anonymous as i32,
        account_projection: None,
        reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
        production_inert: false,
    }
}

fn runtime_account_token_response(
    projection: Option<runtime_bridge_generated::AccountProjection>,
) -> runtime_bridge_generated::GetAccessTokenResponse {
    if projection.is_some() {
        return runtime_bridge_generated::GetAccessTokenResponse {
            accepted: true,
            access_token: "e2e-runtime-account-access-token".to_string(),
            expires_at: None,
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
            production_inert: false,
        };
    }
    runtime_bridge_generated::GetAccessTokenResponse {
        accepted: false,
        access_token: String::new(),
        expires_at: None,
        reason_code: runtime_bridge_generated::ReasonCode::PrincipalUnauthorized as i32,
        account_reason_code: runtime_bridge_generated::AccountReasonCode::AccountUnavailable as i32,
        production_inert: false,
    }
}

pub fn runtime_bridge_unary_override(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
    let Some(manifest) = load_fixture_manifest()? else {
        return Ok(None);
    };
    if uses_real_runtime_account_projection(&manifest) {
        return Ok(None);
    }
    let projection = account_projection_from_fixture(manifest.realm_fixture.as_ref());
    match payload.method_id.trim() {
        "/nimi.runtime.v1.RuntimeAuthService/RegisterApp" => {
            append_backend_log("runtime_auth_fixture method=registerApp accepted=true");
            runtime_register_app_response(payload).map(Some)
        }
        "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus" => {
            append_backend_log(&format!(
                "runtime_account_fixture method=getAccountSessionStatus authenticated={}",
                projection.is_some()
            ));
            Ok(Some(encode_unary_response(
                runtime_account_status_response(projection),
            )))
        }
        "/nimi.runtime.v1.RuntimeAccountService/GetAccessToken" => {
            append_backend_log(&format!(
                "runtime_account_fixture method=getAccessToken accepted={}",
                projection.is_some()
            ));
            Ok(Some(encode_unary_response(runtime_account_token_response(
                projection,
            ))))
        }
        _ => Ok(None),
    }
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

pub fn product_control_record_override() -> Result<Option<ProductControlRecord>, String> {
    let record = load_fixture_manifest()?
        .and_then(|manifest| manifest.tauri_fixture)
        .and_then(|fixture| fixture.product_control_record);
    append_backend_log(&format!(
        "product_control_record_override override_present={}",
        record.is_some()
    ));
    Ok(record)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_for_scenario(scenario_id: &str) -> DesktopE2EFixtureManifest {
        DesktopE2EFixtureManifest {
            tauri_fixture: Some(DesktopE2ETauriFixture {
                bootstrap_error: None,
                runtime_defaults: None,
                runtime_bridge_status: None,
                desktop_release_info: None,
                product_control_record: None,
                confirm_dialog: None,
                macos_smoke: Some(DesktopE2EMacosSmokeOverride {
                    enabled: true,
                    scenario_id: Some(scenario_id.to_string()),
                    report_path: None,
                    artifacts_dir: None,
                    disable_runtime_bootstrap: None,
                    bootstrap_timeout_ms: None,
                    avatar_product_local_asset_fault: None,
                }),
            }),
            realm_fixture: None,
        }
    }

    #[test]
    fn real_runtime_account_projection_covers_avatar_product_smoke_matrix() {
        assert!(uses_real_runtime_account_projection(
            &manifest_for_scenario("chat.live2d-avatar-product-smoke",)
        ));
        assert!(uses_real_runtime_account_projection(
            &manifest_for_scenario("chat.live2d-avatar-local-asset-missing-smoke",)
        ));
        assert!(!uses_real_runtime_account_projection(
            &manifest_for_scenario("chat.live2d-render-smoke",)
        ));
    }

    #[test]
    fn runtime_register_app_fixture_accepts_local_first_party_registration() {
        let request = runtime_bridge_generated::RegisterAppRequest {
            app_id: "nimi.desktop".to_string(),
            app_instance_id: "nimi.desktop.local-first-party".to_string(),
            device_id: "desktop-shell".to_string(),
            app_version: "1".to_string(),
            capabilities: Vec::new(),
            mode_manifest: None,
            developer_registration: false,
        };
        let payload = RuntimeBridgeUnaryPayload {
            method_id: "/nimi.runtime.v1.RuntimeAuthService/RegisterApp".to_string(),
            request_bytes_base64: base64::engine::general_purpose::STANDARD
                .encode(request.encode_to_vec()),
            metadata: None,
            authorization: None,
            protected_access_token: None,
            app_session: None,
            timeout_ms: None,
        };

        let result = runtime_register_app_response(&payload).expect("register app response");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(result.response_bytes_base64)
            .expect("decode response");
        let response = runtime_bridge_generated::RegisterAppResponse::decode(bytes.as_slice())
            .expect("decode register response");
        assert!(response.accepted);
        assert_eq!(response.app_instance_id, "nimi.desktop.local-first-party");
        assert_eq!(
            response.reason_code,
            runtime_bridge_generated::ReasonCode::ActionExecuted as i32
        );
    }
}
