use serde::de::DeserializeOwned;

pub use crate::standard_agent_center::{
    StandardAgentCenterAccountLocalResourcesRemovePayload,
    StandardAgentCenterAgentLocalResourcesRemovePayload,
    StandardAgentCenterAvatarAssetImportPayload, StandardAgentCenterAvatarAssetImportResult,
    StandardAgentCenterAvatarAssetValidatePayload, StandardAgentCenterAvatarAssetValidationResult,
    StandardAgentCenterAvatarBackendKind, StandardAgentCenterAvatarPreviewResolvePayload,
    StandardAgentCenterBackgroundAssetResult, StandardAgentCenterBackgroundImportPayload,
    StandardAgentCenterBackgroundImportResult, StandardAgentCenterBackgroundRemovePayload,
    StandardAgentCenterBackgroundValidatePayload, StandardAgentCenterBackgroundValidationResult,
    StandardAgentCenterLive2dAdapterManifestImportPayload,
    StandardAgentCenterLive2dAdapterManifestImportResult,
    StandardAgentCenterLocalResourceRemoveResult, StandardAgentCenterValidationIssue,
};

fn roots(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    command: &str,
) -> Result<crate::runtime_app_storage::StandardAppStorageRoots, String> {
    crate::runtime_app_storage::require_bound_standard_storage_roots(slot.inner(), command)
}

trait AgentCenterCommandPayload: DeserializeOwned {
    fn validate_command_payload(&self) -> Result<(), String>;
}

fn validate_local_scope(
    host_scope: &str,
    account_id: &str,
    owner_user_id: &str,
    runtime_source_ref: &str,
    local_agent_ref: &str,
) -> Result<(), String> {
    crate::standard_agent_center::validate_local_agent_host_scope(host_scope)?;
    crate::standard_agent_center::validate_normalized_id(account_id, "accountId")?;
    crate::standard_agent_center::validate_local_agent_scope(
        owner_user_id,
        runtime_source_ref,
        local_agent_ref,
    )?;
    Ok(())
}

fn validate_source_path(source_path: &str) -> Result<(), String> {
    if source_path.trim().is_empty() {
        return Err("sourcePath must not be empty".to_string());
    }
    Ok(())
}

macro_rules! impl_local_payload {
    ($type:ty) => {
        impl AgentCenterCommandPayload for $type {
            fn validate_command_payload(&self) -> Result<(), String> {
                validate_local_scope(
                    &self.host_scope,
                    &self.account_id,
                    &self.owner_user_id,
                    &self.runtime_source_ref,
                    &self.local_agent_ref,
                )
            }
        }
    };
}

impl AgentCenterCommandPayload for StandardAgentCenterAvatarAssetImportPayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        validate_source_path(&self.source_path)
    }
}

impl AgentCenterCommandPayload for StandardAgentCenterLive2dAdapterManifestImportPayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        crate::standard_agent_center::validate_local_asset_id(
            &self.avatar_asset_ref,
            "avatarAssetRef",
        )?;
        if !self.avatar_asset_ref.starts_with("live2d_") {
            return Err("avatarAssetRef must reference a Live2D asset".to_string());
        }
        validate_source_path(&self.source_path)
    }
}

impl AgentCenterCommandPayload for StandardAgentCenterBackgroundImportPayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        validate_source_path(&self.source_path)
    }
}

impl AgentCenterCommandPayload for StandardAgentCenterAvatarAssetValidatePayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        crate::standard_agent_center::validate_local_asset_id(
            &self.avatar_asset_ref,
            "avatarAssetRef",
        )
    }
}

impl AgentCenterCommandPayload for StandardAgentCenterAvatarPreviewResolvePayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        let inferred = crate::standard_agent_center::avatar_backend_kind_for_asset_ref(
            &self.avatar_asset_ref,
        )?;
        if self.backend_kind.is_some_and(|kind| kind != inferred) {
            return Err("backendKind must match avatarAssetRef".to_string());
        }
        Ok(())
    }
}

impl AgentCenterCommandPayload for StandardAgentCenterBackgroundValidatePayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        crate::standard_agent_center::validate_background_id(
            &self.background_asset_ref,
            "backgroundAssetRef",
        )
    }
}

impl AgentCenterCommandPayload for StandardAgentCenterBackgroundRemovePayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        validate_local_scope(
            &self.host_scope,
            &self.account_id,
            &self.owner_user_id,
            &self.runtime_source_ref,
            &self.local_agent_ref,
        )?;
        crate::standard_agent_center::validate_background_id(
            &self.background_asset_ref,
            "backgroundAssetRef",
        )
    }
}

impl_local_payload!(StandardAgentCenterAgentLocalResourcesRemovePayload);

impl AgentCenterCommandPayload for StandardAgentCenterAccountLocalResourcesRemovePayload {
    fn validate_command_payload(&self) -> Result<(), String> {
        crate::standard_agent_center::validate_account_host_scope(&self.host_scope)?;
        crate::standard_agent_center::validate_normalized_id(&self.account_id, "accountId")?;
        Ok(())
    }
}

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

