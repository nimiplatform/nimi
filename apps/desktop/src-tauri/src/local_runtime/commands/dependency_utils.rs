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

fn profile_entry_matches_capability(
    entry: &LocalAiProfileEntryDescriptor,
    capability_filter: Option<&str>,
) -> bool {
    match capability_filter.and_then(normalize_non_empty) {
        Some(filter) => match normalize_non_empty(entry.capability.as_deref().unwrap_or_default()) {
            Some(entry_capability) => entry_capability.eq_ignore_ascii_case(&filter),
            None => true,
        },
        None => true,
    }
}

fn profile_entry_has_engine_slot(entry: &LocalAiProfileEntryDescriptor) -> bool {
    entry.engine_slot
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn profile_entry_is_asset(entry: &LocalAiProfileEntryDescriptor) -> bool {
    entry.kind.trim().eq_ignore_ascii_case("asset")
}

fn to_dependency_option_input_from_profile(
    entry: &LocalAiProfileEntryDescriptor,
) -> DependencyOptionInput {
    DependencyOptionInput {
        dependency_id: normalize_non_empty(entry.entry_id.as_str()).unwrap_or_default(),
        kind: normalize_dependency_kind(entry.kind.as_str()),
        capability: normalize_optional(entry.capability.clone()).map(|item| item.to_ascii_lowercase()),
        title: normalize_optional(entry.title.clone()),
        model_id: normalize_optional(entry.asset_id.clone()),
        repo: normalize_optional(entry.repo.clone()),
        engine: normalize_optional(entry.engine.clone()),
        service_id: normalize_optional(entry.service_id.clone()),
        node_id: normalize_optional(entry.node_id.clone()),
        workflow_id: None,
    }
}

fn bridge_profile_to_dependency_declaration(
    profile: &LocalAiProfileDescriptor,
    capability_filter: Option<&str>,
) -> (DependencyDeclarationInput, Vec<LocalAiProfileEntryDescriptor>) {
    let filtered_entries = profile
        .entries
        .iter()
        .filter(|entry| profile_entry_matches_capability(entry, capability_filter))
        .cloned()
        .collect::<Vec<_>>();
    let dependency_entries = filtered_entries
        .iter()
        .filter(|entry| !profile_entry_is_asset(entry) || !profile_entry_has_engine_slot(entry))
        .cloned()
        .collect::<Vec<_>>();
    let required = dependency_entries
        .iter()
        .filter(|entry| entry.required != Some(false))
        .map(to_dependency_option_input_from_profile)
        .collect::<Vec<_>>();
    let optional = dependency_entries
        .iter()
        .filter(|entry| entry.required == Some(false))
        .map(to_dependency_option_input_from_profile)
        .collect::<Vec<_>>();
    let asset_entries = filtered_entries
        .iter()
        .filter(|entry| profile_entry_is_asset(entry) && profile_entry_has_engine_slot(entry))
        .cloned()
        .collect::<Vec<_>>();

    (
        DependencyDeclarationInput {
            required,
            optional,
            alternatives: Vec::new(),
            preferred: std::collections::HashMap::new(),
        },
        asset_entries,
    )
}

fn next_profile_plan_id(mod_id: &str, profile_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!(
        "profile-plan-{}-{}-{now_ms}",
        slugify_local_model_id(mod_id),
        slugify_local_model_id(profile_id)
    )
}

async fn resolve_profile_plan(
    app: &AppHandle,
    payload: &LocalAiProfilesResolvePayload,
) -> Result<LocalAiProfileResolutionPlan, String> {
    let mod_id = normalize_non_empty(payload.mod_id.as_str())
        .ok_or_else(|| "LOCAL_AI_PROFILE_MOD_ID_REQUIRED: modId is required".to_string())?;
    let profile_id = normalize_non_empty(payload.profile.id.as_str())
        .ok_or_else(|| "LOCAL_AI_PROFILE_ID_REQUIRED: profile.id is required".to_string())?;
    let title = normalize_non_empty(payload.profile.title.as_str())
        .ok_or_else(|| "LOCAL_AI_PROFILE_TITLE_REQUIRED: profile.title is required".to_string())?;
    let capability_filter = normalize_capability_filter(payload.capability.clone());
    let device_profile = payload
        .device_profile
        .clone()
        .unwrap_or_else(|| collect_device_profile(app));
    let (declaration, asset_entries) =
        bridge_profile_to_dependency_declaration(&payload.profile, capability_filter.as_deref());
    let mut state = load_state(app)?;
    if state.capability_matrix.is_empty() {
        refresh_state_capability_matrix_with_provider_probe_async(app, &mut state).await;
        let _ = save_state(app, &state);
    }
    let resolved = resolve_dependencies(&DependencyResolveInput {
        capability_filter: capability_filter.clone(),
        device_profile: device_profile.clone(),
        capability_matrix: state.capability_matrix.clone(),
        declaration,
    })?;
    let plan_id = next_profile_plan_id(mod_id.as_str(), profile_id.as_str());
    let execution_plan = LocalAiDependencyResolutionPlan {
        plan_id: plan_id.clone(),
        mod_id: mod_id.clone(),
        capability: capability_filter,
        device_profile,
        dependencies: resolved.dependencies,
        selection_rationale: resolved.selection_rationale,
        preflight_decisions: resolved.preflight_decisions,
        warnings: resolved.warnings.clone(),
        reason_code: resolved.reason_code.clone(),
    };

    Ok(LocalAiProfileResolutionPlan {
        plan_id,
        mod_id,
        profile_id: profile_id.to_string(),
        title: title.to_string(),
        description: normalize_optional(payload.profile.description.clone()),
        recommended: payload.profile.recommended,
        consume_capabilities: payload.profile.consume_capabilities.clone(),
        requirements: payload.profile.requirements.clone(),
        execution_plan,
        asset_entries,
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

async fn start_service_runtime(
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

#[cfg(test)]
mod profile_tests {
    use super::{
        bridge_profile_to_dependency_declaration, next_profile_plan_id, LocalAiProfileDescriptor,
        LocalAiProfileEntryDescriptor,
    };

    fn profile_fixture() -> LocalAiProfileDescriptor {
        LocalAiProfileDescriptor {
            id: "image-default".to_string(),
            title: "Image Default".to_string(),
            description: Some("Balanced image stack".to_string()),
            recommended: true,
            consume_capabilities: vec!["image".to_string()],
            entries: vec![
                LocalAiProfileEntryDescriptor {
                    entry_id: "image-model".to_string(),
                    kind: "asset".to_string(),
                    title: Some("Primary image model".to_string()),
                    description: None,
                    capability: Some("image".to_string()),
                    required: Some(true),
                    preferred: Some(true),
                    asset_id: Some("black-forest-labs/flux-dev".to_string()),
                    asset_kind: Some("image".to_string()),
                    engine_slot: None,
                    repo: Some("black-forest-labs/flux-dev".to_string()),
                    service_id: None,
                    node_id: None,
                    engine: Some("media".to_string()),
                    template_id: None,
                    revision: None,
                    tags: vec!["recommended".to_string()],
                },
                LocalAiProfileEntryDescriptor {
                    entry_id: "passive-vae".to_string(),
                    kind: "asset".to_string(),
                    title: Some("Recommended VAE".to_string()),
                    description: None,
                    capability: Some("image".to_string()),
                    required: Some(true),
                    preferred: Some(true),
                    asset_id: Some("flux/vae".to_string()),
                    asset_kind: Some("vae".to_string()),
                    engine_slot: Some("vae_path".to_string()),
                    repo: None,
                    service_id: None,
                    node_id: None,
                    engine: Some("media".to_string()),
                    template_id: Some("verified/flux-vae".to_string()),
                    revision: None,
                    tags: vec![],
                },
                LocalAiProfileEntryDescriptor {
                    entry_id: "chat-helper".to_string(),
                    kind: "asset".to_string(),
                    title: Some("Chat helper".to_string()),
                    description: None,
                    capability: Some("chat".to_string()),
                    required: Some(false),
                    preferred: Some(false),
                    asset_id: Some("qwen/qwen3".to_string()),
                    asset_kind: Some("chat".to_string()),
                    engine_slot: None,
                    repo: Some("qwen/qwen3".to_string()),
                    service_id: None,
                    node_id: None,
                    engine: Some("llama".to_string()),
                    template_id: None,
                    revision: None,
                    tags: vec![],
                },
            ],
            requirements: None,
        }
    }

    #[test]
    fn bridge_profile_to_dependency_declaration_separates_runtime_and_passive_asset_entries() {
        let profile = profile_fixture();
        let (declaration, artifacts) =
            bridge_profile_to_dependency_declaration(&profile, Some("image"));

        assert_eq!(declaration.required.len(), 1);
        assert_eq!(declaration.required[0].dependency_id, "image-model");
        assert!(declaration.optional.is_empty());
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].entry_id, "passive-vae");
        assert_eq!(artifacts[0].kind, "asset");
        assert_eq!(artifacts[0].template_id.as_deref(), Some("verified/flux-vae"));
    }

    #[test]
    fn bridge_profile_to_dependency_declaration_keeps_optional_entries_without_capability_filter() {
        let profile = profile_fixture();
        let (declaration, artifacts) = bridge_profile_to_dependency_declaration(&profile, None);

        assert_eq!(declaration.required.len(), 1);
        assert_eq!(declaration.optional.len(), 1);
        assert_eq!(declaration.optional[0].dependency_id, "chat-helper");
        assert_eq!(artifacts.len(), 1);
    }

    #[test]
    fn next_profile_plan_id_includes_mod_and_profile_slug() {
        let plan_id = next_profile_plan_id("image/mod", "quality-best");
        assert!(plan_id.starts_with("profile-plan-image-mod-quality-best-"));
    }
}
