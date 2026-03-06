fn ensure_dependency_service_descriptor(
    app: &AppHandle,
    service_id: &str,
    capability: Option<&str>,
    service_map: &mut std::collections::BTreeMap<String, LocalAiServiceDescriptor>,
    service_ids_to_start: &mut std::collections::BTreeSet<String>,
) -> Result<LocalAiServiceDescriptor, LocalAiDependencyApplyFailure> {
    let normalized_service_id = normalize_service_id(service_id).ok_or_else(|| {
        LocalAiDependencyApplyFailure::without_rollback(
            "LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING: node dependency missing serviceId".to_string(),
        )
    })?;
    if let Some(existing) = service_map.get(normalized_service_id.as_str()) {
        return Ok(existing.clone());
    }

    let state = load_state(app)?;
    if let Some(index) = find_service_index(&state.services, service_id) {
        let mut existing = state.services[index].clone();
        let before_endpoint = existing.endpoint.clone();
        let before_engine = existing.engine.clone();
        let before_artifact_type = existing.artifact_type.clone();
        normalize_service_descriptor(&mut existing);
        if existing.endpoint != before_endpoint
            || existing.engine != before_engine
            || existing.artifact_type != before_artifact_type
        {
            existing = upsert_service_descriptor(app, existing)
                .map_err(LocalAiDependencyApplyFailure::without_rollback)?;
        }
        if existing.status == LocalAiServiceStatus::Removed {
            return Err(LocalAiDependencyApplyFailure::without_rollback(format!(
                "LOCAL_AI_SERVICE_REMOVED: serviceId={service_id}"
            )));
        }
        if existing.status != LocalAiServiceStatus::Active {
            service_ids_to_start.insert(existing.service_id.clone());
        }
        service_map.insert(normalized_service_id, existing.clone());
        return Ok(existing);
    }

    let capability_values = capability
        .and_then(normalize_non_empty)
        .map(|value| vec![value]);
    let install_payload = LocalAiServicesInstallPayload {
        service_id: service_id.to_string(),
        title: None,
        engine: None,
        endpoint: None,
        capabilities: capability_values,
        local_model_id: None,
    };
    let installed = build_service_descriptor_from_install_payload(app, &install_payload)?;
    let installed = upsert_service_descriptor(app, installed)?;
    service_ids_to_start.insert(installed.service_id.clone());
    service_map.insert(normalized_service_id, installed.clone());
    Ok(installed)
}

fn rollback_dependency_apply_runtime(app: &AppHandle, started_service_ids: &[String]) -> bool {
    let mut rollback_applied = false;

    for service_id in started_service_ids.iter().rev() {
        if let Ok(Some(_)) = stop_managed_service(service_id.as_str()) {
            rollback_applied = true;
        }
        if update_service_status(
            app,
            service_id.as_str(),
            LocalAiServiceStatus::Installed,
            Some("service rolled back after dependency apply failure".to_string()),
        )
        .is_ok()
        {
            rollback_applied = true;
        }
    }

    rollback_applied
}

fn fail_progress_with_rollback(
    progress: &mut DependencyApplyProgress,
    stage: &str,
    error: String,
    rollback_applied: bool,
) -> LocalAiDependencyApplyFailure {
    let reason_code = extract_reason_code(error.as_str());
    progress.push_stage_failed(stage, reason_code, error.clone());
    if rollback_applied {
        progress.push_stage_ok(
            "rollback",
            Some("runtime rolled back to pre-apply status".to_string()),
        );
        return LocalAiDependencyApplyFailure::with_rollback(error);
    }
    LocalAiDependencyApplyFailure::without_rollback(error)
}