fn parse_agent_center_payload<T: AgentCenterCommandPayload>(
    payload: Option<serde_json::Value>,
    command: &str,
) -> Result<T, String> {
    let value = payload.ok_or_else(|| invalid_raw_payload(command, "payload is required"))?;
    if !value.is_object() {
        return Err(invalid_raw_payload(command, "payload must be an object"));
    }
    let parsed =
        serde_json::from_value::<T>(value).map_err(|error| invalid_raw_payload(command, error))?;
    parsed
        .validate_command_payload()
        .map_err(|error| invalid_raw_payload(command, error))?;
    Ok(parsed)
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
            parse!(StandardAgentCenterAvatarAssetImportPayload)
        }
        "nimi.shell.agentCenter.avatarAssetValidate" => {
            parse!(StandardAgentCenterAvatarAssetValidatePayload)
        }
        "nimi.shell.agentCenter.avatarAssetResolvePreview" => {
            parse!(StandardAgentCenterAvatarPreviewResolvePayload)
        }
        "nimi.shell.agentCenter.live2dAdapterImport" => {
            parse!(StandardAgentCenterLive2dAdapterManifestImportPayload)
        }
        "nimi.shell.agentCenter.backgroundImport" => {
            parse!(StandardAgentCenterBackgroundImportPayload)
        }
        "nimi.shell.agentCenter.backgroundGet" | "nimi.shell.agentCenter.backgroundValidate" => {
            parse!(StandardAgentCenterBackgroundValidatePayload)
        }
        "nimi.shell.agentCenter.backgroundRemove" => {
            parse!(StandardAgentCenterBackgroundRemovePayload)
        }
        "nimi.shell.agentCenter.agentResourcesRemove" => {
            parse!(StandardAgentCenterAgentLocalResourcesRemovePayload)
        }
        "nimi.shell.agentCenter.accountResourcesRemove" => {
            parse!(StandardAgentCenterAccountLocalResourcesRemovePayload)
        }
        _ => Err(invalid_raw_payload(command, "unknown Agent Center command")),
    }
}

#[tauri::command]
pub async fn agent_center_avatar_asset_import(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_avatar_asset_import")?;
    crate::standard_agent_center::commands::avatar_asset_import(
        roots(slot, "agent_center_avatar_asset_import")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::avatar_asset_import_result)
}

#[tauri::command]
pub async fn agent_center_avatar_asset_validate(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_avatar_asset_validate")?;
    crate::standard_agent_center::commands::avatar_asset_validate(
        roots(slot, "agent_center_avatar_asset_validate")?,
        payload,
    )
    .await
    .and_then(crate::standard_agent_center::shell_projection::avatar_asset_validate_result)
}

#[tauri::command]
pub async fn agent_center_avatar_asset_resolve_preview(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_avatar_asset_resolve_preview")?;
    crate::standard_agent_center::commands::avatar_asset_resolve_preview(
        roots(slot, "agent_center_avatar_asset_resolve_preview")?,
        payload,
    )
    .await
}

#[tauri::command]
pub async fn agent_center_live2d_adapter_import(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_live2d_adapter_import")?;
    crate::standard_agent_center::commands::live2d_adapter_manifest_import(
        roots(slot, "agent_center_live2d_adapter_import")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::live2d_adapter_import_result)
}

#[tauri::command]
pub async fn agent_center_background_import(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_background_import")?;
    crate::standard_agent_center::commands::background_import(
        roots(slot, "agent_center_background_import")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::background_import_result)
}

#[tauri::command]
pub async fn agent_center_background_get(
    app: tauri::AppHandle,
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_background_get")?;
    crate::standard_agent_center::commands::background_get(
        roots(slot, "agent_center_background_get")?,
        app,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::background_get_result)
}

#[tauri::command]
pub async fn agent_center_background_validate(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_background_validate")?;
    crate::standard_agent_center::commands::background_validate(
        roots(slot, "agent_center_background_validate")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::background_validate_result)
}

#[tauri::command]
pub async fn agent_center_background_remove(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_background_remove")?;
    crate::standard_agent_center::commands::background_remove(
        roots(slot, "agent_center_background_remove")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::resource_removal_result)
}

#[tauri::command]
pub async fn agent_center_agent_resources_remove(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_agent_resources_remove")?;
    crate::standard_agent_center::commands::agent_resources_remove(
        roots(slot, "agent_center_agent_resources_remove")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::resource_removal_result)
}

#[tauri::command]
pub async fn agent_center_account_resources_remove(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = parse_agent_center_payload(payload, "agent_center_account_resources_remove")?;
    crate::standard_agent_center::commands::account_resources_remove(
        roots(slot, "agent_center_account_resources_remove")?,
        payload,
    )
    .await
    .map(crate::standard_agent_center::shell_projection::resource_removal_result)
}
