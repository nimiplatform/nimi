//! Runtime-validated canonical Product Control projection adapter.
//!
//! Desktop Tauri commands forward reads and mutations to RuntimeLocalService;
//! Runtime resolves `~/.nimi/nimi.json`, independently validates its data-root
//! binding, and returns typed projections. Desktop may render projections and
//! request admission, but it does not own Product Control authority.
//!
//! Split by responsibility into cohesive submodules; this module root composes
//! them and exposes the stable Tauri command surface. The backend
//! `AdmitProductReadyForUse` admission operation lives in the sibling
//! `desktop_product_control_admission` module.

mod operations;
mod record;
mod record_store;

pub use operations::*;
pub use record::*;
pub(crate) use record_store::*;

const DESKTOP_RUNTIME_APP_ID: &str = "nimi.desktop";
const PRODUCT_CONTROL_CALLER_KIND: &str = "desktop-core";
const PRODUCT_CONTROL_CALLER_ID: &str = "desktop.product-control";
const PRODUCT_CONTROL_SURFACE_ID: &str = "desktop.product-control";
const PRODUCT_CONTROL_TRANSPORT_TIMEOUT_GRACE_MS: u64 = 5_000;

fn product_control_debug_enabled() -> bool {
    matches!(
        std::env::var("NIMI_VERBOSE_RENDERER_LOGS").ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

fn log_product_control_stage(stage: &str) {
    if product_control_debug_enabled() {
        eprintln!("[desktop-product-control] stage={stage}");
    }
}

pub(crate) fn product_control_runtime_bridge_metadata(
) -> crate::runtime_bridge::RuntimeBridgeMetadata {
    crate::runtime_bridge::RuntimeBridgeMetadata {
        app_id: Some(DESKTOP_RUNTIME_APP_ID.to_string()),
        caller_kind: Some(PRODUCT_CONTROL_CALLER_KIND.to_string()),
        caller_id: Some(PRODUCT_CONTROL_CALLER_ID.to_string()),
        surface_id: Some(PRODUCT_CONTROL_SURFACE_ID.to_string()),
        ..Default::default()
    }
}

async fn invoke_product_control_projection_json<Request>(
    method_id: &str,
    request: Request,
    timeout_ms: Option<u64>,
) -> Result<ProductControlRecordProjection, String>
where
    Request: prost::Message + Default,
{
    let invoke = crate::runtime_bridge::invoke_unary_typed_with_metadata(
        method_id,
        request,
        product_control_runtime_bridge_metadata(),
        timeout_ms,
    );
    let response: crate::runtime_bridge::generated::ProductControlProjectionJson =
        if let Some(timeout_ms) = timeout_ms {
            tokio::time::timeout(
                std::time::Duration::from_millis(
                    timeout_ms.saturating_add(PRODUCT_CONTROL_TRANSPORT_TIMEOUT_GRACE_MS),
                ),
                invoke,
            )
            .await
            .map_err(|_| {
                format!(
                    "Runtime product-control transport exceeded {timeout_ms}ms request deadline"
                )
            })??
        } else {
            invoke.await?
        };
    serde_json::from_str::<ProductControlRecordProjection>(&response.json)
        .map_err(|error| format!("Runtime product-control projection decode failed: {error}"))
}

async fn invoke_product_control_selected_data_root_json<Request>(
    method_id: &str,
    request: Request,
    timeout_ms: Option<u64>,
) -> Result<ProductControlSelectedDataRootProjection, String>
where
    Request: prost::Message + Default,
{
    let invoke = crate::runtime_bridge::invoke_unary_typed_with_metadata(
        method_id,
        request,
        product_control_runtime_bridge_metadata(),
        timeout_ms,
    );
    let response: crate::runtime_bridge::generated::ProductControlProjectionJson =
        if let Some(timeout_ms) = timeout_ms {
            tokio::time::timeout(
                std::time::Duration::from_millis(
                    timeout_ms.saturating_add(PRODUCT_CONTROL_TRANSPORT_TIMEOUT_GRACE_MS),
                ),
                invoke,
            )
            .await
            .map_err(|_| {
                format!(
                    "Runtime product-control transport exceeded {timeout_ms}ms request deadline"
                )
            })??
        } else {
            invoke.await?
        };
    serde_json::from_str::<ProductControlSelectedDataRootProjection>(&response.json).map_err(
        |error| format!("Runtime product-control selected-data-root decode failed: {error}"),
    )
}

#[tauri::command]
pub async fn product_control_record_get() -> Result<ProductControlRecordProjection, String> {
    invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_GET_PRODUCT_CONTROL_RECORD_METHOD_ID,
        crate::runtime_bridge::generated::GetProductControlRecordRequest {},
        Some(10_000),
    )
    .await
}

#[tauri::command]
pub async fn product_control_selected_data_root_get(
) -> Result<ProductControlSelectedDataRootProjection, String> {
    invoke_product_control_selected_data_root_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID,
        crate::runtime_bridge::generated::GetProductControlSelectedDataRootRequest {},
        Some(10_000),
    )
    .await
}

