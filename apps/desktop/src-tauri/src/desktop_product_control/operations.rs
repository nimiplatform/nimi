//! Product-control mutating operations: data-root selection, first-run install
//! level / setup state, the account-default-profile and built-in-AIConfig
//! ensure paths, and the authenticated Runtime account resolution they share.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[cfg(test)]
use crate::desktop_paths::normalize_desktop_absolute_path;

#[cfg(test)]
use super::paths::product_control_record_path;
#[cfg(test)]
use super::paths::{now_iso_timestamp, now_unix_ms};
#[cfg(test)]
use super::pointers::resolve_product_pointers;
#[cfg(test)]
use super::projection::read_product_control_projection;
use super::record::{ProductControlRecord, ProductControlRecordProjection, ProductControlState};
#[cfg(test)]
use super::record::{
    ProductDataRootRecord, ProductDataRootStatus, ProductFirstRunRecord,
    ProductFirstRunSetupStatePayload, ProductRepairRecord,
};
use super::record_store::selected_data_root_path;
#[cfg(test)]
use super::record_store::{
    empty_record, ensure_data_root_layout, read_existing_record, write_record,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductBuiltInAiConfigScopePayload {
    pub surface_id: String,
}

fn to_json<T: Serialize>(value: &T, label: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize {label}: {error}"))
}

async fn runtime_product_control_record_for(action: &str) -> Result<ProductControlRecord, String> {
    let projection = super::product_control_record_get().await?;
    projection.record.ok_or_else(|| {
        projection
            .error
            .unwrap_or_else(|| format!("product-control record is required before {action}"))
    })
}

fn selected_data_root_for(record: &ProductControlRecord, action: &str) -> Result<PathBuf, String> {
    selected_data_root_path(record)
        .ok_or_else(|| format!("selected nimi_data is required before {action}"))
}

#[cfg(test)]
pub fn ensure_product_control_record_created() -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    match read_existing_record(&control_path) {
        Ok(Some(_)) => read_product_control_projection(),
        Ok(None) => {
            let record = empty_record(ProductControlState::DataRootMissing)?;
            if let Err(error) = write_record(&control_path, &record) {
                return Ok(ProductControlRecordProjection {
                    path: control_path.display().to_string(),
                    exists: false,
                    state: ProductControlState::Blocked,
                    record: None,
                    error: Some(format!("~/.nimi/nimi.json could not be created: {error}")),
                });
            }
            read_product_control_projection()
        }
        Err(_) => read_product_control_projection(),
    }
}

#[cfg(test)]
pub fn select_product_data_root(path: &str) -> Result<ProductControlRecordProjection, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("nimi_data path is required".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!("nimi_data path must be absolute, got: {trimmed}"));
    }
    let normalized = normalize_desktop_absolute_path(&candidate);
    let control_path = product_control_record_path()?;
    let mut record = match read_existing_record(&control_path)? {
        Some(mut record) => {
            ensure_first_run_data_root_selection_allowed(&record)?;
            record.first_run = ProductFirstRunRecord::default();
            record
        }
        None => empty_record(ProductControlState::DataRootMissing)?,
    };
    ensure_data_root_layout(&normalized)?;
    let now = now_unix_ms();
    record.state = ProductControlState::DataRootSelected;
    record.data_root = Some(ProductDataRootRecord {
        path: normalized.display().to_string(),
        status: ProductDataRootStatus::Selected,
        selected_at: now_iso_timestamp(),
        verified_at: now_iso_timestamp(),
        selected_at_unix_ms: now,
        verified_at_unix_ms: now,
    });
    record.pointers = resolve_product_pointers()?;
    record.repair = ProductRepairRecord::default();
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

