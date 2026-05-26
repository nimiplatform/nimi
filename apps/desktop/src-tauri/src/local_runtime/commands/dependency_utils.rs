fn append_app_audit_event(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    validate_audit_payload_contract(event_type, &payload)?;
    let mut state = load_state(app)?;
    append_audit_event(&mut state, event_type, model_id, local_model_id, payload);
    save_state(app, &state)
}

fn append_app_audit_event_non_blocking(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    if let Err(error) = append_app_audit_event(app, event_type, model_id, local_model_id, payload) {
        eprintln!("LOCAL_AI_AUDIT_WRITE_FAILED: {error}");
    }
}

fn next_install_session_id(model_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("install-{}-{now_ms}", slugify_local_model_id(model_id))
}

fn emit_download_progress_event(app: &AppHandle, event: LocalAiDownloadProgressEvent) {
    if let Err(error) = app.emit(LOCAL_AI_DOWNLOAD_PROGRESS_EVENT, &event) {
        eprintln!("LOCAL_AI_DOWNLOAD_PROGRESS_EMIT_FAILED: {error}");
    }
}

fn next_profile_apply_session_id(plan_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("profile-apply-{}-{now_ms}", slugify_local_model_id(plan_id))
}

fn normalize_service_id(value: &str) -> Option<String> {
    normalize_non_empty(value).map(|item| item.to_ascii_lowercase())
}

fn find_service_index(services: &[LocalAiServiceDescriptor], service_id: &str) -> Option<usize> {
    let normalized = normalize_service_id(service_id)?;
    services.iter().position(|item| {
        normalize_service_id(item.service_id.as_str()).as_deref() == Some(normalized.as_str())
    })
}

async fn run_service_install_preflight(
    app: &AppHandle,
    dependency_id: Option<&str>,
    service_id: &str,
    endpoint: Option<&str>,
) -> Result<(), String> {
    let profile = collect_device_profile_async(app).await;
    let decisions = preflight_service_artifact(dependency_id, service_id, endpoint, &profile)?;
    if let Some(failed) = decisions.iter().find(|item| !item.ok) {
        return Err(format!("{}: {}", failed.reason_code, failed.detail));
    }
    Ok(())
}

async fn run_service_runtime_preflight(
    app: &AppHandle,
    dependency_id: Option<&str>,
    service: &LocalAiServiceDescriptor,
) -> Result<(), String> {
    let profile = collect_device_profile_async(app).await;
    let decisions = preflight_service_artifact(
        dependency_id,
        service.service_id.as_str(),
        service.endpoint.as_deref(),
        &profile,
    )?;
    if let Some(failed) = decisions.iter().find(|item| !item.ok) {
        return Err(format!("{}: {}", failed.reason_code, failed.detail));
    }
    Ok(())
}

async fn build_service_descriptor_from_install_payload(
    app: &AppHandle,
    payload: &LocalAiServicesInstallPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    run_service_install_preflight(app, None, service_id.as_str(), payload.endpoint.as_deref())
        .await?;
    let capabilities = payload
        .capabilities
        .clone()
        .unwrap_or_default()
        .iter()
        .filter_map(|item| normalize_non_empty(item.as_str()))
        .collect::<Vec<_>>();
    build_service_descriptor(
        service_id.as_str(),
        payload.title.as_deref(),
        payload.endpoint.as_deref(),
        capabilities.as_slice(),
        payload.local_model_id.as_deref(),
    )
}

fn upsert_service_descriptor(
    app: &AppHandle,
    mut descriptor: LocalAiServiceDescriptor,
) -> Result<LocalAiServiceDescriptor, String> {
    let mut state = load_state(app)?;
    let now = now_iso_timestamp();
    descriptor.updated_at = now.clone();
    if descriptor.installed_at.trim().is_empty() {
        descriptor.installed_at = now.clone();
    }
    if let Some(index) = find_service_index(&state.services, descriptor.service_id.as_str()) {
        let existing = state.services[index].clone();
        if descriptor.installed_at.trim().is_empty() {
            descriptor.installed_at = existing.installed_at;
        }
        if descriptor
            .endpoint
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            descriptor.endpoint = existing.endpoint.clone();
        }
        if descriptor
            .local_model_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            descriptor.local_model_id = existing.local_model_id.clone();
        }
        if descriptor.capabilities.is_empty() {
            descriptor.capabilities = existing.capabilities.clone();
        }
        state.services[index] = descriptor.clone();
    } else {
        state.services.push(descriptor.clone());
    }
    save_state(app, &state)?;
    Ok(descriptor)
}

fn update_service_status(
    app: &AppHandle,
    service_id: &str,
    status: LocalAiServiceStatus,
    detail: Option<String>,
) -> Result<LocalAiServiceDescriptor, String> {
    let mut state = load_state(app)?;
    let index = find_service_index(&state.services, service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"))?;
    let service = &mut state.services[index];
    service.status = status;
    service.updated_at = now_iso_timestamp();
    service.detail = detail.filter(|value| !value.trim().is_empty());
    let snapshot = service.clone();
    save_state(app, &state)?;
    Ok(snapshot)
}

enum ServiceRuntimeStartTarget {
    Endpoint(String),
    Missing,
}

fn service_artifact_type_label(artifact_type: Option<&LocalAiServiceArtifactType>) -> &'static str {
    match artifact_type {
        Some(LocalAiServiceArtifactType::PythonEnv) => "python-env",
        Some(LocalAiServiceArtifactType::Binary) => "binary",
        Some(LocalAiServiceArtifactType::AttachedEndpoint) => "attached-endpoint",
        None => "unknown",
    }
}

fn resolve_service_runtime_start_target(
    service: &LocalAiServiceDescriptor,
) -> ServiceRuntimeStartTarget {
    if let Some(endpoint) = normalize_non_empty(service.endpoint.as_deref().unwrap_or_default()) {
        return ServiceRuntimeStartTarget::Endpoint(endpoint);
    }
    ServiceRuntimeStartTarget::Missing
}

fn service_target_missing_reason(service: &LocalAiServiceDescriptor) -> String {
    format!(
        "LOCAL_AI_SERVICE_TARGET_MISSING: serviceId={} artifactType={} requires endpoint",
        service.service_id,
        service_artifact_type_label(service.artifact_type.as_ref())
    )
}

async fn start_service_runtime(
    app: &AppHandle,
    service: &LocalAiServiceDescriptor,
) -> Result<String, String> {
    run_service_runtime_preflight(app, None, service).await?;
    let _ = bootstrap_service_artifact(service.service_id.as_str())?;
    match resolve_service_runtime_start_target(service) {
        ServiceRuntimeStartTarget::Endpoint(endpoint) => {
            if is_managed_service(service.service_id.as_str()) {
                if let Some(detail) =
                    start_managed_service(service.service_id.as_str(), endpoint.as_str())?
                {
                    return Ok(detail);
                }
            }
            let client = build_health_probe_client()?;
            probe_service_endpoint_health_async(
                service.service_id.as_str(),
                endpoint.as_str(),
                &client,
            )
            .await
        }
        ServiceRuntimeStartTarget::Missing => Err(service_target_missing_reason(service)),
    }
}