fn nimi_data_root_from_projection(
    projection: &ProductControlSelectedDataRootProjection,
) -> Result<std::path::PathBuf, String> {
    if !projection.exists {
        return Err(projection.error.clone().unwrap_or_else(|| {
            "canonical Product Control record is required before this Desktop operation".to_string()
        }));
    }
    if matches!(
        projection.state,
        ProductControlState::ConfigMissing
            | ProductControlState::DataRootMissing
            | ProductControlState::RepairRequired
            | ProductControlState::Blocked
    ) {
        return Err(format!(
            "canonical Product Control state {:?} forbids Desktop data-root use",
            projection.state
        ));
    }
    let data_root = projection.data_root.as_ref().ok_or_else(|| {
        projection.error.clone().unwrap_or_else(|| {
            "selected nimi_data is required before this Desktop operation".to_string()
        })
    })?;
    if !matches!(
        data_root.status,
        ProductDataRootStatus::Selected | ProductDataRootStatus::Ready
    ) {
        return Err(
            "canonical Product Control dataRoot is not selected or ready for Desktop use"
                .to_string(),
        );
    }
    if projection.state == ProductControlState::ReadyForUse
        && data_root.status != ProductDataRootStatus::Ready
    {
        return Err(
            "canonical Product Control ready_for_use requires dataRoot.status=ready".to_string(),
        );
    }
    let path = std::path::PathBuf::from(data_root.path.trim());
    if !path.is_absolute() {
        return Err(format!(
            "canonical Product Control dataRoot.path must be absolute, got: {}",
            path.display()
        ));
    }
    Ok(crate::desktop_paths::normalize_desktop_absolute_path(&path))
}

pub(crate) async fn runtime_validated_nimi_data_root() -> Result<std::path::PathBuf, String> {
    let projection = product_control_selected_data_root_get().await?;
    nimi_data_root_from_projection(&projection)
}

#[cfg(target_os = "windows")]
fn prepare_selected_data_root_for_runtime(data_root: &str) -> Result<(), String> {
    nimi_shell_tauri::prepare_fixed_runtime_data_root(std::path::Path::new(data_root)).map_err(
        |error| {
            format!(
                "prepare selected nimi_data root for fixed Runtime service ({}): {error}",
                error.stage()
            )
        },
    )
}

#[cfg(not(target_os = "windows"))]
fn prepare_selected_data_root_for_runtime(_data_root: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn product_control_record_ensure_created(
) -> Result<ProductControlRecordProjection, String> {
    invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_ENSURE_PRODUCT_CONTROL_RECORD_CREATED_METHOD_ID,
        crate::runtime_bridge::generated::EnsureProductControlRecordCreatedRequest {},
        Some(10_000),
    )
    .await
}

#[tauri::command]
pub async fn product_control_record_select_data_root(
    payload: ProductDataRootSelectPayload,
) -> Result<ProductControlRecordProjection, String> {
    let data_root = payload.data_root.trim().to_string();
    log_product_control_stage("select-data-root-native-prepare-start");
    prepare_selected_data_root_for_runtime(&data_root)?;
    log_product_control_stage("select-data-root-native-prepare-ready");
    log_product_control_stage("select-data-root-runtime-start");
    let projection = invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_SELECT_PRODUCT_CONTROL_DATA_ROOT_METHOD_ID,
        crate::runtime_bridge::generated::SelectProductControlDataRootRequest {
            data_root,
        },
        Some(30_000),
    )
    .await?;
    log_product_control_stage("select-data-root-runtime-ready");
    Ok(projection)
}

#[tauri::command]
pub async fn product_control_record_set_first_run_install_level(
    payload: ProductFirstRunInstallLevelPayload,
) -> Result<ProductControlRecordProjection, String> {
    invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_SET_PRODUCT_CONTROL_FIRST_RUN_INSTALL_LEVEL_METHOD_ID,
        crate::runtime_bridge::generated::SetProductControlFirstRunInstallLevelRequest {
            install_level: payload.install_level,
            ai_profile_alias: payload.ai_profile_alias.unwrap_or_default(),
        },
        Some(10_000),
    )
    .await
}

#[tauri::command]
pub async fn product_control_record_complete_first_run_device_environment_scan(
) -> Result<ProductControlRecordProjection, String> {
    invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_COMPLETE_PRODUCT_CONTROL_FIRST_RUN_DEVICE_ENVIRONMENT_SCAN_METHOD_ID,
        crate::runtime_bridge::generated::CompleteProductControlFirstRunDeviceEnvironmentScanRequest {},
        Some(10_000),
    )
    .await
}