#[cfg(test)]
fn ensure_first_run_data_root_selection_allowed(
    record: &ProductControlRecord,
) -> Result<(), String> {
    if !matches!(
        record.state,
        ProductControlState::ConfigMissing
            | ProductControlState::DataRootMissing
            | ProductControlState::DataRootSelected
            | ProductControlState::AiEnvironmentUnconfigured
    ) {
        return Err(format!(
            "nimi_data data root is already beyond first-run selection state ({:?}); data-root selection is first-run only",
            record.state
        ));
    }
    if record
        .data_root
        .as_ref()
        .is_some_and(|data_root| matches!(data_root.status, ProductDataRootStatus::Ready))
    {
        return Err(
            "nimi_data data root is already ready; data-root selection is first-run only"
                .to_string(),
        );
    }
    let first_run = &record.first_run;
    let has_heavy_setup_evidence = first_run.completed
        || first_run.completed_at.is_some()
        || first_run.initialization_plan_id.is_some()
        || first_run.baseline_profile_ref.is_some()
        || first_run.baseline_commit_id.is_some()
        || first_run.account_default_profile_ref.is_some()
        || !first_run.built_in_ai_config_refs.is_empty()
        || first_run.runtime_baseline_ref.is_some()
        || first_run.execution_evidence_ref.is_some();
    if has_heavy_setup_evidence {
        return Err(
            "nimi_data data root cannot be changed after first-run evidence exists".to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
pub fn set_first_run_install_level(
    install_level: &str,
    ai_profile_alias: Option<String>,
) -> Result<ProductControlRecordProjection, String> {
    let normalized = install_level.trim().to_lowercase();
    if normalized != "minimal" && normalized != "recommended" {
        return Err("first-run install level must be minimal or recommended".to_string());
    }
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before install level".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before install level".to_string());
    }
    let normalized_alias = ai_profile_alias
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let alias = normalized_alias
        .as_deref()
        .ok_or_else(|| "first-run aiProfileAlias is required".to_string())?;
    nimi_shell_tauri::platform_catalog::ai_profile_factory::verify_first_run_factory_ai_profile(
        alias,
        &normalized,
    )?;
    record.first_run.install_level = Some(normalized);
    record.first_run.ai_profile_alias = Some(alias.to_string());
    record.first_run.completed = false;
    record.first_run.completed_at = None;
    record.first_run.initialization_plan_id = None;
    record.first_run.baseline_profile_ref = None;
    record.first_run.baseline_commit_id = None;
    record.first_run.account_default_profile_ref = None;
    record.first_run.built_in_ai_config_refs = Vec::new();
    record.first_run.runtime_baseline_ref = None;
    record.first_run.execution_evidence_ref = None;
    if matches!(record.state, ProductControlState::DataRootSelected) {
        record.state = ProductControlState::AiEnvironmentUnconfigured;
    }
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

async fn collect_first_run_device_profile(
) -> Result<crate::runtime_bridge::generated::LocalDeviceProfile, String> {
    let profile_response: crate::runtime_bridge::generated::CollectDeviceProfileResponse =
        crate::runtime_bridge::invoke_unary_typed(
            nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_COLLECT_DEVICE_PROFILE_METHOD_ID,
            crate::runtime_bridge::generated::CollectDeviceProfileRequest {
                extra_ports: Vec::new(),
            },
            Some(10_000),
        )
        .await?;
    let host_profile = profile_response
        .profile
        .ok_or_else(|| "Runtime did not return a device profile".to_string())?;
    validate_first_run_device_profile(&host_profile)?;
    Ok(host_profile)
}

fn validate_first_run_device_profile(
    profile: &crate::runtime_bridge::generated::LocalDeviceProfile,
) -> Result<(), String> {
    if profile.os.trim().is_empty() || profile.arch.trim().is_empty() {
        return Err("Runtime device profile must include os and arch".to_string());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn complete_first_run_device_environment_scan_with_profile(
    host_profile: crate::runtime_bridge::generated::LocalDeviceProfile,
) -> Result<ProductControlRecordProjection, String> {
    validate_first_run_device_profile(&host_profile)?;
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before device scan".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before device scan".to_string());
    }
    match record.state {
        ProductControlState::DataRootSelected => {
            record.state = ProductControlState::AiEnvironmentUnconfigured;
        }
        ProductControlState::AiEnvironmentUnconfigured => {}
        _ => {
            return Err(
                "device environment scan can only complete after data-root selection".to_string(),
            );
        }
    }
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

pub(crate) async fn authenticated_runtime_account_id() -> Result<String, String> {
    let request = crate::runtime_bridge::generated::GetAccountSessionStatusRequest {
        caller: Some(product_control_runtime_account_caller()),
    };
    let response: crate::runtime_bridge::generated::GetAccountSessionStatusResponse =
        crate::runtime_bridge::invoke_unary_typed(
            nimi_shell_tauri::runtime_bridge::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID,
            request,
            Some(10_000),
        )
        .await?;
    if response.state != crate::runtime_bridge::generated::AccountSessionState::Authenticated as i32
    {
        return Err("authenticated Runtime account session is required".to_string());
    }
    let account_id = response
        .account_projection
        .as_ref()
        .map(|projection| projection.account_id.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "authenticated Runtime account session did not include account_id".to_string()
        })?;
    Ok(account_id)
}

fn product_control_runtime_account_caller() -> crate::runtime_bridge::generated::AccountCaller {
    nimi_shell_tauri::runtime_account_caller::desktop_shell_runtime_account_caller("nimi.desktop")
        .expect("desktop shell runtime account caller")
}

pub async fn ensure_account_default_profile_for_product_control(
) -> Result<ProductControlRecordProjection, String> {
    let record = runtime_product_control_record_for("Account Default Profile").await?;
    let data_root = selected_data_root_for(&record, "Account Default Profile")?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run install level is required before Account Default Profile".to_string()
        })?
        .to_string();
    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run aiProfileAlias is required before Account Default Profile".to_string()
        })?
        .to_string();
    nimi_shell_tauri::platform_catalog::ai_profile_factory::verify_first_run_factory_ai_profile(
        &ai_profile_alias,
        &install_level,
    )?;
    let account_id = authenticated_runtime_account_id().await?;
    let evidence = crate::account_profile_library::ensure_account_default_profile(
        &data_root,
        &account_id,
        &ai_profile_alias,
        &install_level,
    )?;
    super::invoke_product_control_projection_json(
        nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_ACCOUNT_DEFAULT_PROFILE_EVIDENCE_METHOD_ID,
        crate::runtime_bridge::generated::RecordProductControlAccountDefaultProfileEvidenceRequest {
            account_default_profile_evidence_json: to_json(&evidence, "Account Default Profile evidence")?,
        },
        Some(10_000),
    )
    .await
}

