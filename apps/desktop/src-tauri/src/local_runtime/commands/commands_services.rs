#[tauri::command]
pub async fn runtime_local_profiles_apply(
    app: AppHandle,
    payload: LocalAiProfilesApplyPayload,
) -> Result<LocalAiProfileApplyAccepted, String> {
    let apply_session_id = next_profile_apply_session_id(payload.plan.plan_id.as_str());
    let accepted = LocalAiProfileApplyAccepted {
        apply_session_id: apply_session_id.clone(),
        plan_id: payload.plan.plan_id.clone(),
        target_id: payload.plan.target_id.clone(),
        profile_id: payload.plan.profile_id.clone(),
    };
    emit_profile_apply_progress(
        &app,
        &accepted,
        "queued",
        "queued",
        Some("queued local runtime profile apply".to_string()),
        None,
        None,
        None,
        None,
    );
    let bg_app = app.clone();
    let bg_accepted = accepted.clone();
    tauri::async_runtime::spawn(async move {
        emit_profile_apply_progress(
            &bg_app,
            &bg_accepted,
            "apply",
            "running",
            Some("applying local runtime profile".to_string()),
            None,
            None,
            None,
            None,
        );
        match run_local_profile_apply(&bg_app, payload).await {
            Ok(result) => emit_profile_apply_progress(
                &bg_app,
                &bg_accepted,
                "complete",
                "completed",
                Some("local runtime profile apply completed".to_string()),
                None,
                result.reason_code.clone(),
                Some(result.execution_result.rollback_applied),
                Some(result),
            ),
            Err(failure) => emit_profile_apply_progress(
                &bg_app,
                &bg_accepted,
                "complete",
                "failed",
                Some("local runtime profile apply failed".to_string()),
                Some(failure.error.clone()),
                Some(extract_reason_code(failure.error.as_str())),
                Some(failure.rollback_applied),
                None,
            ),
        }
    });
    Ok(accepted)
}

#[tauri::command]
pub async fn runtime_local_profiles_apply_status(
    app: AppHandle,
    payload: LocalAiProfileApplyStatusPayload,
) -> Result<Option<LocalAiProfileApplyProgressEvent>, String> {
    let apply_session_id = payload.apply_session_id.trim().to_string();
    if apply_session_id.is_empty() {
        return Err("LOCAL_AI_PROFILE_APPLY_SESSION_ID_REQUIRED: applySessionId is required".to_string());
    }
    let state = tauri::async_runtime::spawn_blocking(move || load_state(&app))
        .await
        .map_err(|error| format!("LOCAL_AI_PROFILE_APPLY_STATUS_JOIN_FAILED: {error}"))??;
    Ok(state
        .profile_apply_sessions
        .into_iter()
        .find(|event| event.apply_session_id == apply_session_id))
}

#[tauri::command]
pub async fn runtime_local_profiles_apply_sessions(
    app: AppHandle,
) -> Result<Vec<LocalAiProfileApplyProgressEvent>, String> {
    let mut sessions = tauri::async_runtime::spawn_blocking(move || load_state(&app))
        .await
        .map_err(|error| format!("LOCAL_AI_PROFILE_APPLY_SESSIONS_JOIN_FAILED: {error}"))??
        .profile_apply_sessions;
    sessions.sort_by(|left, right| right.occurred_at.cmp(&left.occurred_at));
    Ok(sessions)
}

fn emit_profile_apply_progress(
    app: &AppHandle,
    accepted: &LocalAiProfileApplyAccepted,
    phase: &str,
    status: &str,
    message: Option<String>,
    error: Option<String>,
    reason_code: Option<String>,
    rollback_applied: Option<bool>,
    result: Option<LocalAiProfileApplyResult>,
) {
    let event = LocalAiProfileApplyProgressEvent {
        apply_session_id: accepted.apply_session_id.clone(),
        plan_id: accepted.plan_id.clone(),
        target_id: accepted.target_id.clone(),
        profile_id: accepted.profile_id.clone(),
        phase: phase.to_string(),
        status: status.to_string(),
        occurred_at: now_iso_timestamp(),
        message,
        error,
        reason_code,
        rollback_applied,
        result,
    };
    persist_profile_apply_progress(app, &event);
    if let Err(error) = app.emit("local-runtime://profile-apply-progress", &event) {
        eprintln!("LOCAL_AI_PROFILE_APPLY_PROGRESS_EMIT_FAILED: {error}");
    }
}

