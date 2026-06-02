//! Desktop bridge adapter for Runtime product-control ready admission.
//!
//! Runtime owns the `ready_for_use` state transition and the product-control
//! state machine. Desktop only resolves Desktop-host evidence that Runtime
//! cannot read directly, then submits that evidence to Runtime's admitted RPC.

use crate::desktop_product_control::{
    authenticated_runtime_account_id, selected_data_root_path, ProductControlRecordProjection,
};

const RUNTIME_BASELINE_RESOLVE_METHOD_ID: &str =
    nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_RESOLVE_RUNTIME_BASELINE_READINESS_METHOD_ID;
const RUNTIME_BASELINE_STATE_READY: &str = "ready";

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
    let baseline_response: crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessResponse =
        crate::runtime_bridge::invoke_unary_typed(
            RUNTIME_BASELINE_RESOLVE_METHOD_ID,
            crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessRequest {
                runtime_baseline_ref: runtime_baseline_ref.to_string(),
                host_profile: None,
            },
            Some(30_000),
        )
        .await?;
    if baseline_response.state.trim() != RUNTIME_BASELINE_STATE_READY {
        return Err(format!(
            "runtimeBaselineRef did not resolve ready (state={}, reason={})",
            baseline_response.state.trim(),
            baseline_response.reason_code.trim()
        ));
    }
    let baseline_ref = baseline_response
        .r#ref
        .ok_or_else(|| "Runtime baseline readiness response had no evidence ref".to_string())?;
    let baseline_bindings =
        crate::desktop_ai_config_library::runtime_capability_bindings_from_baseline_ref(
            &baseline_ref,
        )?;
    let built_in_ai_config_set =
        crate::desktop_product_control::resolve_built_in_ai_config_refs_for_admission(
            &data_root,
            &account_id,
            &record.first_run.built_in_ai_config_refs,
            Some(&baseline_bindings),
        )?;
    let response: crate::runtime_bridge::generated::ProductControlProjectionJson =
        crate::runtime_bridge::invoke_unary_typed(
            nimi_shell_tauri::runtime_bridge::RUNTIME_LOCAL_ADMIT_PRODUCT_CONTROL_READY_FOR_USE_METHOD_ID,
            crate::runtime_bridge::generated::AdmitProductControlReadyForUseRequest {
                account_default_profile_evidence_json: serde_json::to_string(&account_evidence)
                    .map_err(|error| format!("serialize account profile evidence: {error}"))?,
                built_in_ai_config_evidence_json: serde_json::to_string(&built_in_ai_config_set)
                    .map_err(|error| format!("serialize built-in AIConfig evidence: {error}"))?,
            },
            Some(30_000),
        )
        .await?;
    serde_json::from_str::<ProductControlRecordProjection>(&response.json).map_err(|error| {
        format!("Runtime product-control admission projection was invalid: {error}")
    })
}
