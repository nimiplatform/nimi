use serde::Deserialize;

use super::{
    authenticated_runtime_account_id, product_control_state_wire_value,
    runtime_product_control_record_for, selected_data_root_for, ProductControlState,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductBuiltInAiConfigScopePayload {
    pub surface_id: String,
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
    let execution_evidence_ref = record
        .first_run
        .execution_evidence_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "executionEvidenceRef is required before built-in AIConfig scope init".to_string()
        })?
        .to_string();
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "first-run install level is required before built-in AIConfig".to_string())?
        .to_string();
    let account_id = authenticated_runtime_account_id().await?;
    let execution_response: crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
            crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceRequest {
                execution_evidence_ref,
                expected_runtime_baseline_ref: runtime_baseline_ref,
                expected_data_root_ref: data_root.display().to_string(),
                expected_install_level: install_level.clone(),
                host_profile: None,
            },
            super::super::product_control_runtime_bridge_metadata(),
            Some(60_000),
        )
        .await?;
    let expected_execution_state =
        product_control_state_wire_value(ProductControlState::LocalAiReady)?;
    if execution_response.state.trim() != expected_execution_state.as_str() {
        return Err(format!(
            "executionEvidenceRef must resolve local_ai_ready before built-in AIConfig scope init (state={}, reason={})",
            execution_response.state.trim(),
            execution_response.reason_code.trim(),
        ));
    }
    let execution_ref = execution_response
        .r#ref
        .ok_or_else(|| "Runtime execution evidence response did not include ref".to_string())?;
    let baseline_bindings =
        crate::desktop_ai_config_library::runtime_capability_bindings_from_execution_evidence_ref(
            &execution_ref,
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

    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "first-run aiProfileAlias is required before built-in AIConfig".to_string())?
        .to_string();
    nimi_shell_tauri::capabilities::ai_profile::verify_first_run_factory_ai_profile(
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