fn persist_profile_apply_progress(app: &AppHandle, event: &LocalAiProfileApplyProgressEvent) {
    let event = event.clone();
    let result = save_state_with_profile_apply_event(app, event);
    if let Err(error) = result {
        eprintln!("LOCAL_AI_PROFILE_APPLY_PROGRESS_PERSIST_FAILED: {error}");
    }
}

fn save_state_with_profile_apply_event(
    app: &AppHandle,
    event: LocalAiProfileApplyProgressEvent,
) -> Result<(), String> {
    let mut state = load_state(app)?;
    if let Some(existing) = state
        .profile_apply_sessions
        .iter_mut()
        .find(|item| item.apply_session_id == event.apply_session_id)
    {
        *existing = event;
    } else {
        state.profile_apply_sessions.push(event);
    }
    save_state(app, &state)
}

async fn run_local_profile_apply(
    app: &AppHandle,
    payload: LocalAiProfilesApplyPayload,
) -> Result<LocalAiProfileApplyResult, LocalAiDependencyApplyFailure> {
    append_app_audit_event_non_blocking(
        app,
        EVENT_PROFILE_APPLY_STARTED,
        None,
        None,
        Some(serde_json::json!({
            "targetId": payload.plan.target_id.clone(),
            "profileId": payload.plan.profile_id.clone(),
            "planId": payload.plan.plan_id.clone(),
            "runtimeEntryCount": payload.plan.execution_plan.dependencies.len(),
            "assetEntryCount": payload.plan.asset_entries.len(),
        })),
    );
    match run_dependency_apply(app, &payload.plan.execution_plan).await {
        Ok(execution_result) => {
            let execution_reason_code = execution_result.reason_code.clone();
            let mut warnings = payload.plan.warnings.clone();
            let mut installed_assets = Vec::new();
            let mut reason_code = execution_reason_code.clone();
            for entry in &payload.plan.asset_entries {
                let template_id = normalize_optional(entry.template_id.clone());
                if template_id.is_none() {
                    warnings.push(format!(
                        "LOCAL_AI_PROFILE_ASSET_TEMPLATE_ID_REQUIRED: entryId={} requires templateId",
                        entry.entry_id
                    ));
                    if entry.required != Some(false) {
                        reason_code = Some("LOCAL_AI_PROFILE_ASSET_TEMPLATE_ID_REQUIRED".to_string());
                        break;
                    }
                    continue;
                }
                match find_verified_asset(template_id.as_deref().unwrap_or_default()) {
                    Some(_descriptor) => match runtime_install_verified_asset_via_runtime(
                        template_id.as_deref().unwrap_or_default(),
                        None,
                    ) {
                        Ok(record) => installed_assets.push(serde_json::to_value(record).unwrap_or_default()),
                        Err(error) => {
                            warnings.push(error.clone());
                            if entry.required != Some(false) {
                                reason_code = Some(extract_reason_code(error.as_str()));
                                break;
                            }
                        }
                    },
                    None => {
                        warnings.push(format!(
                            "LOCAL_AI_VERIFIED_ASSET_TEMPLATE_NOT_FOUND: templateId={}",
                            template_id.unwrap_or_default()
                        ));
                        if entry.required != Some(false) {
                            reason_code = Some("LOCAL_AI_VERIFIED_ASSET_TEMPLATE_NOT_FOUND".to_string());
                            break;
                        }
                    }
                }
            }
            let result = LocalAiProfileApplyResult {
                plan_id: payload.plan.plan_id.clone(),
                target_id: payload.plan.target_id.clone(),
                profile_id: payload.plan.profile_id.clone(),
                execution_result,
                installed_assets,
                warnings: warnings
                    .into_iter()
                    .filter(|value| !value.trim().is_empty())
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>(),
                reason_code: reason_code.or(execution_reason_code),
            };
            append_app_audit_event_non_blocking(
                app,
                EVENT_PROFILE_APPLY_COMPLETED,
                None,
                None,
                Some(serde_json::json!({
                    "targetId": result.target_id.clone(),
                    "profileId": result.profile_id.clone(),
                    "planId": result.plan_id.clone(),
                    "installedAssetCount": result.execution_result.installed_assets.len(),
                    "serviceCount": result.execution_result.services.len(),
                    "warningCount": result.warnings.len(),
                })),
            );
            Ok(result)
        }
        Err(failure) => {
            append_app_audit_event_non_blocking(
                app,
                EVENT_PROFILE_APPLY_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "targetId": payload.plan.target_id,
                    "profileId": payload.plan.profile_id,
                    "planId": payload.plan.plan_id,
                    "reasonCode": extract_reason_code(failure.error.as_str()),
                    "rollbackApplied": failure.rollback_applied,
                    "error": failure.error.clone(),
                })),
            );
            Err(failure)
        }
    }
}