/// Read + verify the Account Default Profile and project it as a portable
/// AIProfile payload for the Desktop host AIConfig scope-init rule
/// (product manual "Profile And AIConfig Model").
///
/// A new AIConfig scope initializes its config from the Account Default
/// Profile ONLY when no prior AIConfig exists for that scope; the renderer
/// reads this projection for that one-time initialization. It is the verified
/// content of the durable `default.json` record — never realm session or
/// app-local state.
pub async fn read_account_default_profile_for_scope_init(
) -> Result<crate::account_profile_library::AccountDefaultProfileAIProfile, String> {
    let record = runtime_product_control_record_for("Account Default Profile").await?;
    let data_root = selected_data_root_for(&record, "Account Default Profile")?;
    let account_id = authenticated_runtime_account_id().await?;
    crate::account_profile_library::read_account_default_profile_ai_profile(&data_root, &account_id)
}

pub async fn read_built_in_ai_config_for_scope_init(
    surface_id: &str,
) -> Result<crate::desktop_ai_config_library::BuiltInAiConfigForScopeInit, String> {
    let record = runtime_product_control_record_for("built-in AIConfig").await?;
    let data_root = selected_data_root_for(&record, "built-in AIConfig")?;
    let runtime_baseline_ref = record
        .first_run
        .runtime_baseline_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "runtimeBaselineRef is required before built-in AIConfig scope init".to_string()
        })?
        .to_string();
    let account_id = authenticated_runtime_account_id().await?;
    let baseline_response: crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessResponse =
        crate::runtime_bridge::invoke_unary_typed(
            nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RESOLVE_RUNTIME_BASELINE_READINESS_METHOD_ID,
            crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessRequest {
                runtime_baseline_ref,
                host_profile: None,
            },
            Some(60_000),
        )
        .await?;
    if baseline_response.state.trim() != "ready" {
        return Err(format!(
            "runtimeBaselineRef must resolve ready before built-in AIConfig scope init (state={}, reason={})",
            baseline_response.state.trim(),
            baseline_response.reason_code.trim(),
        ));
    }
    let baseline_ref = baseline_response
        .r#ref
        .ok_or_else(|| "Runtime baseline readiness response did not include ref".to_string())?;
    let baseline_bindings =
        crate::desktop_ai_config_library::runtime_capability_bindings_from_baseline_ref(
            &baseline_ref,
        )?;
    if let Ok(config) = crate::desktop_ai_config_library::read_built_in_ai_config_for_scope_init(
        &data_root,
        &account_id,
        surface_id,
        &record.first_run.built_in_ai_config_refs,
        &baseline_bindings,
    ) {
        return Ok(config);
    }

    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "first-run install level is required before built-in AIConfig".to_string())?
        .to_string();
    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "first-run aiProfileAlias is required before built-in AIConfig".to_string())?
        .to_string();
    nimi_shell_tauri::platform_catalog::ai_profile_factory::verify_first_run_factory_ai_profile(
        &ai_profile_alias,
        &install_level,
    )?;
    let evidence_set = crate::desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
        &data_root,
        &account_id,
        &ai_profile_alias,
        &install_level,
        &baseline_bindings,
    )?;
    crate::desktop_ai_config_library::read_built_in_ai_config_for_scope_init(
        &data_root,
        &account_id,
        surface_id,
        &evidence_set.refs(),
        &baseline_bindings,
    )
}

