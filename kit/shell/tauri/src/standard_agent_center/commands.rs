use super::*;
use tauri::Manager;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AgentCenterHostError {
    InvalidPayload(String),
    InvalidPath(String),
    NotFound(String),
    HostInternal(String),
    StandardEnvelope(String),
}

pub(crate) type AgentCenterHostResult<T> = Result<T, AgentCenterHostError>;

impl AgentCenterHostError {
    pub(crate) fn render(self, operation: &str) -> String {
        let (code, reason_code, cause) = match self {
            Self::InvalidPayload(cause) => (
                "invalid-payload",
                "tauri-agent-center-payload-invalid",
                cause,
            ),
            Self::InvalidPath(cause) => ("invalid-path", "tauri-agent-center-path-invalid", cause),
            Self::NotFound(cause) => ("not-found", "tauri-agent-center-resource-not-found", cause),
            Self::HostInternal(cause) => (
                "host-internal-error",
                "tauri-agent-center-host-operation-failed",
                cause,
            ),
            Self::StandardEnvelope(envelope) => return envelope,
        };
        crate::capabilities::standard_shell_error(
            code,
            reason_code,
            "inspect_agent_center_host_operation",
            "tauri",
            Some(serde_json::json!({
                "command": operation,
                "cause": cause,
            })),
        )
    }
}

pub(crate) async fn run_agent_center_resource_blocking<T, F>(
    operation: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> AgentCenterHostResult<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(task).await {
        Ok(result) => result.map_err(|error| error.render(operation)),
        Err(error) => Err(crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-agent-center-blocking-task-failed",
            "inspect_agent_center_host_operation",
            "tauri",
            Some(serde_json::json!({
                "command": operation,
                "cause": error.to_string(),
            })),
        )),
    }
}

pub(crate) async fn avatar_asset_import(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarAssetImportPayload,
) -> Result<StandardAgentCenterAvatarAssetImportResult, String> {
    run_agent_center_resource_blocking("agent_center_avatar_asset_import", move || {
        standard_agent_center_avatar_asset_import_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn avatar_asset_validate(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarAssetValidatePayload,
) -> Result<StandardAgentCenterAvatarAssetValidationResult, String> {
    run_agent_center_resource_blocking("agent_center_avatar_asset_validate", move || {
        standard_agent_center_avatar_asset_validate_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn avatar_asset_resolve_preview(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarPreviewResolvePayload,
) -> Result<serde_json::Value, String> {
    let backend_kind = payload.backend_kind.unwrap_or(
        avatar_backend_kind_for_asset_ref(&payload.avatar_asset_ref).map_err(|error| {
            AgentCenterHostError::InvalidPayload(error)
                .render("agent_center_avatar_asset_resolve_preview")
        })?,
    );
    let avatar_asset_ref = payload.avatar_asset_ref.clone();
    let validation_payload = StandardAgentCenterAvatarAssetValidatePayload {
        host_scope: payload.host_scope,
        account_id: payload.account_id,
        owner_user_id: payload.owner_user_id,
        runtime_source_ref: payload.runtime_source_ref,
        local_agent_ref: payload.local_agent_ref,
        avatar_asset_ref: avatar_asset_ref.clone(),
    };
    let validation = avatar_asset_validate(roots, validation_payload).await?;
    Ok(shell_projection::avatar_preview_result(
        avatar_asset_ref,
        backend_kind,
        validation,
    ))
}

pub(crate) async fn live2d_adapter_manifest_import(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<StandardAgentCenterLive2dAdapterManifestImportResult, String> {
    run_agent_center_resource_blocking("agent_center_live2d_adapter_import", move || {
        standard_agent_center_live2d_adapter_manifest_import_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn background_import(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundImportPayload,
) -> Result<StandardAgentCenterBackgroundImportResult, String> {
    run_agent_center_resource_blocking("agent_center_background_import", move || {
        standard_agent_center_background_import_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn background_validate(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> Result<StandardAgentCenterBackgroundValidationResult, String> {
    run_agent_center_resource_blocking("agent_center_background_validate", move || {
        standard_agent_center_background_validate_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn background_get(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    app: tauri::AppHandle,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> Result<StandardAgentCenterBackgroundAssetResult, String> {
    background_get_managed_asset(roots, payload)
        .await
        .and_then(|mut result| {
            let path = PathBuf::from(result.file_url.trim_start_matches("file://"));
            app.state::<tauri::scope::Scopes>()
                .allow_file(&path)
                .map_err(|error| {
                    crate::capabilities::standard_shell_error(
                        "host-internal-error",
                        "tauri-agent-center-background-scope-allow-file-failed",
                        "inspect_tauri_asset_protocol_scope",
                        "tauri",
                        Some(serde_json::json!({
                            "command": "agent_center_background_get",
                            "cause": error.to_string(),
                        })),
                    )
                })?;
            result.file_url = crate::standard_local_assets::tauri_asset_url_for_file_path(&path);
            Ok(result)
        })
}

pub(crate) async fn background_get_managed_asset(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> Result<StandardAgentCenterBackgroundAssetResult, String> {
    run_agent_center_resource_blocking("agent_center_background_get", move || {
        standard_agent_center_background_asset_get_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn background_remove(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("agent_center_background_remove", move || {
        standard_agent_center_background_remove_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn agent_resources_remove(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAgentLocalResourcesRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("agent_center_agent_resources_remove", move || {
        standard_agent_center_agent_local_resources_remove_blocking(&roots, payload)
    })
    .await
}

pub(crate) async fn account_resources_remove(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAccountLocalResourcesRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("agent_center_account_resources_remove", move || {
        standard_agent_center_account_local_resources_remove_blocking(&roots, payload)
    })
    .await
}
