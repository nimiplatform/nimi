fn normalize_optional(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
}

fn json_fingerprint<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

fn extract_reason_code(error: &str) -> String {
    extract_local_ai_reason_code(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR)
}

#[derive(Debug, Clone)]
struct LocalAiDependencyApplyFailure {
    error: String,
    rollback_applied: bool,
}

impl LocalAiDependencyApplyFailure {
    fn without_rollback(error: String) -> Self {
        Self {
            error,
            rollback_applied: false,
        }
    }

    fn with_rollback(error: String) -> Self {
        Self {
            error,
            rollback_applied: true,
        }
    }
}

impl From<String> for LocalAiDependencyApplyFailure {
    fn from(value: String) -> Self {
        Self::without_rollback(value)
    }
}

fn service_artifact_preflight_port(service_identity: &str) -> Option<u16> {
    let artifact = find_service_artifact(service_identity)?;
    artifact.preflight.iter().find_map(|rule| {
        if !rule.check.trim().eq_ignore_ascii_case("port-available") {
            return None;
        }
        rule.params
            .as_ref()
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
    })
}

fn default_runtime_endpoint_for(service_identity: Option<&str>) -> String {
    let port = service_identity.and_then(service_artifact_preflight_port);
    if let Some(port) = port {
        return format!("http://127.0.0.1:{port}/v1");
    }
    DEFAULT_LOCAL_ENDPOINT.to_string()
}

fn extract_probe_model_ids(payload: &serde_json::Value) -> Vec<String> {
    let from_data = payload
        .get("data")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let from_catalog = payload
        .get("models")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let rows = if !from_data.is_empty() {
        from_data
    } else if !from_catalog.is_empty() {
        from_catalog
    } else {
        payload.as_array().cloned().unwrap_or_default()
    };
    rows.into_iter()
        .filter_map(|item| {
            if item
                .get("ready")
                .and_then(|value| value.as_bool())
                .is_some_and(|ready| !ready)
            {
                return None;
            }
            item.get("id").cloned().or(Some(item))
        })
        .filter_map(|value| value.as_str().map(|item| item.trim().to_string()))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
}

fn collect_probe_models_by_service(state: &LocalAiRuntimeState) -> BTreeMap<String, Vec<String>> {
    let mut output = BTreeMap::<String, Vec<String>>::new();
    for service in &state.services {
        if service.status == LocalAiServiceStatus::Removed {
            continue;
        }
        let endpoint = service
            .endpoint
            .as_deref()
            .map(|value| value.trim())
            .unwrap_or_default();
        if endpoint.is_empty() {
            continue;
        }
        if let Ok(payload) = probe_service_capability_models(service.service_id.as_str(), endpoint)
        {
            let ids = extract_probe_model_ids(&payload);
            if !ids.is_empty() {
                output.insert(service.service_id.clone(), ids);
            }
        }
    }
    output
}

fn refresh_state_capability_matrix_with_provider_probe(
    app: &AppHandle,
    state: &mut LocalAiRuntimeState,
) {
    let probe_models = collect_probe_models_by_service(state);
    let profile = collect_device_profile(app);
    refresh_state_capability_matrix_with_probe_and_device(state, &probe_models, Some(&profile));
}

fn derive_node_dependency_binding(
    dependency_service_id: Option<&str>,
    node_id: &str,
    declared_capability: Option<&str>,
) -> Result<(String, Option<String>), LocalAiDependencyApplyFailure> {
    let node_id = normalize_non_empty(node_id).ok_or_else(|| {
        LocalAiDependencyApplyFailure::without_rollback(
            "LOCAL_AI_DEPENDENCY_NODE_ID_MISSING: selected node dependency missing nodeId"
                .to_string(),
        )
    })?;
    let node_binding = resolve_node_host_service(node_id.as_str());
    let service_id = if let Some(explicit_service_id) =
        dependency_service_id.and_then(normalize_non_empty)
    {
        if let Some((artifact_service_id, _)) = node_binding.as_ref() {
            if !artifact_service_id.eq_ignore_ascii_case(explicit_service_id.as_str()) {
                return Err(LocalAiDependencyApplyFailure::without_rollback(format!(
                    "LOCAL_AI_NODE_SERVICE_MISMATCH: nodeId={} dependencyServiceId={} artifactServiceId={}",
                    node_id, explicit_service_id, artifact_service_id
                )));
            }
        }
        explicit_service_id
    } else if let Some((artifact_service_id, _)) = node_binding.as_ref() {
        artifact_service_id.clone()
    } else {
        return Err(LocalAiDependencyApplyFailure::without_rollback(format!(
            "LOCAL_AI_NODE_SERVICE_REQUIRED: nodeId={} requires serviceId or catalog mapping",
            node_id
        )));
    };

    let capability = declared_capability
        .and_then(normalize_non_empty)
        .or_else(|| {
            node_binding
                .as_ref()
                .map(|(_, capability)| capability.clone())
        });
    Ok((service_id, capability))
}

fn install_engine(request: &LocalAiInstallRequest) -> String {
    let candidate = request
        .engine
        .as_deref()
        .map(|value| value.trim())
        .unwrap_or_default();
    if candidate.is_empty() {
        "localai".to_string()
    } else {
        candidate.to_string()
    }
}

fn run_install_preflight_with<F>(
    request: &LocalAiInstallRequest,
    preflight: F,
) -> Result<(), String>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let engine = install_engine(request);
    preflight(engine.as_str())
}

