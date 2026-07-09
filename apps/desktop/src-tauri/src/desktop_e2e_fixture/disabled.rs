use crate::desktop_product_control::ProductControlRecord;
use crate::desktop_release::DesktopReleaseInfo;
use crate::runtime_bridge::{
    RuntimeBridgeDaemonStatus, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
};
use crate::RuntimeDefaults;

#[derive(Debug, Clone)]
pub struct DesktopE2EMacosSmokeOverride {
    pub enabled: bool,
    pub scenario_id: Option<String>,
    pub report_path: Option<String>,
    pub artifacts_dir: Option<String>,
    pub disable_runtime_bootstrap: Option<bool>,
    pub bootstrap_timeout_ms: Option<u64>,
}

pub fn fixture_manifest_path() -> Option<String> {
    None
}

pub fn append_backend_log_message(_message: &str) {}

pub fn runtime_bridge_unary_override(
    _payload: &RuntimeBridgeUnaryPayload,
) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
    Ok(None)
}

pub fn runtime_defaults_override() -> Result<Option<RuntimeDefaults>, String> {
    Ok(None)
}

pub fn runtime_bridge_status_override() -> Result<Option<RuntimeBridgeDaemonStatus>, String> {
    Ok(None)
}

pub fn desktop_release_info_override() -> Result<Option<DesktopReleaseInfo>, String> {
    Ok(None)
}

pub fn product_control_record_override() -> Result<Option<ProductControlRecord>, String> {
    Ok(None)
}

pub fn next_confirm_dialog_override() -> Result<Option<bool>, String> {
    Ok(None)
}

pub fn macos_smoke_override() -> Result<Option<DesktopE2EMacosSmokeOverride>, String> {
    Ok(None)
}
