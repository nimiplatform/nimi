async fn run_dependency_apply(
    app: &AppHandle,
    plan: &LocalAiDependencyResolutionPlan,
) -> Result<LocalAiDependencyApplyResult, LocalAiDependencyApplyFailure> {
    let mut warnings = plan.warnings.clone();
    let mut capabilities = std::collections::BTreeSet::<String>::new();
    let mut progress = DependencyApplyProgress::new();
    let mut installed_asset_map = std::collections::BTreeMap::<String, LocalAiAssetRecord>::new();
    let mut service_map = std::collections::BTreeMap::<String, LocalAiServiceDescriptor>::new();
    let mut service_ids_to_start = std::collections::BTreeSet::<String>::new();
    let mut started_service_ids = Vec::<String>::new();

    let selected_dependencies = plan
        .dependencies
        .iter()
        .filter(|item| item.selected)
        .cloned()
        .collect::<Vec<_>>();

    let missing_required_dependencies = plan
        .dependencies
        .iter()
        .filter(|item| item.required && !item.selected)
        .collect::<Vec<_>>();
    if !missing_required_dependencies.is_empty() {
        let detail = missing_required_dependencies
            .iter()
            .map(|item| {
                let reason = item
                    .reason_code
                    .clone()
                    .unwrap_or_else(|| "LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED".to_string());
                format!("{}({reason})", item.dependency_id)
            })
            .collect::<Vec<_>>()
            .join(", ");
        let error = format!("LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED: {detail}");
        return Err(LocalAiDependencyApplyFailure::without_rollback(
            fail_progress(&mut progress, "preflight", error),
        ));
    }

    let preflight_decisions =
        run_preflight_all(selected_dependencies.as_slice(), &plan.device_profile).map_err(
            |error| {
                LocalAiDependencyApplyFailure::without_rollback(fail_progress(
                    &mut progress,
                    "preflight",
                    error,
                ))
            },
        )?;
    progress.preflight_decisions = preflight_decisions.clone();
    progress.push_stage_ok(
        "preflight",
        Some(format!(
            "{} dependencies checked",
            selected_dependencies.len()
        )),
    );

    for dependency in &selected_dependencies {
        if let Some(capability) = dependency.capability.as_ref() {
            capabilities.insert(capability.clone());
        }

        match dependency.kind.clone() {
            LocalAiDependencyKind::Model => {
                let model_id = dependency.model_id.clone().ok_or_else(|| {
                    LocalAiDependencyApplyFailure::without_rollback(
                        "LOCAL_AI_DEPENDENCY_MODEL_ID_MISSING: selected model dependency missing modelId"
                            .to_string(),
                    )
                })?;
                let repo = dependency.repo.clone().unwrap_or_else(|| model_id.clone());
                let default_endpoint = default_runtime_endpoint_for(dependency.engine.as_deref());
                let endpoint = validate_loopback_endpoint(default_endpoint.as_str())?;
                let install_request = LocalAiInstallRequest {
                    model_id: model_id.clone(),
                    repo,
                    revision: Some("main".to_string()),
                    capabilities: dependency.capability.clone().map(|value| vec![value]),
                    engine: dependency.engine.clone(),
                    entry: None,
                    files: None,
                    license: Some("unknown".to_string()),
                    hashes: None,
                    endpoint: Some(endpoint),
                    provider_hints: None,
                    engine_config: None,
                };
                let installed = execute_hf_install_blocking(
                    app,
                    install_request,
                    Some(serde_json::json!({
                        "installKind": "dependency-plan",
                        "dependencyId": dependency.dependency_id.clone(),
                        "planId": plan.plan_id,
                    })),
                )?;
                installed_asset_map.insert(installed.local_asset_id.clone(), installed);
            }
            LocalAiDependencyKind::Service => {
                let service_id = dependency.service_id.clone().ok_or_else(|| {
                    LocalAiDependencyApplyFailure::without_rollback(
                        "LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING: selected service dependency missing serviceId"
                            .to_string(),
                    )
                })?;
                let mut local_model_id_for_service: Option<String> = None;
                if let Some(model_id) = dependency.model_id.clone() {
                    let repo = dependency.repo.clone().unwrap_or_else(|| model_id.clone());
                    let default_endpoint = default_runtime_endpoint_for(Some(service_id.as_str()));
                    let endpoint = validate_loopback_endpoint(default_endpoint.as_str())?;
                    let install_request = LocalAiInstallRequest {
                        model_id: model_id.clone(),
                        repo,
                        revision: Some("main".to_string()),
                        capabilities: dependency.capability.clone().map(|value| vec![value]),
                        engine: dependency.engine.clone(),
                        entry: None,
                        files: None,
                        license: Some("unknown".to_string()),
                        hashes: None,
                        endpoint: Some(endpoint),
                        provider_hints: None,
                        engine_config: None,
                    };
                    let installed = execute_hf_install_blocking(
                        app,
                        install_request,
                        Some(serde_json::json!({
                            "installKind": "dependency-plan-service-model",
                            "dependencyId": dependency.dependency_id.clone(),
                            "planId": plan.plan_id,
                            "serviceId": service_id.clone(),
                        })),
                    )?;
                    local_model_id_for_service = Some(installed.local_asset_id.clone());
                    installed_asset_map.insert(installed.local_asset_id.clone(), installed);
                }
                let install_payload = LocalAiServicesInstallPayload {
                    service_id: service_id.clone(),
                    title: None,
                    engine: dependency.engine.clone(),
                    endpoint: None,
                    capabilities: dependency.capability.clone().map(|value| vec![value]),
                    local_model_id: local_model_id_for_service,
                };
                let installed =
                    build_service_descriptor_from_install_payload(app, &install_payload)?;
                let installed = upsert_service_descriptor(app, installed)?;
                service_ids_to_start.insert(installed.service_id.clone());
                let service_key = normalize_service_id(installed.service_id.as_str())
                    .unwrap_or_else(|| installed.service_id.to_ascii_lowercase());
                service_map.insert(service_key, installed.clone());
                if installed.status == LocalAiServiceStatus::Unhealthy {
                    warnings.push(format!(
                        "LOCAL_AI_SERVICE_UNHEALTHY: serviceId={}",
                        installed.service_id
                    ));
                }
            }
            LocalAiDependencyKind::Node => {
                let node_id = dependency
                    .node_id
                    .as_deref()
                    .unwrap_or_default()
                    .to_string();
                let (service_id, resolved_capability) = derive_node_dependency_binding(
                    dependency.service_id.as_deref(),
                    node_id.as_str(),
                    dependency.capability.as_deref(),
                )?;
                if let Some(capability) = resolved_capability.as_ref() {
                    capabilities.insert(capability.clone());
                }
                let service = ensure_dependency_service_descriptor(
                    app,
                    service_id.as_str(),
                    resolved_capability.as_deref(),
                    &mut service_map,
                    &mut service_ids_to_start,
                )?;
                if service.status == LocalAiServiceStatus::Unhealthy {
                    warnings.push(format!(
                        "LOCAL_AI_SERVICE_UNHEALTHY: serviceId={}",
                        service.service_id
                    ));
                }
            }
            LocalAiDependencyKind::Workflow => {
                let workflow_id = normalize_non_empty(
                    dependency.workflow_id.as_deref().unwrap_or_default(),
                )
                .ok_or_else(|| {
                    LocalAiDependencyApplyFailure::without_rollback(format!(
                        "LOCAL_AI_DEPENDENCY_WORKFLOW_ID_MISSING: dependencyId={} missing workflowId",
                        dependency.dependency_id
                    ))
                })?;
                warnings.push(format!(
                    "LOCAL_AI_WORKFLOW_DEPENDENCY_DECLARATIVE_ONLY: dependencyId={} workflowId={}",
                    dependency.dependency_id, workflow_id
                ));
            }
        }
    }

    let mut installed_assets = installed_asset_map.values().cloned().collect::<Vec<_>>();
    let mut services = service_map.values().cloned().collect::<Vec<_>>();
    progress.push_stage_ok(
        "install-artifacts",
        Some(format!(
            "installedAssets={}, services={}",
            installed_assets.len(),
            services.len()
        )),
    );

    let mut bootstrap_details = Vec::<String>::new();
    for service_id in &service_ids_to_start {
        match bootstrap_service_artifact(service_id.as_str()) {
            Ok(Some(detail)) => bootstrap_details.push(detail),
            Ok(None) => {}
            Err(error) => {
                return Err(LocalAiDependencyApplyFailure::without_rollback(
                    fail_progress(&mut progress, "bootstrap-services", error),
                ));
            }
        }
    }
    let bootstrap_summary = if bootstrap_details.is_empty() {
        format!("servicesPrepared={}", service_ids_to_start.len())
    } else {
        format!(
            "servicesPrepared={} details={}",
            service_ids_to_start.len(),
            bootstrap_details.join(" | ")
        )
    };
    progress.push_stage_ok("bootstrap-services", Some(bootstrap_summary));

    for service_id in &service_ids_to_start {
        let service_key = normalize_service_id(service_id.as_str())
            .unwrap_or_else(|| service_id.to_ascii_lowercase());
        let service_snapshot = service_map
            .get(service_key.as_str())
            .cloned()
            .or_else(|| {
                load_state(app).ok().and_then(|state| {
                    find_service_index(&state.services, service_id.as_str())
                        .map(|index| state.services[index].clone())
                })
            })
            .ok_or_else(|| {
                LocalAiDependencyApplyFailure::without_rollback(format!(
                    "LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"
                ))
            })?;
        let detail = match start_service_runtime(app, &service_snapshot).await {
            Ok(value) => value,
            Err(error) => {
                let rollback_applied = rollback_dependency_apply_runtime(app, &started_service_ids);
                return Err(fail_progress_with_rollback(
                    &mut progress,
                    "start",
                    error,
                    rollback_applied,
                ));
            }
        };
        let started_service = match update_service_status(
            app,
            service_id.as_str(),
            LocalAiServiceStatus::Active,
            Some(detail),
        ) {
            Ok(value) => value,
            Err(error) => {
                let rollback_applied = rollback_dependency_apply_runtime(app, &started_service_ids);
                return Err(fail_progress_with_rollback(
                    &mut progress,
                    "start",
                    error,
                    rollback_applied,
                ));
            }
        };
        started_service_ids.push(started_service.service_id.clone());
        service_map.insert(service_key, started_service);
    }

    progress.push_stage_ok(
        "start",
        Some(format!("servicesStarted={}", started_service_ids.len(),)),
    );

    for service_id in &started_service_ids {
        let service_key = normalize_service_id(service_id.as_str())
            .unwrap_or_else(|| service_id.to_ascii_lowercase());
        let service_snapshot = service_map
            .get(service_key.as_str())
            .cloned()
            .ok_or_else(|| {
                LocalAiDependencyApplyFailure::without_rollback(format!(
                    "LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"
                ))
            })?;
        let health_detail = match resolve_service_runtime_start_target(&service_snapshot) {
            ServiceRuntimeStartTarget::Endpoint(endpoint) => {
                let client = build_health_probe_client()
                    .map_err(LocalAiDependencyApplyFailure::without_rollback)?;
                probe_service_endpoint_health_async(
                    service_snapshot.service_id.as_str(),
                    endpoint.as_str(),
                    &client,
                )
                .await
            }
            ServiceRuntimeStartTarget::Missing => {
                Err(service_target_missing_reason(&service_snapshot))
            }
        };
        let health_detail = match health_detail {
            Ok(value) => value,
            Err(error) => {
                let rollback_applied = rollback_dependency_apply_runtime(app, &started_service_ids);
                return Err(fail_progress_with_rollback(
                    &mut progress,
                    "health",
                    error,
                    rollback_applied,
                ));
            }
        };
        if let Ok(updated_service) = update_service_status(
            app,
            service_id.as_str(),
            LocalAiServiceStatus::Active,
            Some(health_detail),
        ) {
            service_map.insert(service_key, updated_service);
        }
    }

    progress.push_stage_ok("health", Some("health checks passed".to_string()));

    installed_assets = installed_asset_map.values().cloned().collect::<Vec<_>>();
    services = service_map.values().cloned().collect::<Vec<_>>();
    installed_assets.sort_by(|left, right| left.local_asset_id.cmp(&right.local_asset_id));
    services.sort_by(|left, right| left.service_id.cmp(&right.service_id));

    let refreshed_matrix_entries = {
        let mut state = load_state(app).map_err(LocalAiDependencyApplyFailure::without_rollback)?;
        refresh_state_capability_matrix_with_provider_probe_async(app, &mut state).await;
        let count = state.capability_matrix.len();
        save_state(app, &state).map_err(LocalAiDependencyApplyFailure::without_rollback)?;
        count
    };
    mark_capability_matrix_refresh(&mut progress, refreshed_matrix_entries);

    let capabilities = if capabilities.is_empty() {
        vec!["chat".to_string()]
    } else {
        capabilities.into_iter().collect::<Vec<_>>()
    };
    progress.push_stage_ok(
        "auto-bind",
        Some(format!("capabilities={}", capabilities.join(","))),
    );
    progress.push_stage_ok(
        "apply-all-capabilities",
        Some("renderer applies capability state".to_string()),
    );

    Ok(LocalAiDependencyApplyResult {
        plan_id: plan.plan_id.clone(),
        mod_id: plan.mod_id.clone(),
        dependencies: plan.dependencies.clone(),
        installed_assets,
        services,
        capabilities,
        stage_results: progress.stage_results,
        preflight_decisions: progress.preflight_decisions,
        rollback_applied: false,
        warnings,
        reason_code: None,
    })
}