fn run_install_preflight(app: &AppHandle, request: &LocalAiInstallRequest) -> Result<(), String> {
    let profile = collect_device_profile(app);
    run_install_preflight_with(request, |engine| {
        let decisions = preflight_dependency(
            None,
            &LocalAiDependencyKind::Model,
            None,
            Some(engine),
            None,
            None,
            &profile,
        )?;
        if let Some(failed) = decisions.iter().find(|item| !item.ok) {
            return Err(format!("{}: {}", failed.reason_code, failed.detail));
        }
        Ok(())
    })
}

fn normalize_optional_slice(
    values: &Option<Vec<String>>,
) -> Option<std::collections::HashSet<String>> {
    let normalized = values
        .as_ref()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| normalize_non_empty(item.as_str()))
                .collect::<std::collections::HashSet<_>>()
        })
        .unwrap_or_default();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn merge_event_type_filters(payload: Option<&LocalAiAuditsListPayload>) -> Option<Vec<String>> {
    let filters = payload?;
    let mut merged = Vec::<String>::new();
    if let Some(single) = normalize_optional(filters.event_type.clone()) {
        merged.push(single);
    }
    if let Some(items) = filters.event_types.as_ref() {
        merged.extend(items.iter().cloned());
    }
    if merged.is_empty() {
        return None;
    }
    Some(merged)
}

fn payload_field_as_string(payload: &Option<serde_json::Value>, key: &str) -> Option<String> {
    let root = payload.as_ref()?.as_object()?;
    let value = root.get(key)?;
    normalize_non_empty(value.as_str().unwrap_or_default())
}

fn parse_iso_timestamp_millis(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|datetime| datetime.timestamp_millis())
}

fn validate_inference_event_type(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == EVENT_INFERENCE_INVOKED
        || normalized == EVENT_INFERENCE_FAILED
        || normalized == EVENT_FALLBACK_TO_CLOUD
    {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_EVENT_TYPE_INVALID: unsupported event type: {normalized}"
    ))
}

fn validate_inference_source(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == "local" || normalized == "cloud" {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_SOURCE_INVALID: unsupported source: {normalized}"
    ))
}

fn validate_inference_modality(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == "chat"
        || normalized == "image"
        || normalized == "video"
        || normalized == "tts"
        || normalized == "stt"
        || normalized == "embedding"
    {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_MODALITY_INVALID: unsupported modality: {normalized}"
    ))
}

fn validate_runtime_audit_event_type(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_EVENT_TYPE_INVALID: unsupported runtime event type: {normalized}"
    ))
}

fn require_audit_payload_keys(
    event_type: &str,
    payload: &Option<serde_json::Value>,
    required_keys: &[&str],
) -> Result<(), String> {
    let root = payload
        .as_ref()
        .and_then(|value| value.as_object())
        .ok_or_else(|| {
            format!(
                "LOCAL_AI_AUDIT_PAYLOAD_REQUIRED: eventType={} payload object is required",
                event_type
            )
        })?;

    let missing = required_keys
        .iter()
        .filter_map(|key| {
            let value = root.get(*key)?;
            if value.is_null() {
                return Some((*key).to_string());
            }
            Some(String::new())
        })
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    let not_found = required_keys
        .iter()
        .filter(|key| !root.contains_key(**key))
        .map(|key| (*key).to_string())
        .collect::<Vec<_>>();
    let mut missing_all = Vec::<String>::new();
    missing_all.extend(not_found);
    missing_all.extend(missing);
    if !missing_all.is_empty() {
        return Err(format!(
            "LOCAL_AI_AUDIT_PAYLOAD_INVALID: eventType={} missingKeys={}",
            event_type,
            missing_all.join(",")
        ));
    }
    Ok(())
}

fn validate_audit_payload_contract(
    event_type: &str,
    payload: &Option<serde_json::Value>,
) -> Result<(), String> {
    if event_type == EVENT_DEPENDENCY_RESOLVE_INVOKED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &[
                "modId",
                "hasDependencies",
                "hasDeviceProfile",
                "deviceProfile",
            ],
        );
    }
    if event_type == EVENT_DEPENDENCY_RESOLVE_FAILED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "deviceProfile", "reasonCode", "error"],
        );
    }
    if event_type == EVENT_DEPENDENCY_APPLY_STARTED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "planId", "dependencyCount"],
        );
    }
    if event_type == EVENT_DEPENDENCY_APPLY_COMPLETED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &[
                "modId",
                "planId",
                "installedModelCount",
                "serviceCount",
                "capabilities",
                "stageResults",
                "preflightDecisionCount",
                "rollbackApplied",
                "warningCount",
            ],
        );
    }
    if event_type == EVENT_DEPENDENCY_APPLY_FAILED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "planId", "reasonCode", "rollbackApplied", "error"],
        );
    }
    if event_type == EVENT_SERVICE_INSTALL_STARTED {
        return require_audit_payload_keys(event_type, payload, &["serviceId"]);
    }
    if event_type == EVENT_SERVICE_INSTALL_COMPLETED {
        return require_audit_payload_keys(event_type, payload, &["serviceId"]);
    }
    if event_type == EVENT_SERVICE_INSTALL_FAILED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["serviceId", "reasonCode", "error"],
        );
    }
    if event_type == EVENT_NODE_CATALOG_LISTED {
        return require_audit_payload_keys(event_type, payload, &["count"]);
    }
    if event_type == EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["source", "capabilities", "localModelId"],
        );
    }
    if event_type == EVENT_INFERENCE_INVOKED
        || event_type == EVENT_INFERENCE_FAILED
        || event_type == EVENT_FALLBACK_TO_CLOUD
    {
        require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "source", "provider", "modality", "adapter"],
        )?;
        if event_type == EVENT_FALLBACK_TO_CLOUD {
            return require_audit_payload_keys(event_type, payload, &["reasonCode"]);
        }
        return Ok(());
    }
    Ok(())
}