fn first_run_factory_profile_ref(install_level: &str) -> String {
    format!(
        "aiprofile/nimi.first-run.local-factory.{}@1",
        install_level.trim().to_lowercase()
    )
}

pub async fn prepare_first_run_local_ai_ready_for_product_control(
) -> Result<ProductControlRecordProjection, String> {
    ensure_account_default_profile_for_product_control().await?;

    let record = runtime_product_control_record_for("local AI finalization").await?;
    let data_root = selected_data_root_for(&record, "local AI finalization")?;
    let account_id = authenticated_runtime_account_id().await?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run install level is required before local AI finalization".to_string()
        })?
        .to_string();
    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run aiProfileAlias is required before local AI finalization".to_string()
        })?
        .to_string();
    let factory_row =
        nimi_shell_tauri::platform_catalog::ai_profile_factory::verify_first_run_factory_ai_profile(
            &ai_profile_alias,
            &install_level,
        )?;

    let profile_response: crate::runtime_bridge::generated::CollectDeviceProfileResponse =
        crate::runtime_bridge::invoke_unary_typed(
            nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_COLLECT_DEVICE_PROFILE_METHOD_ID,
            crate::runtime_bridge::generated::CollectDeviceProfileRequest {
                extra_ports: Vec::new(),
            },
            Some(10_000),
        )
        .await?;
    let host_profile = profile_response
        .profile
        .ok_or_else(|| "Runtime did not return a device profile".to_string())?;
    let selected_factory_ref = first_run_factory_profile_ref(&install_level);
    let data_root_ref = data_root.display().to_string();

    let existing_runtime_baseline_ref = record
        .first_run
        .runtime_baseline_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let baseline_ref = if let Some(existing_ref) = existing_runtime_baseline_ref {
        let response: crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessResponse =
            crate::runtime_bridge::invoke_unary_typed(
                nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RESOLVE_RUNTIME_BASELINE_READINESS_METHOD_ID,
                crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessRequest {
                    runtime_baseline_ref: existing_ref,
                    host_profile: Some(host_profile.clone()),
                },
                Some(60_000),
            )
            .await?;
        if response.state.trim() != "ready" {
            return Err(format!(
                "runtimeBaselineRef resolve failed (state={}, reason={}): {}",
                response.state.trim(),
                response.reason_code.trim(),
                response.detail.trim()
            ));
        }
        response.r#ref.ok_or_else(|| {
            "Runtime baseline readiness response did not include runtimeBaselineRef".to_string()
        })?
    } else {
        let response: crate::runtime_bridge::generated::MintRuntimeBaselineReadinessResponse =
            crate::runtime_bridge::invoke_unary_typed(
                nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_MINT_RUNTIME_BASELINE_READINESS_METHOD_ID,
                crate::runtime_bridge::generated::MintRuntimeBaselineReadinessRequest {
                    selected_local_factory_ai_profile_ref: selected_factory_ref.clone(),
                    install_level: install_level.clone(),
                    runtime_data_root_or_data_root_ref: data_root_ref.clone(),
                    host_profile: Some(host_profile.clone()),
                    baseline_consumers: Vec::new(),
                },
                Some(60_000),
            )
            .await?;
        if response.state.trim() != "ready" {
            return Err(format!(
                "runtimeBaselineRef mint failed (state={}, reason={}): {}",
                response.state.trim(),
                response.reason_code.trim(),
                response.detail.trim()
            ));
        }
        response.r#ref.ok_or_else(|| {
            "Runtime baseline readiness response did not include runtimeBaselineRef".to_string()
        })?
    };
    let runtime_baseline_ref = Some(baseline_ref.runtime_baseline_ref.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Runtime baseline readiness response did not include runtimeBaselineRef".to_string()
        })?;
    let baseline_bindings =
        crate::desktop_ai_config_library::runtime_capability_bindings_from_baseline_ref(
            &baseline_ref,
        )?;
    let evidence_set = crate::desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
        &data_root,
        &account_id,
        &ai_profile_alias,
        &install_level,
        &baseline_bindings,
    )?;
    let recommended_capabilities = recommended_first_run_capabilities(factory_row, &install_level);

    let expected_execution_state =
        product_control_state_wire_value(ProductControlState::LocalAiReady)?;
    let existing_execution_evidence_ref = record
        .first_run
        .execution_evidence_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let execution_evidence_ref = if let Some(existing_ref) = existing_execution_evidence_ref {
        let response: crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceResponse =
            crate::runtime_bridge::invoke_unary_typed(
                nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
                crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceRequest {
                    execution_evidence_ref: existing_ref,
                    expected_runtime_baseline_ref: runtime_baseline_ref.clone(),
                    expected_data_root_ref: data_root_ref.clone(),
                    expected_install_level: install_level.clone(),
                    host_profile: Some(host_profile.clone()),
                },
                Some(60_000),
            )
            .await?;
        if response.state.trim() != expected_execution_state.as_str() {
            return Err(format!(
                "executionEvidenceRef resolve failed (state={}, reason={}): {}",
                response.state.trim(),
                response.reason_code.trim(),
                response.detail.trim()
            ));
        }
        response
            .r#ref
            .as_ref()
            .map(|value| value.execution_evidence_ref.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "Runtime execution evidence response did not include executionEvidenceRef"
                    .to_string()
            })?
    } else {
        let response: crate::runtime_bridge::generated::MintFirstRunExecutionEvidenceResponse =
            crate::runtime_bridge::invoke_unary_typed(
                nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_MINT_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
                crate::runtime_bridge::generated::MintFirstRunExecutionEvidenceRequest {
                    runtime_baseline_ref: runtime_baseline_ref.clone(),
                    selected_local_factory_ai_profile_ref: selected_factory_ref,
                    install_level: install_level.clone(),
                    data_root_ref: data_root_ref.clone(),
                    host_profile: Some(host_profile),
                    recommended_capabilities,
                    submit_scheduling_evaluated: false,
                },
                Some(120_000),
            )
            .await?;
        if response.state.trim() != expected_execution_state.as_str() {
            return Err(format!(
                "executionEvidenceRef mint failed (state={}, reason={}): {}",
                response.state.trim(),
                response.reason_code.trim(),
                response.detail.trim()
            ));
        }
        response
            .r#ref
            .as_ref()
            .map(|value| value.execution_evidence_ref.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "Runtime execution evidence response did not include executionEvidenceRef"
                    .to_string()
            })?
    };

    super::invoke_product_control_projection_json(
        nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_FIRST_RUN_LOCAL_AI_READY_EVIDENCE_METHOD_ID,
        crate::runtime_bridge::generated::RecordProductControlFirstRunLocalAiReadyEvidenceRequest {
            runtime_baseline_ref,
            built_in_ai_config_evidence_json: to_json(&evidence_set, "built-in AIConfig evidence")?,
            execution_evidence_ref,
        },
        Some(30_000),
    )
    .await
}

