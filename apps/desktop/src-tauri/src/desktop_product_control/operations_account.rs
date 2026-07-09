use super::{
    runtime_product_control_record_for, selected_data_root_for, to_json,
    ProductControlRecordProjection,
};

pub(crate) async fn authenticated_runtime_account_id() -> Result<String, String> {
    let caller = product_control_runtime_account_caller();
    ensure_product_control_runtime_app_registered(&caller).await?;
    let request = crate::runtime_bridge::generated::GetAccountSessionStatusRequest {
        caller: Some(caller.clone()),
    };
    let response: crate::runtime_bridge::generated::GetAccountSessionStatusResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID,
            request,
            super::super::product_control_runtime_bridge_metadata(),
            Some(10_000),
        )
        .await?;
    if let Some(error) = runtime_account_status_rejection_error(&response, &caller) {
        return Err(error);
    }
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

async fn ensure_product_control_runtime_app_registered(
    caller: &crate::runtime_bridge::generated::AccountCaller,
) -> Result<(), String> {
    let request = product_control_runtime_app_registration_request(caller);
    let response: crate::runtime_bridge::generated::RegisterAppResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_AUTH_REGISTER_APP_METHOD_ID,
            request,
            super::super::product_control_runtime_bridge_metadata(),
            Some(10_000),
        )
        .await?;
    if !response.accepted {
        let reason = crate::runtime_bridge::generated::ReasonCode::try_from(response.reason_code)
            .unwrap_or(crate::runtime_bridge::generated::ReasonCode::Unspecified);
        return Err(format!(
            "Runtime app registration rejected for desktop product-control caller app_id={} app_instance_id={} device_id={}: reason_code={}",
            caller.app_id.trim(),
            caller.app_instance_id.trim(),
            caller.device_id.trim(),
            reason.as_str_name()
        ));
    }
    if response.app_instance_id.trim() != caller.app_instance_id.trim() {
        return Err(format!(
            "Runtime app registration returned unexpected app_instance_id for desktop product-control caller: expected={} actual={}",
            caller.app_instance_id.trim(),
            response.app_instance_id.trim()
        ));
    }
    Ok(())
}

pub(crate) fn product_control_runtime_app_registration_request(
    caller: &crate::runtime_bridge::generated::AccountCaller,
) -> crate::runtime_bridge::generated::RegisterAppRequest {
    crate::runtime_bridge::generated::RegisterAppRequest {
        app_id: caller.app_id.trim().to_string(),
        app_instance_id: caller.app_instance_id.trim().to_string(),
        device_id: caller.device_id.trim().to_string(),
        app_version: "1".to_string(),
        capabilities: Vec::new(),
        mode_manifest: Some(crate::runtime_bridge::generated::AppModeManifest {
            app_mode: crate::runtime_bridge::generated::AppMode::Full as i32,
            runtime_required: true,
            realm_required: true,
            world_relation: crate::runtime_bridge::generated::WorldRelation::None as i32,
        }),
        developer_registration: false,
    }
}

pub(crate) fn runtime_account_status_rejection_error(
    response: &crate::runtime_bridge::generated::GetAccountSessionStatusResponse,
    caller: &crate::runtime_bridge::generated::AccountCaller,
) -> Option<String> {
    let reason = crate::runtime_bridge::generated::ReasonCode::try_from(response.reason_code)
        .unwrap_or(crate::runtime_bridge::generated::ReasonCode::Unspecified);
    let account_reason =
        crate::runtime_bridge::generated::AccountReasonCode::try_from(response.account_reason_code)
            .unwrap_or(crate::runtime_bridge::generated::AccountReasonCode::Unspecified);
    if reason == crate::runtime_bridge::generated::ReasonCode::ActionExecuted
        && account_reason == crate::runtime_bridge::generated::AccountReasonCode::ActionExecuted
    {
        return None;
    }
    Some(format!(
        "Runtime account session status rejected for desktop product-control caller app_id={} app_instance_id={} device_id={}: reason_code={} account_reason_code={}",
        caller.app_id.trim(),
        caller.app_instance_id.trim(),
        caller.device_id.trim(),
        reason.as_str_name(),
        account_reason.as_str_name()
    ))
}

pub(crate) fn product_control_runtime_account_caller(
) -> crate::runtime_bridge::generated::AccountCaller {
    nimi_shell_tauri::capabilities::desktop_product_local_agent::desktop_shell_runtime_account_caller("nimi.desktop")
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
    nimi_shell_tauri::capabilities::ai_profile::verify_first_run_factory_ai_profile(
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
    super::super::invoke_product_control_projection_json(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_ACCOUNT_DEFAULT_PROFILE_EVIDENCE_METHOD_ID,
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
