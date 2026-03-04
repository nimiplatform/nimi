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

fn normalize_dependency_kind(value: &str) -> LocalAiDependencyKind {
    match value.trim().to_ascii_lowercase().as_str() {
        "service" => LocalAiDependencyKind::Service,
        "node" => LocalAiDependencyKind::Node,
        "workflow" => LocalAiDependencyKind::Workflow,
        _ => LocalAiDependencyKind::Model,
    }
}

fn normalize_capability_filter(value: Option<String>) -> Option<String> {
    normalize_optional(value).map(|item| item.to_ascii_lowercase())
}

fn to_dependency_option_input(option: &LocalAiDependencyOptionPayload) -> DependencyOptionInput {
    DependencyOptionInput {
        dependency_id: normalize_non_empty(option.dependency_id.as_str()).unwrap_or_default(),
        kind: normalize_dependency_kind(option.kind.as_str()),
        capability: normalize_optional(option.capability.clone())
            .map(|item| item.to_ascii_lowercase()),
        title: normalize_optional(option.title.clone()),
        model_id: normalize_optional(option.model_id.clone()),
        repo: normalize_optional(option.repo.clone()),
        engine: normalize_optional(option.engine.clone()),
        service_id: normalize_optional(option.service_id.clone()),
        node_id: normalize_optional(option.node_id.clone()),
        workflow_id: normalize_optional(option.workflow_id.clone()),
    }
}

fn to_dependency_declaration_input(
    payload: Option<LocalAiDependenciesDeclarationPayload>,
) -> DependencyDeclarationInput {
    let payload = payload.unwrap_or(LocalAiDependenciesDeclarationPayload {
        required: None,
        optional: None,
        alternatives: None,
        preferred: None,
    });
    let required = payload
        .required
        .unwrap_or_default()
        .iter()
        .map(to_dependency_option_input)
        .collect::<Vec<_>>();
    let optional = payload
        .optional
        .unwrap_or_default()
        .iter()
        .map(to_dependency_option_input)
        .collect::<Vec<_>>();
    let alternatives = payload
        .alternatives
        .unwrap_or_default()
        .iter()
        .map(|item| DependencyAlternativeInput {
            alternative_id: item.alternative_id.clone(),
            preferred_dependency_id: normalize_optional(item.preferred_dependency_id.clone()),
            options: item
                .options
                .iter()
                .map(to_dependency_option_input)
                .collect::<Vec<_>>(),
        })
        .collect::<Vec<_>>();
    let preferred = payload
        .preferred
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_string()))
        .filter(|(key, value)| !key.is_empty() && !value.is_empty())
        .collect::<std::collections::HashMap<_, _>>();
    DependencyDeclarationInput {
        required,
        optional,
        alternatives,
        preferred,
    }
}

fn next_dependency_plan_id(mod_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("dep-plan-{}-{now_ms}", slugify_local_model_id(mod_id))
}

fn resolve_dependency_plan(
    app: &AppHandle,
    payload: &LocalAiDependenciesResolvePayload,
) -> Result<LocalAiDependencyResolutionPlan, String> {
    let mod_id = normalize_non_empty(payload.mod_id.as_str())
        .ok_or_else(|| "LOCAL_AI_DEPENDENCY_MOD_ID_REQUIRED: modId is required".to_string())?;
    let capability_filter = normalize_capability_filter(payload.capability.clone());
    let declaration = to_dependency_declaration_input(payload.dependencies.clone());
    let mut state = load_state(app)?;
    if state.capability_matrix.is_empty() {
        refresh_state_capability_matrix_with_provider_probe(app, &mut state);
        let _ = save_state(app, &state);
    }
    let resolved = resolve_dependencies(&DependencyResolveInput {
        capability_filter: capability_filter.clone(),
        device_profile: payload.device_profile.clone(),
        capability_matrix: state.capability_matrix.clone(),
        declaration,
    })?;

    Ok(LocalAiDependencyResolutionPlan {
        plan_id: next_dependency_plan_id(mod_id.as_str()),
        mod_id,
        capability: capability_filter,
        device_profile: payload.device_profile.clone(),
        dependencies: resolved.dependencies,
        selection_rationale: resolved.selection_rationale,
        preflight_decisions: resolved.preflight_decisions,
        warnings: resolved.warnings,
        reason_code: resolved.reason_code,
    })
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

fn run_service_install_preflight(
    app: &AppHandle,
    dependency_id: Option<&str>,
    service_id: &str,
    endpoint: Option<&str>,
) -> Result<(), String> {
    let profile = collect_device_profile(app);
    let decisions = preflight_service_artifact(dependency_id, service_id, endpoint, &profile)?;
    if let Some(failed) = decisions.iter().find(|item| !item.ok) {
        return Err(format!("{}: {}", failed.reason_code, failed.detail));
    }
    Ok(())
}

fn run_service_runtime_preflight(
    app: &AppHandle,
    dependency_id: Option<&str>,
    service: &LocalAiServiceDescriptor,
) -> Result<(), String> {
    let profile = collect_device_profile(app);
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

fn build_service_descriptor_from_install_payload(
    app: &AppHandle,
    payload: &LocalAiServicesInstallPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    run_service_install_preflight(app, None, service_id.as_str(), payload.endpoint.as_deref())?;
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

fn start_service_runtime(
    app: &AppHandle,
    service: &LocalAiServiceDescriptor,
) -> Result<String, String> {
    run_service_runtime_preflight(app, None, service)?;
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
            probe_service_endpoint_health(service.service_id.as_str(), endpoint.as_str())
        }
        ServiceRuntimeStartTarget::Missing => Err(service_target_missing_reason(service)),
    }
}

