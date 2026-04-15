fn build_health_probe_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .build()
        .map_err(|error| format!("LOCAL_AI_SERVICE_HEALTH_HTTP_CLIENT_FAILED: {error}"))
}

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
    default_endpoint_for_engine(service_identity.unwrap_or_default())
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

async fn collect_probe_models_by_service_async(
    state: &LocalAiRuntimeState,
) -> BTreeMap<String, Vec<String>> {
    let client = match build_health_probe_client() {
        Ok(c) => c,
        Err(_) => return BTreeMap::new(),
    };
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
        if let Ok(payload) =
            probe_service_capability_models_async(service.service_id.as_str(), endpoint, &client)
                .await
        {
            let ids = extract_probe_model_ids(&payload);
            if !ids.is_empty() {
                output.insert(service.service_id.clone(), ids);
            }
        }
    }
    output
}

async fn refresh_state_capability_matrix_with_provider_probe_async(
    app: &AppHandle,
    state: &mut LocalAiRuntimeState,
) {
    let probe_models = collect_probe_models_by_service_async(state).await;
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
        "llama".to_string()
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
include!("common_utils_audit.rs");

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
    if event_type == EVENT_RECOMMENDATION_RESOLVE_INVOKED {
        require_audit_payload_keys(event_type, payload, &["itemId"])?;
        return require_audit_payload_present_keys(
            event_type,
            payload,
            &["modelId", "capability"],
        );
    }
    if event_type == EVENT_RECOMMENDATION_RESOLVE_COMPLETED {
        let is_feed_scope = payload
            .as_ref()
            .and_then(|value| value.as_object())
            .and_then(|root| root.get("itemId"))
            .and_then(|value| value.as_str())
            .is_some_and(|item_id| item_id.starts_with("recommend-feed:"));
        if is_feed_scope {
            require_audit_payload_keys(event_type, payload, &["itemId", "source", "reasonCodes"])?;
            return require_audit_payload_present_keys(
                event_type,
                payload,
                &[
                    "modelId",
                    "capability",
                    "format",
                    "tier",
                    "hostSupportClass",
                    "confidence",
                ],
            );
        }
        require_audit_payload_keys(
            event_type,
            payload,
            &["itemId", "modelId", "source", "reasonCodes"],
        )?;
        return require_audit_payload_present_keys(
            event_type,
            payload,
            &[
                "capability",
                "format",
                "tier",
                "hostSupportClass",
                "confidence",
            ],
        );
    }
    if event_type == EVENT_RECOMMENDATION_RESOLVE_FAILED {
        require_audit_payload_keys(
            event_type,
            payload,
            &["itemId", "reasonCode", "error"],
        )?;
        return require_audit_payload_present_keys(
            event_type,
            payload,
            &["modelId", "capability"],
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

#[cfg(test)]
mod audit_contract_tests {
    use super::{
        recommendation_feed_completed_payload,
        recommendation_resolve_completed_payload, recommendation_resolve_failed_payload,
        recommendation_resolve_invoked_payload, validate_audit_payload_contract,
    };
    use crate::local_runtime::audit::{
        EVENT_RECOMMENDATION_RESOLVE_COMPLETED, EVENT_RECOMMENDATION_RESOLVE_FAILED,
        EVENT_RECOMMENDATION_RESOLVE_INVOKED,
    };
    use crate::local_runtime::types::{
        LocalAiHostSupportClass, LocalAiRecommendationConfidence, LocalAiRecommendationDescriptor,
        LocalAiRecommendationFeedCacheState, LocalAiRecommendationSource, LocalAiRecommendationTier,
    };

    fn recommendation_fixture() -> LocalAiRecommendationDescriptor {
        LocalAiRecommendationDescriptor {
            source: LocalAiRecommendationSource::MediaFit,
            format: None,
            tier: Some(LocalAiRecommendationTier::Runnable),
            host_support_class: Some(LocalAiHostSupportClass::AttachedOnly),
            confidence: Some(LocalAiRecommendationConfidence::Low),
            reason_codes: vec!["metadata_incomplete".to_string()],
            recommended_entry: None,
            fallback_entries: Vec::new(),
            suggested_assets: Vec::new(),
            suggested_notes: Vec::new(),
            baseline: None,
        }
    }

    #[test]
    fn recommendation_invoked_payload_satisfies_contract_with_null_fields() {
        let payload = Some(recommendation_resolve_invoked_payload(
            "catalog-search:image:*",
            None,
            None,
        ));
        assert!(
            validate_audit_payload_contract(EVENT_RECOMMENDATION_RESOLVE_INVOKED, &payload).is_ok()
        );
    }

    #[test]
    fn recommendation_completed_payload_satisfies_contract_with_nullable_format() {
        let payload = Some(recommendation_resolve_completed_payload(
            "hf:test/model#model.safetensors",
            Some("hf:test/model"),
            None,
            &recommendation_fixture(),
        ));
        assert!(
            validate_audit_payload_contract(EVENT_RECOMMENDATION_RESOLVE_COMPLETED, &payload).is_ok()
        );
    }

    #[test]
    fn recommendation_failed_payload_satisfies_contract_with_null_model_and_capability() {
        let payload = Some(recommendation_resolve_failed_payload(
            "orphan-scan",
            None,
            None,
            "LOCAL_AI_ORPHAN_SCAN_READ_DIR_FAILED: boom",
        ));
        assert!(
            validate_audit_payload_contract(EVENT_RECOMMENDATION_RESOLVE_FAILED, &payload).is_ok()
        );
    }

    #[test]
    fn recommendation_completed_contract_rejects_missing_required_reason_codes() {
        let payload = Some(serde_json::json!({
            "itemId": "hf:test/model",
            "modelId": "hf:test/model",
            "capability": "image",
            "source": "media-fit",
            "format": null,
            "tier": "runnable",
            "hostSupportClass": "attached_only",
            "confidence": "low"
        }));
        let result =
            validate_audit_payload_contract(EVENT_RECOMMENDATION_RESOLVE_COMPLETED, &payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("reasonCodes"));
    }

    #[test]
    fn recommendation_feed_completed_payload_satisfies_contract_with_aggregate_fields() {
        let payload = Some(recommendation_feed_completed_payload(
            "image",
            &LocalAiRecommendationFeedCacheState::Stale,
            12,
        ));
        assert!(
            validate_audit_payload_contract(EVENT_RECOMMENDATION_RESOLVE_COMPLETED, &payload)
                .is_ok()
        );
    }
}
