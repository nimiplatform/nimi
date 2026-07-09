//! Product-control mutating operations: data-root selection, first-run install
//! level / setup state, the account-default-profile and built-in-AIConfig
//! ensure paths, and the authenticated Runtime account resolution they share.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[path = "operations_account.rs"]
mod account;
#[path = "operations_built_in_ai_config.rs"]
mod built_in_ai_config;
#[cfg(test)]
#[path = "operations_test_support.rs"]
mod operations_test_support;
#[cfg(test)]
#[path = "operations_tests.rs"]
mod tests;

pub(crate) use account::authenticated_runtime_account_id;
pub use account::{
    ensure_account_default_profile_for_product_control, read_account_default_profile_for_scope_init,
};
#[cfg(test)]
pub(super) use account::{
    product_control_runtime_account_caller, product_control_runtime_app_registration_request,
    runtime_account_status_rejection_error,
};
pub use built_in_ai_config::{
    read_built_in_ai_config_for_scope_init, ProductBuiltInAiConfigScopePayload,
};
#[cfg(test)]
pub(crate) use operations_test_support::complete_first_run_device_environment_scan_with_profile;
#[cfg(test)]
pub use operations_test_support::{
    ensure_product_control_record_created, select_product_data_root, set_first_run_install_level,
};

use super::record::{ProductControlRecord, ProductControlRecordProjection, ProductControlState};
use super::record_store::selected_data_root_path;

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

// Test-only local product-control record mutator.
// Production code must route product-control state changes through RuntimeLocalService.

fn first_run_factory_profile_ref(install_level: &str) -> String {
    format!(
        "aiprofile/nimi.first-run.local-factory.{}@1",
        install_level.trim().to_lowercase()
    )
}

fn should_remint_runtime_baseline_ref(state: &str, reason_code: &str) -> bool {
    state.trim() != "ready"
        && reason_code.trim() == "RUNTIME_BASELINE_READINESS_REF_BINDING_MISMATCH"
}

