#[tauri::command]
pub fn local_ai_dependencies_apply(
    app: AppHandle,
    payload: LocalAiDependenciesApplyPayload,
) -> Result<LocalAiDependencyApplyResult, String> {
    append_app_audit_event_non_blocking(
        &app,
        EVENT_DEPENDENCY_APPLY_STARTED,
        None,
        None,
        Some(serde_json::json!({
            "modId": payload.plan.mod_id.clone(),
            "planId": payload.plan.plan_id.clone(),
            "dependencyCount": payload.plan.dependencies.len(),
        })),
    );
    match run_dependency_apply(&app, &payload.plan) {
        Ok(result) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_DEPENDENCY_APPLY_COMPLETED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": result.mod_id.clone(),
                    "planId": result.plan_id.clone(),
                    "installedModelCount": result.installed_models.len(),
                    "serviceCount": result.services.len(),
                    "capabilities": result.capabilities.clone(),
                    "stageResults": result.stage_results.clone(),
                    "preflightDecisionCount": result.preflight_decisions.len(),
                    "rollbackApplied": result.rollback_applied,
                    "warningCount": result.warnings.len(),
                })),
            );
            Ok(result)
        }
        Err(failure) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_DEPENDENCY_APPLY_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": payload.plan.mod_id,
                    "planId": payload.plan.plan_id,
                    "reasonCode": extract_reason_code(failure.error.as_str()),
                    "rollbackApplied": failure.rollback_applied,
                    "error": failure.error.clone(),
                })),
            );
            Err(failure.error)
        }
    }
}

#[tauri::command]
pub fn local_ai_services_list(app: AppHandle) -> Result<Vec<LocalAiServiceDescriptor>, String> {
    let mut state = load_state(&app)?;
    let mut changed = false;
    for service in &mut state.services {
        let before_endpoint = service.endpoint.clone();
        let before_engine = service.engine.clone();
        let before_artifact_type = service.artifact_type.clone();
        normalize_service_descriptor(service);
        if service.endpoint != before_endpoint
            || service.engine != before_engine
            || service.artifact_type != before_artifact_type
        {
            changed = true;
        }
    }
    let previous_matrix_fingerprint = json_fingerprint(&state.capability_matrix);
    refresh_state_capability_matrix_with_provider_probe(&app, &mut state);
    if json_fingerprint(&state.capability_matrix) != previous_matrix_fingerprint {
        changed = true;
    }
    if changed {
        save_state(&app, &state)?;
    }
    Ok(state.services)
}

#[tauri::command]
pub fn local_ai_services_install(
    app: AppHandle,
    payload: LocalAiServicesInstallPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let artifact = find_service_artifact(payload.service_id.as_str());
    append_app_audit_event_non_blocking(
        &app,
        EVENT_SERVICE_INSTALL_STARTED,
        None,
        None,
        Some(serde_json::json!({
            "serviceId": payload.service_id.clone(),
            "engine": payload.engine.clone().or_else(|| artifact.as_ref().map(|item| item.engine.clone())),
            "artifactType": artifact.as_ref().map(|item| match item.artifact_type {
                super::types::LocalAiServiceArtifactType::PythonEnv => "python-env",
                super::types::LocalAiServiceArtifactType::Binary => "binary",
                super::types::LocalAiServiceArtifactType::AttachedEndpoint => "attached-endpoint",
            }),
            "localModelId": payload.local_model_id.clone(),
        })),
    );
    let descriptor = match build_service_descriptor_from_install_payload(&app, &payload) {
        Ok(value) => value,
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_SERVICE_INSTALL_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "serviceId": payload.service_id,
                    "reasonCode": extract_reason_code(error.as_str()),
                    "artifactType": artifact.as_ref().map(|item| match item.artifact_type {
                        super::types::LocalAiServiceArtifactType::PythonEnv => "python-env",
                        super::types::LocalAiServiceArtifactType::Binary => "binary",
                        super::types::LocalAiServiceArtifactType::AttachedEndpoint => "attached-endpoint",
                    }),
                    "error": error,
                })),
            );
            return Err(error);
        }
    };
    let saved = upsert_service_descriptor(&app, descriptor)?;
    append_app_audit_event_non_blocking(
        &app,
        EVENT_SERVICE_INSTALL_COMPLETED,
        None,
        saved.local_model_id.as_deref(),
        Some(serde_json::json!({
            "serviceId": saved.service_id.clone(),
            "engine": saved.engine.clone(),
            "artifactType": saved.artifact_type.as_ref().map(|item| match item {
                super::types::LocalAiServiceArtifactType::PythonEnv => "python-env",
                super::types::LocalAiServiceArtifactType::Binary => "binary",
                super::types::LocalAiServiceArtifactType::AttachedEndpoint => "attached-endpoint",
            }),
            "capabilities": saved.capabilities.clone(),
        })),
    );
    Ok(saved)
}

