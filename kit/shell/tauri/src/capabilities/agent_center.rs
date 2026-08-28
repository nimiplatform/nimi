use serde::de::DeserializeOwned;
use std::path::PathBuf;

pub use crate::standard_agent_center::{
    StandardAgentCenterAvatarMaterialSelectPayload, StandardAgentCenterAvatarMaterialSelectResult,
    StandardAgentCenterBackgroundMaterialSelectPayload,
    StandardAgentCenterBackgroundMaterialSelectResult,
};

fn invalid_raw_payload(command: &str, cause: impl ToString) -> String {
    crate::capabilities::standard_shell_error(
        "invalid-payload",
        "tauri-agent-center-payload-invalid",
        "send_standard_agent_center_payload",
        "tauri",
        Some(serde_json::json!({
            "command": command,
            "cause": cause.to_string(),
        })),
    )
}

fn parse_agent_center_payload<T: DeserializeOwned>(
    payload: Option<serde_json::Value>,
    command: &str,
) -> Result<T, String> {
    let value = payload.ok_or_else(|| invalid_raw_payload(command, "payload is required"))?;
    if !value.is_object() {
        return Err(invalid_raw_payload(command, "payload must be an object"));
    }
    serde_json::from_value::<T>(value).map_err(|error| invalid_raw_payload(command, error))
}

#[cfg(test)]
pub(crate) fn parse_agent_center_payload_for_command(
    command: &str,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    macro_rules! parse {
        ($type:ty) => {{
            let original = payload
                .clone()
                .ok_or_else(|| invalid_raw_payload(command, "payload is required"))?;
            let _: $type = parse_agent_center_payload::<$type>(payload, command)?;
            Ok(original)
        }};
    }
    match command {
        "nimi.shell.agentCenter.avatarAssetImport" => {
            parse!(StandardAgentCenterAvatarMaterialSelectPayload)
        }
        "nimi.shell.agentCenter.backgroundImport" => {
            parse!(StandardAgentCenterBackgroundMaterialSelectPayload)
        }
        _ => Err(invalid_raw_payload(command, "unknown Agent Center command")),
    }
}

async fn avatar_material_from_selected_path(
    payload: StandardAgentCenterAvatarMaterialSelectPayload,
    selected_path: Option<PathBuf>,
) -> Result<serde_json::Value, String> {
    let Some(selected_path) = selected_path else {
        return Ok(serde_json::Value::Null);
    };
    crate::standard_agent_center::commands::avatar_material_select(payload, selected_path)
        .await
        .map(crate::standard_agent_center::shell_projection::avatar_material_select_result)
}

async fn background_material_from_selected_path(
    payload: StandardAgentCenterBackgroundMaterialSelectPayload,
    selected_path: Option<PathBuf>,
) -> Result<serde_json::Value, String> {
    let Some(selected_path) = selected_path else {
        return Ok(serde_json::Value::Null);
    };
    crate::standard_agent_center::commands::background_material_select(payload, selected_path)
        .await
        .map(crate::standard_agent_center::shell_projection::background_material_select_result)
}

#[cfg(test)]
pub(crate) async fn agent_center_avatar_asset_import_with_selected_path(
    payload: Option<serde_json::Value>,
    selected_path: Option<PathBuf>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_avatar_asset_import")?;
    avatar_material_from_selected_path(payload, selected_path).await
}

#[cfg(test)]
pub(crate) async fn agent_center_background_import_with_selected_path(
    payload: Option<serde_json::Value>,
    selected_path: Option<PathBuf>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_background_import")?;
    background_material_from_selected_path(payload, selected_path).await
}

#[tauri::command]
pub async fn agent_center_avatar_asset_import(
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload: StandardAgentCenterAvatarMaterialSelectPayload =
        parse_agent_center_payload(payload, "agent_center_avatar_asset_import")?;
    let dialog = rfd::AsyncFileDialog::new();
    let dialog = match payload.backend_kind {
        crate::standard_agent_center::StandardAgentCenterAvatarBackendKind::Live2d => {
            dialog.add_filter("Live2D package", &["zip"])
        }
        crate::standard_agent_center::StandardAgentCenterAvatarBackendKind::Vrm => {
            dialog.add_filter("VRM", &["vrm"])
        }
    };
    let selected_path = dialog
        .set_title(match payload.backend_kind {
            crate::standard_agent_center::StandardAgentCenterAvatarBackendKind::Live2d => {
                "Select Live2D package"
            }
            crate::standard_agent_center::StandardAgentCenterAvatarBackendKind::Vrm => {
                "Select VRM file"
            }
        })
        .pick_file()
        .await
        .map(|file| file.path().to_path_buf());
    avatar_material_from_selected_path(payload, selected_path).await
}

#[tauri::command]
pub async fn agent_center_background_import(
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_background_import")?;
    let selected_path = rfd::AsyncFileDialog::new()
        .set_title("Select background image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
        .await
        .map(|file| file.path().to_path_buf());
    background_material_from_selected_path(payload, selected_path).await
}
