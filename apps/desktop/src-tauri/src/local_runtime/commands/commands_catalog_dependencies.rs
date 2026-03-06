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
pub fn runtime_local_dependencies_resolve(
    app: AppHandle,
    payload: LocalAiDependenciesResolvePayload,
) -> Result<LocalAiDependencyResolutionPlan, String> {
    append_app_audit_event_non_blocking(
        &app,
        EVENT_DEPENDENCY_RESOLVE_INVOKED,
        None,
        None,
        Some(serde_json::json!({
            "modId": payload.mod_id.clone(),
            "capability": payload.capability.clone(),
            "hasDependencies": payload.dependencies.is_some(),
            "hasDeviceProfile": true,
            "deviceProfile": payload.device_profile.clone(),
        })),
    );
    match resolve_dependency_plan(&app, &payload) {
        Ok(plan) => Ok(plan),
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_DEPENDENCY_RESOLVE_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": payload.mod_id,
                    "capability": payload.capability,
                    "deviceProfile": payload.device_profile,
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