#[tauri::command]
pub async fn runtime_local_services_list(
    app: AppHandle,
) -> Result<Vec<LocalAiServiceDescriptor>, String> {
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

    let client = std::sync::Arc::new(
        reqwest::Client::builder()
            .build()
            .map_err(|error| format!("LOCAL_AI_SERVICE_LIST_HTTP_CLIENT_FAILED: {error}"))?,
    );
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
    let mut join_set = tokio::task::JoinSet::new();
    for service in &state.services {
        if service.status == LocalAiServiceStatus::Removed {
            continue;
        }
        let endpoint = service
            .endpoint
            .as_deref()
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if endpoint.is_empty() {
            continue;
        }
        let client = client.clone();
        let semaphore = semaphore.clone();
        let service_id = service.service_id.clone();
        join_set.spawn(async move {
            let permit = semaphore.acquire_owned().await.ok();
            let result = probe_service_capability_models_async(
                service_id.as_str(),
                endpoint.as_str(),
                &client,
            ).await;
            drop(permit);
            (service_id, result)
        });
    }

    let mut probe_models_by_service = std::collections::BTreeMap::<String, Vec<String>>::new();
    while let Some(joined) = join_set.join_next().await {
        let (service_id, result) = joined
            .map_err(|error| format!("LOCAL_AI_SERVICE_LIST_TASK_JOIN_FAILED: {error}"))?;
        if let Ok(payload) = result {
            let ids = extract_probe_model_ids(&payload);
            if !ids.is_empty() {
                probe_models_by_service.insert(service_id, ids);
            }
        }
    }

    let previous_matrix_fingerprint = json_fingerprint(&state.capability_matrix);
    let profile = collect_device_profile_async(&app).await;
    refresh_state_capability_matrix_with_probe_and_device(
        &mut state,
        &probe_models_by_service,
        Some(&profile),
    );
    if json_fingerprint(&state.capability_matrix) != previous_matrix_fingerprint {
        changed = true;
    }
    if changed {
        save_state(&app, &state)?;
    }
    Ok(state.services)
}

