//! Product-control mutating operations: data-root selection, first-run install
//! level / setup state, the account-default-profile and built-in-AIConfig
//! ensure paths, and the authenticated Runtime account resolution they share.

use base64::Engine;
use prost::Message;
use serde::Deserialize;
use std::path::{Path, PathBuf};

use crate::desktop_paths::normalize_desktop_absolute_path;

use super::paths::{now_iso_timestamp, now_unix_ms, product_control_record_path};
use super::pointers::resolve_product_pointers;
use super::projection::read_product_control_projection;
use super::record::{
    ProductControlRecord, ProductControlRecordProjection, ProductControlState,
    ProductDataRootRecord, ProductDataRootStatus, ProductFirstRunRecord,
    ProductFirstRunSetupStatePayload, ProductRepairRecord,
};
use super::record_store::{
    empty_record, ensure_data_root_layout, read_existing_record, selected_data_root_path,
    write_record,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductBuiltInAiConfigScopePayload {
    pub surface_id: String,
}

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

async fn runtime_bridge_unary_decode<Req, Resp>(
    method_id: &str,
    request: Req,
    timeout_ms: Option<u64>,
) -> Result<Resp, String>
where
    Req: Message,
    Resp: Message + Default,
{
    let payload = crate::runtime_bridge::RuntimeBridgeUnaryPayload {
        method_id: method_id.to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms,
    };
    let result = crate::runtime_bridge::runtime_bridge_unary(payload).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64.trim())
        .map_err(|_| format!("{method_id} response could not be decoded"))?;
    Resp::decode(bytes.as_slice())
        .map_err(|error| format!("{method_id} response was invalid: {error}"))
}

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

pub(crate) async fn authenticated_runtime_account_id() -> Result<String, String> {
    let request = crate::runtime_bridge::generated::GetAccountSessionStatusRequest {
        caller: Some(product_control_runtime_account_caller()),
    };
    let payload = crate::runtime_bridge::RuntimeBridgeUnaryPayload {
        method_id: "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus".to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: Some(10_000),
    };
    let result = crate::runtime_bridge::runtime_bridge_unary(payload).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64.trim())
        .map_err(|_| "RuntimeAccountService response could not be decoded".to_string())?;
    let response =
        crate::runtime_bridge::generated::GetAccountSessionStatusResponse::decode(bytes.as_slice())
            .map_err(|error| format!("RuntimeAccountService response was invalid: {error}"))?;
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
    crate::runtime_bridge::generated::AccountCaller {
        app_id: "nimi.desktop".to_string(),
        app_instance_id: "nimi.desktop.local-first-party".to_string(),
        device_id: "desktop-shell".to_string(),
        mode: crate::runtime_bridge::generated::AccountCallerMode::DesktopShell as i32,
        scopes: Vec::new(),
    }
}

pub async fn ensure_account_default_profile_for_product_control(
) -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before Account Default Profile".to_string()
    })?;
    let data_root = selected_data_root_path(&record).ok_or_else(|| {
        "selected nimi_data is required before Account Default Profile".to_string()
    })?;
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
    record.first_run.account_default_profile_ref =
        Some(evidence.account_default_profile_ref.clone());
    write_record(&control_path, &record)?;
    read_product_control_projection()
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
    let control_path = product_control_record_path()?;
    let record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before Account Default Profile".to_string()
    })?;
    let data_root = selected_data_root_path(&record).ok_or_else(|| {
        "selected nimi_data is required before Account Default Profile".to_string()
    })?;
    let account_id = authenticated_runtime_account_id().await?;
    crate::account_profile_library::read_account_default_profile_ai_profile(&data_root, &account_id)
}

pub async fn read_built_in_ai_config_for_scope_init(
    surface_id: &str,
) -> Result<crate::desktop_ai_config_library::BuiltInAiConfigForScopeInit, String> {
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before built-in AIConfig".to_string()
    })?;
    let data_root = selected_data_root_path(&record)
        .ok_or_else(|| "selected nimi_data is required before built-in AIConfig".to_string())?;
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
        runtime_bridge_unary_decode(
            "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness",
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
    record.first_run.built_in_ai_config_refs = evidence_set.refs();
    write_record(&control_path, &record)?;
    crate::desktop_ai_config_library::read_built_in_ai_config_for_scope_init(
        &data_root,
        &account_id,
        surface_id,
        &record.first_run.built_in_ai_config_refs,
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

    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before local AI finalization".to_string()
    })?;
    let data_root = selected_data_root_path(&record)
        .ok_or_else(|| "selected nimi_data is required before local AI finalization".to_string())?;
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
        runtime_bridge_unary_decode(
            "/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile",
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
            runtime_bridge_unary_decode(
                "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness",
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
            runtime_bridge_unary_decode(
                "/nimi.runtime.v1.RuntimeLocalService/MintRuntimeBaselineReadiness",
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
    record.first_run.runtime_baseline_ref = Some(runtime_baseline_ref.clone());
    record.first_run.built_in_ai_config_refs = evidence_set.refs();
    write_record(&control_path, &record)?;
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
            runtime_bridge_unary_decode(
                "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence",
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
            runtime_bridge_unary_decode(
                "/nimi.runtime.v1.RuntimeLocalService/MintFirstRunExecutionEvidence",
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

    record.first_run.runtime_baseline_ref = Some(runtime_baseline_ref);
    record.first_run.built_in_ai_config_refs = evidence_set.refs();
    record.first_run.execution_evidence_ref = Some(execution_evidence_ref);
    record.state = ProductControlState::LocalAiReady;
    if let Some(data_root) = record.data_root.as_mut() {
        data_root.status = ProductDataRootStatus::Ready;
        data_root.verified_at = now_iso_timestamp();
        data_root.verified_at_unix_ms = now_unix_ms();
    }
    record.repair = ProductRepairRecord::default();
    write_record(&control_path, &record)?;
    read_product_control_projection()
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

pub fn set_first_run_setup_state(
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
    record.state = setup_state.clone();
    let reason = payload
        .reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
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
    write_record(&control_path, &record)?;
    read_product_control_projection()
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
