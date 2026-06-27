//! Desktop bridge adapter for Runtime product-control ready admission.
//!
//! Runtime owns the `ready_for_use` state transition and the product-control
//! state machine. Desktop only resolves Desktop-host evidence that Runtime
//! cannot read directly, then submits that evidence to Runtime's admitted RPC.

use crate::desktop_product_control::{
    authenticated_runtime_account_id, selected_data_root_path, ProductControlRecordProjection,
};

const RUNTIME_EXECUTION_RESOLVE_METHOD_ID: &str =
    nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID;
const RUNTIME_EXECUTION_STATE_READY: &str = "local_ai_ready";

/// Tauri command `product_control_record_admit_ready_for_use`.
///
/// The renderer cannot submit refs or state to this command. Desktop resolves
/// the current Runtime product-control projection, verifies Desktop-host-owned
/// Account Default Profile / built-in AIConfig evidence, and submits explicit
/// evidence to Runtime. Runtime re-resolves Runtime-owned evidence and commits
/// the product-control state machine.
#[tauri::command]
pub async fn product_control_record_admit_ready_for_use(
) -> Result<ProductControlRecordProjection, String> {
    let projection = crate::desktop_product_control::product_control_record_get().await?;
    let record = projection
        .record
        .ok_or_else(|| "product-control record is required before ready admission".to_string())?;
    let data_root = selected_data_root_path(&record)
        .ok_or_else(|| "selected nimi_data is required before ready admission".to_string())?;
    let account_id = authenticated_runtime_account_id().await?;
    let account_ref = record
        .first_run
        .account_default_profile_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "accountDefaultProfileRef is required before ready admission".to_string())?;
    let account_evidence = crate::account_profile_library::verify_account_default_profile_ref(
        &data_root,
        &account_id,
        account_ref,
    )?;
    let runtime_baseline_ref = record
        .first_run
        .runtime_baseline_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "runtimeBaselineRef is required before ready admission".to_string())?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "installLevel is required before ready admission".to_string())?;
    let execution_evidence_ref = record
        .first_run
        .execution_evidence_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "executionEvidenceRef is required before ready admission".to_string())?;
    let execution_response: crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            RUNTIME_EXECUTION_RESOLVE_METHOD_ID,
            crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceRequest {
                execution_evidence_ref: execution_evidence_ref.to_string(),
                expected_runtime_baseline_ref: runtime_baseline_ref.to_string(),
                expected_data_root_ref: data_root.display().to_string(),
                expected_install_level: install_level.to_string(),
                host_profile: None,
            },
            crate::desktop_product_control::product_control_runtime_bridge_metadata(),
            Some(30_000),
        )
        .await?;
    if execution_response.state.trim() != RUNTIME_EXECUTION_STATE_READY {
        return Err(format!(
            "executionEvidenceRef did not resolve local_ai_ready (state={}, reason={})",
            execution_response.state.trim(),
            execution_response.reason_code.trim()
        ));
    }
    let execution_ref = execution_response
        .r#ref
        .ok_or_else(|| "Runtime execution evidence response had no evidence ref".to_string())?;
    let baseline_bindings =
        crate::desktop_ai_config_library::runtime_capability_bindings_from_execution_evidence_ref(
            &execution_ref,
        )?;
    let built_in_ai_config_set =
        crate::desktop_product_control::resolve_built_in_ai_config_refs_for_admission(
            &data_root,
            &account_id,
            &record.first_run.built_in_ai_config_refs,
            Some(&baseline_bindings),
        )?;
    let response: crate::runtime_bridge::generated::ProductControlProjectionJson =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_ADMIT_PRODUCT_CONTROL_READY_FOR_USE_METHOD_ID,
            crate::runtime_bridge::generated::AdmitProductControlReadyForUseRequest {
                account_default_profile_evidence_json: serde_json::to_string(&account_evidence)
                    .map_err(|error| format!("serialize account profile evidence: {error}"))?,
                built_in_ai_config_evidence_json: serde_json::to_string(&built_in_ai_config_set)
                    .map_err(|error| format!("serialize built-in AIConfig evidence: {error}"))?,
            },
            crate::desktop_product_control::product_control_runtime_bridge_metadata(),
            Some(30_000),
        )
        .await?;
    serde_json::from_str::<ProductControlRecordProjection>(&response.json).map_err(|error| {
        format!("Runtime product-control admission projection was invalid: {error}")
    })
}