#[tauri::command]
pub fn local_ai_services_start(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    let state = load_state(&app)?;
    let index = find_service_index(&state.services, service_id.as_str())
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"))?;
    let mut service = state.services[index].clone();
    let before_endpoint = service.endpoint.clone();
    let before_engine = service.engine.clone();
    let before_artifact_type = service.artifact_type.clone();
    normalize_service_descriptor(&mut service);
    if service.endpoint != before_endpoint
        || service.engine != before_engine
        || service.artifact_type != before_artifact_type
    {
        service = upsert_service_descriptor(&app, service)?;
    }
    let detail = start_service_runtime(&app, &service)?;
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Active,
        Some(detail),
    )
}

#[tauri::command]
pub fn local_ai_services_stop(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    let state = load_state(&app)?;
    let index = find_service_index(&state.services, service_id.as_str())
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"))?;
    let service = state.services[index].clone();
    if is_managed_service(service.service_id.as_str()) {
        let _ = stop_managed_service(service.service_id.as_str());
    }
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Installed,
        Some("service stopped".to_string()),
    )
}

#[tauri::command]
pub fn local_ai_services_health(
    app: AppHandle,
    payload: Option<LocalAiServiceIdPayload>,
) -> Result<Vec<LocalAiServiceDescriptor>, String> {
    let filter = payload
        .and_then(|item| normalize_non_empty(item.service_id.as_str()))
        .map(|item| item.to_ascii_lowercase());
    let mut state = load_state(&app)?;
    let mut output = Vec::<LocalAiServiceDescriptor>::new();

    for service in &mut state.services {
        if let Some(filter_value) = filter.as_ref() {
            let current = service.service_id.to_ascii_lowercase();
            if &current != filter_value {
                continue;
            }
        }
        normalize_service_descriptor(service);
        if let Err(error) = run_service_runtime_preflight(&app, None, service) {
            service.status = LocalAiServiceStatus::Unhealthy;
            service.detail = Some(error);
            service.updated_at = now_iso_timestamp();
            output.push(service.clone());
            continue;
        }
        match resolve_service_runtime_start_target(service) {
            ServiceRuntimeStartTarget::Endpoint(endpoint) => {
                match probe_service_endpoint_health(service.service_id.as_str(), endpoint.as_str())
                {
                    Ok(detail) => {
                        service.status = LocalAiServiceStatus::Active;
                        service.detail = Some(detail);
                    }
                    Err(error) => {
                        service.status = LocalAiServiceStatus::Unhealthy;
                        service.detail = Some(error);
                    }
                }
            }
            ServiceRuntimeStartTarget::Missing => {
                service.status = LocalAiServiceStatus::Unhealthy;
                service.detail = Some(service_target_missing_reason(service));
            }
        }
        service.updated_at = now_iso_timestamp();
        output.push(service.clone());
    }

    save_state(&app, &state)?;
    Ok(output)
}

#[tauri::command]
pub fn local_ai_services_remove(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Removed,
        Some("service removed".to_string()),
    )
}

#[tauri::command]
pub fn local_ai_nodes_catalog_list(
    app: AppHandle,
    payload: Option<LocalAiNodesCatalogListPayload>,
) -> Result<Vec<LocalAiNodeDescriptor>, String> {
    let mut state = load_state(&app)?;
    let capability = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.capability.clone()))
        .map(|item| item.to_ascii_lowercase());
    let service_id = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.service_id.clone()))
        .map(|item| item.to_ascii_lowercase());
    let provider = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.provider.clone()))
        .map(|item| item.to_ascii_lowercase());

    let previous_matrix_fingerprint = json_fingerprint(&state.capability_matrix);
    refresh_state_capability_matrix_with_provider_probe(&app, &mut state);
    if json_fingerprint(&state.capability_matrix) != previous_matrix_fingerprint {
        save_state(&app, &state)?;
    }

    let nodes = list_nodes_from_services(
        state.services.as_slice(),
        state.capability_matrix.as_slice(),
        capability.as_deref(),
        service_id.as_deref(),
        provider.as_deref(),
    );

    append_app_audit_event_non_blocking(
        &app,
        EVENT_NODE_CATALOG_LISTED,
        None,
        None,
        Some(serde_json::json!({
            "capability": capability,
            "serviceId": service_id,
            "provider": provider,
            "count": nodes.len(),
        })),
    );
    Ok(nodes)
}