#[tauri::command]
pub async fn runtime_local_services_install(
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
    let descriptor = match build_service_descriptor_from_install_payload(&app, &payload).await {
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
pub async fn runtime_local_services_start(
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
    let detail = start_service_runtime(&app, &service).await?;
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Active,
        Some(detail),
    )
}

#[tauri::command]
pub async fn runtime_local_services_stop(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| format!("LOCAL_AI_SERVICE_STOP_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn runtime_local_services_health(
    app: AppHandle,
    payload: Option<LocalAiServiceIdPayload>,
) -> Result<Vec<LocalAiServiceDescriptor>, String> {
    let filter = payload
        .and_then(|item| normalize_non_empty(item.service_id.as_str()))
        .map(|item| item.to_ascii_lowercase());
    let mut state = load_state(&app)?;
    let profile = collect_device_profile_async(&app).await;
    let mut selected_indices = Vec::<usize>::new();
    let mut plans = Vec::<(usize, String, String)>::new();

    for (index, service) in state.services.iter_mut().enumerate() {
        if let Some(filter_value) = filter.as_ref() {
            let current = service.service_id.to_ascii_lowercase();
            if &current != filter_value {
                continue;
            }
        }
        selected_indices.push(index);
        normalize_service_descriptor(service);
        match preflight_service_artifact(
            None,
            service.service_id.as_str(),
            service.endpoint.as_deref(),
            &profile,
        ) {
            Ok(decisions) => {
                if let Some(failed) = decisions.iter().find(|item| !item.ok) {
                    service.status = LocalAiServiceStatus::Unhealthy;
                    service.detail = Some(format!("{}: {}", failed.reason_code, failed.detail));
                    service.updated_at = now_iso_timestamp();
                    continue;
                }
            }
            Err(error) => {
                service.status = LocalAiServiceStatus::Unhealthy;
                service.detail = Some(error);
                service.updated_at = now_iso_timestamp();
                continue;
            }
        }
        match resolve_service_runtime_start_target(service) {
            ServiceRuntimeStartTarget::Endpoint(endpoint) => {
                plans.push((index, service.service_id.clone(), endpoint));
            }
            ServiceRuntimeStartTarget::Missing => {
                service.status = LocalAiServiceStatus::Unhealthy;
                service.detail = Some(service_target_missing_reason(service));
                service.updated_at = now_iso_timestamp();
            }
        }
    }

    if !plans.is_empty() {
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
        let client = std::sync::Arc::new(
            reqwest::Client::builder()
                .build()
                .map_err(|error| {
                    format!("LOCAL_AI_SERVICE_HEALTH_HTTP_CLIENT_FAILED: error={error}")
                })?,
        );
        let mut join_set = tokio::task::JoinSet::new();
        for (plan_index, service_id, endpoint) in &plans {
            let semaphore = semaphore.clone();
            let client = client.clone();
            let service_id = service_id.clone();
            let endpoint = endpoint.clone();
            let plan_index = *plan_index;
            join_set.spawn(async move {
                let permit = semaphore.acquire_owned().await.ok();
                let outcome = probe_service_endpoint_health_async(
                    service_id.as_str(),
                    endpoint.as_str(),
                    &client,
                ).await;
                drop(permit);
                (plan_index, outcome)
            });
        }

        let mut probe_results = std::collections::BTreeMap::<usize, Result<String, String>>::new();
        while let Some(joined) = join_set.join_next().await {
            let (index, result) = joined
                .map_err(|error| format!("LOCAL_AI_SERVICE_HEALTH_TASK_JOIN_FAILED: {error}"))?;
            probe_results.insert(index, result);
        }

        for (index, _, _) in &plans {
            let service = state.services.get_mut(*index).ok_or_else(|| {
                format!("LOCAL_AI_SERVICE_NOT_FOUND: index={index}")
            })?;
            match probe_results.remove(index) {
                Some(Ok(detail)) => {
                    service.status = LocalAiServiceStatus::Active;
                    service.detail = Some(detail);
                }
                Some(Err(error)) => {
                    service.status = LocalAiServiceStatus::Unhealthy;
                    service.detail = Some(error);
                }
                None => {
                    service.status = LocalAiServiceStatus::Unhealthy;
                    service.detail = Some(format!(
                        "LOCAL_AI_SERVICE_HEALTH_TASK_MISSING_RESULT: serviceId={}",
                        service.service_id
                    ));
                }
            }
            service.updated_at = now_iso_timestamp();
        }
    }

    save_state(&app, &state)?;
    let output = selected_indices
        .into_iter()
        .filter_map(|index| state.services.get(index).cloned())
        .collect::<Vec<_>>();
    Ok(output)
}

#[tauri::command]
pub async fn runtime_local_services_remove(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service_id = normalize_non_empty(payload.service_id.as_str())
            .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
        update_service_status(
            &app,
            service_id.as_str(),
            LocalAiServiceStatus::Removed,
            Some("service removed".to_string()),
        )
    })
    .await
    .map_err(|error| format!("LOCAL_AI_SERVICE_REMOVE_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn runtime_local_nodes_catalog_list(
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
    refresh_state_capability_matrix_with_provider_probe_async(&app, &mut state).await;
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
