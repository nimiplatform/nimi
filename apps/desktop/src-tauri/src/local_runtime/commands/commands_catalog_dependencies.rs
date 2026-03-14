#[tauri::command]
pub fn runtime_local_models_verified_list() -> Result<Vec<LocalAiVerifiedModelDescriptor>, String> {
    Ok(verified_model_list())
}

#[tauri::command]
pub fn runtime_local_models_catalog_search(
    app: AppHandle,
    payload: Option<LocalAiModelsCatalogSearchPayload>,
) -> Result<Vec<LocalAiCatalogItemDescriptor>, String> {
    let query = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.query.clone()));
    let capability = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.capability.clone()));
    let limit = payload
        .as_ref()
        .and_then(|item| item.limit)
        .unwrap_or(20)
        .clamp(1, 80);

    append_app_audit_event_non_blocking(
        &app,
        EVENT_MODEL_CATALOG_SEARCH_INVOKED,
        None,
        None,
        Some(serde_json::json!({
            "query": query,
            "capability": capability,
            "limit": limit,
        })),
    );

    match search_catalog(query.as_deref(), capability.as_deref(), limit) {
        Ok(items) => Ok(items),
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_MODEL_CATALOG_SEARCH_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "query": query,
                    "capability": capability,
                    "limit": limit,
                    "reasonCode": extract_reason_code(error.as_str()),
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn runtime_local_models_catalog_list_variants(
    payload: LocalAiModelsCatalogListVariantsPayload,
) -> Result<Vec<GgufVariantDescriptor>, String> {
    let repo = payload
        .repo
        .as_deref()
        .unwrap_or_default()
        .trim();
    if repo.is_empty() {
        return Err("LOCAL_AI_LIST_VARIANTS_REPO_REQUIRED: repo is required".to_string());
    }
    list_repo_gguf_variants(repo)
}

#[tauri::command]
pub fn runtime_local_models_catalog_resolve_install_plan(
    payload: LocalAiModelsCatalogResolveInstallPlanPayload,
) -> Result<LocalAiInstallPlanDescriptor, String> {
    resolve_catalog_install_plan(LocalAiCatalogResolveInput {
        item_id: payload.item_id,
        source: payload.source,
        template_id: payload.template_id,
        model_id: payload.model_id,
        repo: payload.repo,
        revision: payload.revision,
        capabilities: payload.capabilities,
        engine: payload.engine,
        entry: payload.entry,
        files: payload.files,
        license: payload.license,
        hashes: payload.hashes,
        endpoint: payload.endpoint,
    })
}

#[tauri::command]
pub fn runtime_local_profiles_resolve(
    app: AppHandle,
    payload: LocalAiProfilesResolvePayload,
) -> Result<LocalAiProfileResolutionPlan, String> {
    append_app_audit_event_non_blocking(
        &app,
        EVENT_PROFILE_RESOLVE_INVOKED,
        None,
        None,
        Some(serde_json::json!({
            "modId": payload.mod_id.clone(),
            "profileId": payload.profile.id.clone(),
            "capability": payload.capability.clone(),
            "entryCount": payload.profile.entries.len(),
            "consumeCapabilities": payload.profile.consume_capabilities.clone(),
            "hasDeviceProfile": payload.device_profile.is_some(),
        })),
    );
    match resolve_profile_plan(&app, &payload) {
        Ok(plan) => Ok(plan),
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_PROFILE_RESOLVE_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": payload.mod_id,
                    "profileId": payload.profile.id,
                    "capability": payload.capability,
                    "reasonCode": extract_reason_code(error.as_str()),
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn runtime_local_device_profile_collect(app: AppHandle) -> Result<LocalAiDeviceProfile, String> {
    Ok(collect_device_profile(&app))
}