#[tauri::command]
pub async fn product_control_record_ensure_account_default_profile(
) -> Result<ProductControlRecordProjection, String> {
    ensure_account_default_profile_for_product_control().await
}

#[tauri::command]
pub async fn product_control_record_prepare_first_run_local_ai_ready(
) -> Result<ProductControlRecordProjection, String> {
    prepare_first_run_local_ai_ready_for_product_control().await
}

#[tauri::command]
pub async fn product_control_record_reconcile_first_run_setup_state(
) -> Result<ProductControlRecordProjection, String> {
    reconcile_first_run_setup_state_from_runtime().await
}

#[tauri::command]
pub async fn account_default_profile_for_scope_init(
) -> Result<crate::account_profile_library::AccountDefaultProfileAIProfile, String> {
    read_account_default_profile_for_scope_init().await
}

#[tauri::command]
pub async fn built_in_ai_config_for_scope_init(
    payload: ProductBuiltInAiConfigScopePayload,
) -> Result<crate::desktop_ai_config_library::BuiltInAiConfigForScopeInit, String> {
    read_built_in_ai_config_for_scope_init(&payload.surface_id).await
}

#[cfg(test)]
mod tests {
    use super::{
        nimi_data_root_from_projection, ProductControlSelectedDataRootProjection,
        ProductControlState, ProductDataRootRecord, ProductDataRootStatus,
    };
    use std::path::{Path, PathBuf};

    fn selected_projection(
        data_root_path: &Path,
        status: ProductDataRootStatus,
    ) -> ProductControlSelectedDataRootProjection {
        ProductControlSelectedDataRootProjection {
            path: std::env::temp_dir()
                .join("control-plane")
                .join("nimi.json")
                .display()
                .to_string(),
            exists: true,
            state: ProductControlState::DataRootSelected,
            data_root: Some(ProductDataRootRecord {
                path: data_root_path.display().to_string(),
                status,
                selected_at: "2026-07-26T00:00:00.000Z".to_string(),
                verified_at: "2026-07-26T00:00:00.000Z".to_string(),
                selected_at_unix_ms: 1,
                verified_at_unix_ms: 1,
            }),
            error: None,
        }
    }

    #[test]
    fn selected_data_root_adapter_uses_nested_data_root_for_selected_and_ready_states() {
        let data_root = std::env::temp_dir().join("nimi-data");
        for status in [
            ProductDataRootStatus::Selected,
            ProductDataRootStatus::Ready,
        ] {
            let projection = selected_projection(&data_root, status);
            let resolved = nimi_data_root_from_projection(&projection).expect("selected data root");
            assert_eq!(resolved, data_root);
            assert_ne!(resolved, PathBuf::from(&projection.path));
        }
    }

    #[test]
    fn selected_data_root_adapter_rejects_repair_state() {
        let data_root = std::env::temp_dir().join("nimi-data");
        let projection = selected_projection(&data_root, ProductDataRootStatus::RepairRequired);

        let error =
            nimi_data_root_from_projection(&projection).expect_err("repair state must fail closed");

        assert!(error.contains("not selected or ready"));
    }

    #[test]
    fn selected_data_root_adapter_rejects_unusable_projection_state() {
        let data_root = std::env::temp_dir().join("nimi-data");
        for state in [
            ProductControlState::ConfigMissing,
            ProductControlState::DataRootMissing,
            ProductControlState::RepairRequired,
            ProductControlState::Blocked,
        ] {
            let mut projection = selected_projection(&data_root, ProductDataRootStatus::Selected);
            projection.state = state;
            let error = nimi_data_root_from_projection(&projection)
                .expect_err("unusable projection state must fail closed");
            assert!(error.contains("forbids Desktop data-root use"));
        }

        let mut inconsistent = selected_projection(&data_root, ProductDataRootStatus::Selected);
        inconsistent.state = ProductControlState::ReadyForUse;
        let error = nimi_data_root_from_projection(&inconsistent)
            .expect_err("ready state with selected status must fail closed");
        assert!(error.contains("requires dataRoot.status=ready"));
    }

    #[test]
    fn selected_data_root_adapter_rejects_relative_or_missing_data_root() {
        let relative =
            selected_projection(Path::new("relative-data"), ProductDataRootStatus::Ready);
        let relative_error = nimi_data_root_from_projection(&relative)
            .expect_err("relative data root must fail closed");
        assert!(relative_error.contains("must be absolute"));

        let missing = ProductControlSelectedDataRootProjection {
            path: std::env::temp_dir()
                .join("control-plane")
                .join("nimi.json")
                .display()
                .to_string(),
            exists: false,
            state: ProductControlState::ConfigMissing,
            data_root: None,
            error: Some("canonical Product Control record is missing".to_string()),
        };
        let missing_error = nimi_data_root_from_projection(&missing)
            .expect_err("missing canonical record must fail closed");
        assert_eq!(missing_error, "canonical Product Control record is missing");
    }
}