fn recommended_first_run_capabilities(
    row: &nimi_shell_tauri::platform_catalog::ai_profile_factory::PlatformAIProfileFactoryRow,
    install_level: &str,
) -> Vec<String> {
    if install_level.trim() != "recommended" {
        return Vec::new();
    }
    let minimal_floor = ["text.generate", "audio.transcribe", "audio.synthesize"];
    row.capability_set
        .iter()
        .copied()
        .filter(|capability| !minimal_floor.contains(capability))
        .map(str::to_string)
        .collect()
}

fn product_control_state_wire_value(state: ProductControlState) -> Result<String, String> {
    let value = serde_json::to_value(state)
        .map_err(|error| format!("failed to serialize product-control state: {error}"))?;
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "product-control state did not serialize to a string".to_string())
}

/// Resolve + verify the recorded `builtInAiConfigRefs` through the Desktop host
/// AIConfig service for the backend `AdmitProductReadyForUse` operation.
///
/// This is the seam admission step 6 calls. It does NOT write `ready_for_use`.
/// Fails closed when either canonical built-in chat scope cannot be resolved,
/// when the recorded set is partial, or when a string-only ref is supplied.
///
/// `data_root` and `authenticated_account_id` are the inputs the caller has
/// already resolved through their owners earlier in the `P-COLD-016`
/// composition (selected `nimi_data` and the authenticated Runtime account
/// session). They are passed in so this seam does not re-resolve the account
/// binding — admission owns a single authenticated account resolution.
pub fn resolve_built_in_ai_config_refs_for_admission(
    data_root: &Path,
    authenticated_account_id: &str,
    built_in_ai_config_refs: &[String],
    expected_baseline_bindings: Option<
        &[crate::desktop_ai_config_library::BuiltInAiConfigCapability],
    >,
) -> Result<crate::desktop_ai_config_library::BuiltInAiConfigEvidenceSet, String> {
    crate::desktop_ai_config_library::verify_built_in_ai_config_evidence_set(
        data_root,
        authenticated_account_id,
        built_in_ai_config_refs,
        expected_baseline_bindings,
    )
}

