use crate::desktop_release::DesktopReleaseInfo;
use crate::runtime_bridge::{
    RuntimeBridgeDaemonStatus, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
};
use crate::RuntimeDefaults;

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

pub fn next_confirm_dialog_override() -> Result<Option<bool>, String> {
    Ok(None)
}
