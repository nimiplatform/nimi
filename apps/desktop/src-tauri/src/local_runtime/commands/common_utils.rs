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

fn extract_reason_code(error: &str) -> String {
    extract_local_ai_reason_code(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR)
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
                "targetId",
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
            &["targetId", "deviceProfile", "reasonCode", "error"],
        );
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
        return require_audit_payload_present_keys(event_type, payload, &["modelId", "capability"]);
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
        require_audit_payload_keys(event_type, payload, &["itemId", "reasonCode", "error"])?;
        return require_audit_payload_present_keys(event_type, payload, &["modelId", "capability"]);
    }
    Ok(())
}

#[cfg(test)]
mod audit_contract_tests {
    use super::{
        recommendation_feed_completed_payload, recommendation_resolve_completed_payload,
        recommendation_resolve_failed_payload, recommendation_resolve_invoked_payload,
        validate_audit_payload_contract,
    };
    use crate::local_runtime::audit::{
        EVENT_RECOMMENDATION_RESOLVE_COMPLETED, EVENT_RECOMMENDATION_RESOLVE_FAILED,
        EVENT_RECOMMENDATION_RESOLVE_INVOKED,
    };
    use crate::local_runtime::types::{
        LocalAiHostSupportClass, LocalAiRecommendationConfidence, LocalAiRecommendationDescriptor,
        LocalAiRecommendationFeedCacheState, LocalAiRecommendationSource,
        LocalAiRecommendationTier,
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
            validate_audit_payload_contract(EVENT_RECOMMENDATION_RESOLVE_COMPLETED, &payload)
                .is_ok()
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