#[allow(dead_code)]
#[cfg(test)]
fn parse_first_run_setup_state(value: &str) -> Result<ProductControlState, String> {
    let quoted = serde_json::to_string(value.trim())
        .map_err(|error| format!("failed to parse first-run setup state: {error}"))?;
    let parsed = serde_json::from_str::<ProductControlState>(&quoted).map_err(|_| {
        "first-run setup state must be a non-ready local setup, repair, or blocked state"
            .to_string()
    })?;
    match parsed {
        ProductControlState::LocalAiProfileSelectedAssetsMissing
        | ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
        | ProductControlState::LocalAiAssetsDownloadedEnvironmentNotReady
        | ProductControlState::RepairRequired
        | ProductControlState::Blocked => Ok(parsed),
        ProductControlState::LocalAiReady => {
            Err(
                "first-run setup state cannot mark local AI ready without Runtime admission verification"
                    .to_string(),
            )
        }
        ProductControlState::ReadyForUse => {
            Err("first-run setup state cannot mark ready_for_use".to_string())
        }
        _ => Err(
            "first-run setup state must be a non-ready local setup, repair, or blocked state"
                .to_string(),
        ),
    }
}

#[cfg(test)]
fn apply_first_run_setup_state(
    record: &mut ProductControlRecord,
    setup_state: ProductControlState,
    reason: Option<String>,
) {
    record.state = setup_state.clone();
    if matches!(
        setup_state,
        ProductControlState::RepairRequired | ProductControlState::Blocked
    ) {
        record.repair = ProductRepairRecord {
            required: true,
            reason,
        };
        if let Some(data_root) = record.data_root.as_mut() {
            data_root.status = ProductDataRootStatus::RepairRequired;
        }
    } else {
        record.repair = ProductRepairRecord::default();
    }
}

#[cfg(test)]
pub(crate) fn set_first_run_setup_state(
    payload: ProductFirstRunSetupStatePayload,
) -> Result<ProductControlRecordProjection, String> {
    let setup_state = parse_first_run_setup_state(&payload.state)?;
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before Runtime setup state".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before Runtime setup state".to_string());
    }
    if record.first_run.install_level.as_deref().is_none() {
        return Err("first-run install level is required before Runtime setup state".to_string());
    }
    let reason = payload
        .reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    apply_first_run_setup_state(&mut record, setup_state, reason);
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

fn normalized_runtime_state(value: &str) -> String {
    value.trim().to_lowercase()
}

fn local_environment_dependency_ready(state: &str) -> bool {
    matches!(
        normalized_runtime_state(state).as_str(),
        "ready_managed" | "ready_system"
    )
}

fn local_environment_dependency_needs_confirmation(
    dependency: &crate::runtime_bridge::generated::LocalEnvironmentPlanDependency,
) -> bool {
    dependency.confirmation_required
        && normalized_runtime_state(&dependency.state) == "needs_confirmation"
}

fn local_environment_dependency_repair_required(state: &str) -> bool {
    normalized_runtime_state(state) == "repair_required"
}

fn local_environment_dependency_unsupported(state: &str) -> bool {
    normalized_runtime_state(state) == "unsupported"
}

fn local_environment_dependency_job_active(state: &str) -> bool {
    matches!(
        normalized_runtime_state(state).as_str(),
        "needs_confirmation" | "queued" | "downloading" | "verifying" | "installing"
    )
}

fn local_environment_dependency_job_failed(state: &str) -> bool {
    normalized_runtime_state(state) == "failed"
}

fn local_environment_dependency_job_cancelled(state: &str) -> bool {
    normalized_runtime_state(state) == "cancelled"
}

fn local_environment_dependency_in_first_run_scope(
    dependency: &crate::runtime_bridge::generated::LocalEnvironmentPlanDependency,
    required_families: &[&str],
) -> bool {
    dependency.required
        || required_families
            .iter()
            .any(|family| *family == dependency.dependency_family.trim())
}