fn should_remint_execution_evidence_ref(state: &str, reason_code: &str) -> bool {
    state.trim() != "local_ai_ready"
        && matches!(
            reason_code.trim(),
            "FIRST_RUN_EXECUTION_EVIDENCE_REF_BINDING_MISMATCH"
                | "FIRST_RUN_EXECUTION_EVIDENCE_BASELINE_NOT_READY"
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
        nimi_shell_tauri::capabilities::ai_profile::verify_first_run_factory_ai_profile(
            &ai_profile_alias,
            &install_level,
        )?;

    let profile_response: crate::runtime_bridge::generated::CollectDeviceProfileResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_COLLECT_DEVICE_PROFILE_METHOD_ID,
            crate::runtime_bridge::generated::CollectDeviceProfileRequest {
                extra_ports: Vec::new(),
            },
            super::product_control_runtime_bridge_metadata(),
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
    let resolved_baseline_ref = if let Some(existing_ref) = existing_runtime_baseline_ref {
        let response: crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessResponse =
            crate::runtime_bridge::invoke_unary_typed_with_metadata(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_RUNTIME_BASELINE_READINESS_METHOD_ID,
                crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessRequest {
                    runtime_baseline_ref: existing_ref,
                    host_profile: Some(host_profile.clone()),
                },
                super::product_control_runtime_bridge_metadata(),
                Some(60_000),
            )
            .await?;
        if response.state.trim() != "ready" {
            if !should_remint_runtime_baseline_ref(&response.state, &response.reason_code) {
                return Err(format!(
                    "runtimeBaselineRef resolve failed (state={}, reason={}): {}",
                    response.state.trim(),
                    response.reason_code.trim(),
                    response.detail.trim()
                ));
            }
            None
        } else {
            Some(response.r#ref.ok_or_else(|| {
                "Runtime baseline readiness response did not include runtimeBaselineRef".to_string()
            })?)
        }
    } else {
        None
    };
    let baseline_ref = if let Some(resolved_ref) = resolved_baseline_ref {
        resolved_ref
    } else {
        let response: crate::runtime_bridge::generated::MintRuntimeBaselineReadinessResponse =
            crate::runtime_bridge::invoke_unary_typed_with_metadata(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_MINT_RUNTIME_BASELINE_READINESS_METHOD_ID,
                crate::runtime_bridge::generated::MintRuntimeBaselineReadinessRequest {
                    selected_local_factory_ai_profile_ref: selected_factory_ref.clone(),
                    install_level: install_level.clone(),
                    runtime_data_root_or_data_root_ref: data_root_ref.clone(),
                    host_profile: Some(host_profile.clone()),
                    baseline_consumers: Vec::new(),
                },
                super::product_control_runtime_bridge_metadata(),
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
    let resolved_execution_evidence = if let Some(existing_ref) = existing_execution_evidence_ref {
        let response: crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceResponse =
            crate::runtime_bridge::invoke_unary_typed_with_metadata(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
                crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceRequest {
                    execution_evidence_ref: existing_ref,
                    expected_runtime_baseline_ref: runtime_baseline_ref.clone(),
                    expected_data_root_ref: data_root_ref.clone(),
                    expected_install_level: install_level.clone(),
                    host_profile: Some(host_profile.clone()),
                },
                super::product_control_runtime_bridge_metadata(),
                Some(60_000),
            )
            .await?;
        if response.state.trim() != expected_execution_state.as_str() {
            if !should_remint_execution_evidence_ref(&response.state, &response.reason_code) {
                return Err(format!(
                    "executionEvidenceRef resolve failed (state={}, reason={}): {}",
                    response.state.trim(),
                    response.reason_code.trim(),
                    response.detail.trim()
                ));
            }
            None
        } else {
            Some(response.r#ref.ok_or_else(|| {
                "Runtime execution evidence response did not include ref".to_string()
            })?)
        }
    } else {
        None
    };
    let execution_evidence = if let Some(evidence) = resolved_execution_evidence {
        evidence
    } else {
        let response: crate::runtime_bridge::generated::MintFirstRunExecutionEvidenceResponse =
            crate::runtime_bridge::invoke_unary_typed_with_metadata(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_MINT_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
                crate::runtime_bridge::generated::MintFirstRunExecutionEvidenceRequest {
                    runtime_baseline_ref: runtime_baseline_ref.clone(),
                    selected_local_factory_ai_profile_ref: selected_factory_ref,
                    install_level: install_level.clone(),
                    data_root_ref: data_root_ref.clone(),
                    host_profile: Some(host_profile),
                    recommended_capabilities,
                    submit_scheduling_evaluated: false,
                },
                super::product_control_runtime_bridge_metadata(),
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
            .ok_or_else(|| "Runtime execution evidence response did not include ref".to_string())?
    };
    let execution_evidence_ref = Some(execution_evidence.execution_evidence_ref.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Runtime execution evidence response did not include executionEvidenceRef".to_string()
        })?;
    let baseline_bindings =
        crate::desktop_ai_config_library::runtime_capability_bindings_from_execution_evidence_ref(
            &execution_evidence,
        )?;
    let evidence_set = crate::desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
        &data_root,
        &account_id,
        &ai_profile_alias,
        &install_level,
        &baseline_bindings,
    )?;

    super::invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_FIRST_RUN_LOCAL_AI_READY_EVIDENCE_METHOD_ID,
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
    row: &nimi_shell_tauri::capabilities::ai_profile::PlatformAIProfileFactoryRow,
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

pub async fn reconcile_first_run_setup_state_from_runtime(
) -> Result<ProductControlRecordProjection, String> {
    super::invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RECONCILE_PRODUCT_CONTROL_FIRST_RUN_SETUP_STATE_METHOD_ID,
        crate::runtime_bridge::generated::ReconcileProductControlFirstRunSetupStateRequest {},
        Some(10_000),
    )
    .await
}
