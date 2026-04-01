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
    let recommendation_request_item_id = format!(
        "catalog-search:{}:{}",
        capability.clone().unwrap_or_else(|| "all".to_string()),
        query.clone().unwrap_or_else(|| "*".to_string()),
    );
    append_recommendation_resolve_invoked(
        &app,
        recommendation_request_item_id.as_str(),
        None,
        capability.as_deref(),
    );

    let profile = collect_device_profile(&app);
    match search_catalog(query.as_deref(), capability.as_deref(), limit, &profile) {
        Ok(items) => {
            for item in &items {
                if let Some(recommendation) = item.recommendation.as_ref() {
                    append_recommendation_resolve_completed(
                        &app,
                        item.item_id.as_str(),
                        Some(item.model_id.as_str()),
                        item.capabilities.first().map(|value| value.as_str()),
                        recommendation,
                    );
                }
            }
            Ok(items)
        }
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
            append_recommendation_resolve_failed(
                &app,
                recommendation_request_item_id.as_str(),
                None,
                capability.as_deref(),
                error.as_str(),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn runtime_local_models_catalog_list_variants(
    app: AppHandle,
    payload: LocalAiModelsCatalogListVariantsPayload,
) -> Result<Vec<CatalogVariantDescriptor>, String> {
    let repo = payload
        .repo
        .as_deref()
        .unwrap_or_default()
        .trim();
    if repo.is_empty() {
        return Err("LOCAL_AI_LIST_VARIANTS_REPO_REQUIRED: repo is required".to_string());
    }
    append_recommendation_resolve_invoked(&app, repo, Some(repo), None);
    let profile = collect_device_profile(&app);
    match list_catalog_variants(repo, &profile) {
        Ok(variants) => {
            for variant in &variants {
                if let Some(recommendation) = variant.recommendation.as_ref() {
                    append_recommendation_resolve_completed(
                        &app,
                        format!("{repo}#{}", variant.entry).as_str(),
                        Some(repo),
                        None,
                        recommendation,
                    );
                }
            }
            Ok(variants)
        }
        Err(error) => {
            append_recommendation_resolve_failed(&app, repo, Some(repo), None, error.as_str());
            Err(error)
        }
    }
}

#[tauri::command]
pub fn runtime_local_models_catalog_resolve_install_plan(
    app: AppHandle,
    payload: LocalAiModelsCatalogResolveInstallPlanPayload,
) -> Result<LocalAiInstallPlanDescriptor, String> {
    let profile = collect_device_profile(&app);
    let audit_item_id = payload.item_id.clone();
    let audit_model_id = payload.model_id.clone();
    let audit_capability = payload
        .capabilities
        .as_ref()
        .and_then(|value| value.first())
        .cloned();
    append_recommendation_resolve_invoked(
        &app,
        audit_item_id
            .as_deref()
            .unwrap_or("catalog-install-plan"),
        audit_model_id.as_deref(),
        audit_capability.as_deref(),
    );
    match resolve_catalog_install_plan(LocalAiCatalogResolveInput {
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
    }, &profile) {
        Ok(plan) => {
            if let Some(recommendation) = plan.recommendation.as_ref() {
                append_recommendation_resolve_completed(
                    &app,
                    plan.item_id.as_str(),
                    Some(plan.model_id.as_str()),
                    plan.capabilities.first().map(|value| value.as_str()),
                    recommendation,
                );
            }
            Ok(plan)
        }
        Err(error) => {
            append_recommendation_resolve_failed(
                &app,
                audit_item_id
                    .as_deref()
                    .unwrap_or("catalog-install-plan"),
                audit_model_id.as_deref(),
                audit_capability.as_deref(),
                error.as_str(),
            );
            Err(error)
        }
    }
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