fn latest_matching_local_environment_job(
    dependency: &crate::runtime_bridge::generated::LocalEnvironmentPlanDependency,
    jobs: &[crate::runtime_bridge::generated::LocalEnvironmentDependencyJob],
) -> Option<crate::runtime_bridge::generated::LocalEnvironmentDependencyJob> {
    let mut matches: Vec<_> = jobs
        .iter()
        .filter(|job| {
            job.environment_key == dependency.environment_key
                && job.dependency_family == dependency.dependency_family
                && job.dependency_id == dependency.dependency_id
        })
        .cloned()
        .collect();
    matches.sort_by(|left, right| {
        let left_key = if left.updated_at.trim().is_empty() {
            &left.created_at
        } else {
            &left.updated_at
        };
        let right_key = if right.updated_at.trim().is_empty() {
            &right.created_at
        } else {
            &right.updated_at
        };
        right_key.cmp(left_key)
    });
    matches.into_iter().next()
}

fn first_run_materialization_product_state_for_status(status: &str) -> ProductControlState {
    match normalized_runtime_state(status).as_str() {
        "blocked" | "unsupported" => ProductControlState::Blocked,
        "failed" | "repair_required" | "cancelled" | "activation_pending" => {
            ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
        }
        "local_ai_ready" => ProductControlState::LocalAiReady,
        _ => ProductControlState::LocalAiProfileSelectedAssetsMissing,
    }
}

fn first_run_setup_status_from_runtime_evidence(
    dependencies: &[(
        crate::runtime_bridge::generated::LocalEnvironmentPlanDependency,
        Option<crate::runtime_bridge::generated::LocalEnvironmentDependencyJob>,
    )],
    missing_dependency_families: &[String],
) -> &'static str {
    if !missing_dependency_families.is_empty() || dependencies.is_empty() {
        return "blocked";
    }
    if dependencies.iter().any(|(dependency, job)| {
        !local_environment_dependency_ready(&dependency.state)
            && (local_environment_dependency_unsupported(&dependency.state)
                || job
                    .as_ref()
                    .is_some_and(|job| local_environment_dependency_unsupported(&job.state)))
    }) {
        return "unsupported";
    }
    if dependencies.iter().any(|(dependency, job)| {
        !local_environment_dependency_ready(&dependency.state)
            && (local_environment_dependency_repair_required(&dependency.state)
                || job
                    .as_ref()
                    .is_some_and(|job| local_environment_dependency_repair_required(&job.state)))
    }) {
        return "repair_required";
    }
    if dependencies.iter().any(|(dependency, job)| {
        !local_environment_dependency_ready(&dependency.state)
            && job
                .as_ref()
                .is_some_and(|job| local_environment_dependency_job_failed(&job.state))
    }) {
        return "failed";
    }
    if dependencies.iter().any(|(dependency, job)| {
        !local_environment_dependency_ready(&dependency.state)
            && job
                .as_ref()
                .is_some_and(|job| local_environment_dependency_job_cancelled(&job.state))
    }) {
        return "cancelled";
    }
    if dependencies.iter().any(|(dependency, job)| {
        !local_environment_dependency_ready(&dependency.state)
            && local_environment_dependency_needs_confirmation(dependency)
            && job.is_none()
    }) {
        return "needs_confirmation";
    }
    if dependencies.iter().any(|(_, job)| {
        job.as_ref()
            .is_some_and(|job| local_environment_dependency_job_active(&job.state))
    }) {
        return "in_progress";
    }
    if dependencies
        .iter()
        .all(|(dependency, _)| local_environment_dependency_ready(&dependency.state))
    {
        return "local_ai_ready";
    }
    "activation_pending"
}

fn first_run_materialization_reason_for_status(
    status: &str,
    missing_dependency_families: &[String],
) -> String {
    if !missing_dependency_families.is_empty() {
        return format!(
            "missing_dependency_families:{}",
            missing_dependency_families.join(",")
        );
    }
    match normalized_runtime_state(status).as_str() {
        "needs_confirmation" => "materialization_requires_confirmation",
        "in_progress" => "runtime_materialization_jobs_in_progress",
        "activation_pending" => "runtime_activation_gate_not_ready",
        "local_ai_ready" => "runtime_local_ai_ready_evidence_projected",
        "repair_required" => "runtime_materialization_repair_required",
        "failed" => "runtime_materialization_job_failed",
        "cancelled" => "runtime_materialization_job_cancelled",
        "unsupported" => "runtime_materialization_unsupported",
        "blocked" => "runtime_materialization_blocked",
        _ => "runtime_materialization_jobs_started",
    }
    .to_string()
}

pub async fn reconcile_first_run_setup_state_from_runtime(
) -> Result<ProductControlRecordProjection, String> {
    let record = runtime_product_control_record_for("Runtime setup state").await?;
    let data_root = selected_data_root_for(&record, "Runtime setup state")?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run install level is required before Runtime setup state".to_string()
        })?
        .to_string();
    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run aiProfileAlias is required before Runtime setup state".to_string()
        })?
        .to_string();
    let factory_row =
        nimi_shell_tauri::platform_catalog::ai_profile_factory::verify_first_run_factory_ai_profile(
            &ai_profile_alias,
            &install_level,
        )?;
    let host_profile = collect_first_run_device_profile().await?;
    let runtime_data_root = data_root.display().to_string();
    let mut scoped_dependencies: Vec<(
        crate::runtime_bridge::generated::LocalEnvironmentPlanDependency,
        Option<crate::runtime_bridge::generated::LocalEnvironmentDependencyJob>,
    )> = Vec::new();
    let mut found_families: HashMap<String, bool> = HashMap::new();
    for pack_id in factory_row.local_compute_pack_refs {
        let response: crate::runtime_bridge::generated::ResolveLocalEnvironmentPlanResponse =
            crate::runtime_bridge::invoke_unary_typed(
                nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RESOLVE_LOCAL_ENVIRONMENT_PLAN_METHOD_ID,
                crate::runtime_bridge::generated::ResolveLocalEnvironmentPlanRequest {
                    pack_id: (*pack_id).to_string(),
                    consumer_scope: "first-run".to_string(),
                    host_profile: Some(host_profile.clone()),
                    runtime_data_root: runtime_data_root.clone(),
                    asset_id: String::new(),
                    local_asset_id: String::new(),
                    companion_asset_id: String::new(),
                    parent_asset_id: String::new(),
                    install_level: install_level.clone(),
                },
                Some(60_000),
            )
            .await?;
        let plan = response
            .plan
            .ok_or_else(|| "Runtime did not return a local environment plan".to_string())?;
        for dependency in plan.dependencies {
            if !local_environment_dependency_in_first_run_scope(
                &dependency,
                factory_row.dependency_family_refs,
            ) {
                continue;
            }
            found_families.insert(dependency.dependency_family.clone(), true);
            let jobs_response: crate::runtime_bridge::generated::ListLocalEnvironmentDependencyJobsResponse =
                crate::runtime_bridge::invoke_unary_typed(
                    nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_LIST_LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD_ID,
                    crate::runtime_bridge::generated::ListLocalEnvironmentDependencyJobsRequest {
                        environment_key: dependency.environment_key.clone(),
                        state: String::new(),
                    },
                    Some(10_000),
                )
                .await?;
            let latest_job =
                latest_matching_local_environment_job(&dependency, &jobs_response.jobs);
            scoped_dependencies.push((dependency, latest_job));
        }
    }
    let missing_dependency_families: Vec<String> = factory_row
        .dependency_family_refs
        .iter()
        .filter(|family| !found_families.contains_key(**family))
        .map(|family| (*family).to_string())
        .collect();
    let status = first_run_setup_status_from_runtime_evidence(
        &scoped_dependencies,
        &missing_dependency_families,
    );
    let product_state = first_run_materialization_product_state_for_status(status);
    if product_state == ProductControlState::LocalAiReady {
        return super::product_control_record_get().await;
    }
    let reason = first_run_materialization_reason_for_status(status, &missing_dependency_families);
    if record.state == product_state {
        return super::product_control_record_get().await;
    }
    let state = product_control_state_wire_value(product_state)?;
    super::invoke_product_control_projection_json(
        nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RECONCILE_PRODUCT_CONTROL_FIRST_RUN_SETUP_STATE_METHOD_ID,
        crate::runtime_bridge::generated::ReconcileProductControlFirstRunSetupStateRequest {
            state,
            reason,
        },
        Some(10_000),
    )
    .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn product_control_account_resolution_uses_admitted_desktop_caller() {
        let caller = super::product_control_runtime_account_caller();
        assert_eq!(caller.app_id, "nimi.desktop");
        assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
        assert_eq!(caller.device_id, "desktop-shell");
        assert_eq!(
            caller.mode,
            crate::runtime_bridge::generated::AccountCallerMode::DesktopShell as i32
        );
    }
}
