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
    if normalized == EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL
        || normalized == EVENT_RECOMMENDATION_RESOLVE_INVOKED
        || normalized == EVENT_RECOMMENDATION_RESOLVE_COMPLETED
        || normalized == EVENT_RECOMMENDATION_RESOLVE_FAILED
    {
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

fn require_audit_payload_present_keys(
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
        .filter(|key| !root.contains_key(**key))
        .map(|key| (*key).to_string())
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "LOCAL_AI_AUDIT_PAYLOAD_INVALID: eventType={} missingKeys={}",
        event_type,
        missing.join(",")
    ))
}

fn recommendation_resolve_invoked_payload(
    item_id: &str,
    model_id: Option<&str>,
    capability: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "itemId": item_id,
        "modelId": model_id,
        "capability": capability,
    })
}

fn recommendation_resolve_completed_payload(
    item_id: &str,
    model_id: Option<&str>,
    capability: Option<&str>,
    recommendation: &super::types::LocalAiRecommendationDescriptor,
) -> serde_json::Value {
    serde_json::json!({
        "itemId": item_id,
        "modelId": model_id,
        "capability": capability,
        "source": recommendation.source,
        "format": recommendation.format,
        "tier": recommendation.tier,
        "hostSupportClass": recommendation.host_support_class,
        "confidence": recommendation.confidence,
        "reasonCodes": recommendation.reason_codes,
    })
}

fn recommendation_resolve_failed_payload(
    item_id: &str,
    model_id: Option<&str>,
    capability: Option<&str>,
    error: &str,
) -> serde_json::Value {
    serde_json::json!({
        "itemId": item_id,
        "modelId": model_id,
        "capability": capability,
        "reasonCode": extract_reason_code(error),
        "error": error,
    })
}

fn recommendation_feed_item_id(capability: &str) -> String {
    format!(
        "recommend-feed:{}",
        normalize_non_empty(capability).unwrap_or_else(|| "chat".to_string())
    )
}

fn recommendation_feed_reason_codes(
    cache_state: &super::types::LocalAiRecommendationFeedCacheState,
    item_count: usize,
) -> Vec<String> {
    let mut codes = match cache_state {
        super::types::LocalAiRecommendationFeedCacheState::Fresh => {
            vec!["feed_cache_fresh".to_string()]
        }
        super::types::LocalAiRecommendationFeedCacheState::Stale => {
            vec!["feed_cache_stale".to_string()]
        }
        super::types::LocalAiRecommendationFeedCacheState::Empty => {
            vec!["feed_cache_empty".to_string()]
        }
    };
    if item_count == 0 {
        codes.push("feed_items_empty".to_string());
    } else {
        codes.push("feed_items_present".to_string());
    }
    codes
}

fn recommendation_feed_completed_payload(
    capability: &str,
    cache_state: &super::types::LocalAiRecommendationFeedCacheState,
    item_count: usize,
) -> serde_json::Value {
    let item_id = recommendation_feed_item_id(capability);
    serde_json::json!({
        "itemId": item_id,
        "modelId": serde_json::Value::Null,
        "capability": capability,
        "source": "model-index-feed",
        "format": serde_json::Value::Null,
        "tier": serde_json::Value::Null,
        "hostSupportClass": serde_json::Value::Null,
        "confidence": serde_json::Value::Null,
        "reasonCodes": recommendation_feed_reason_codes(cache_state, item_count),
        "itemCount": item_count,
        "cacheState": cache_state,
    })
}

fn append_recommendation_feed_resolve_invoked(app: &AppHandle, capability: &str) {
    let item_id = recommendation_feed_item_id(capability);
    append_recommendation_resolve_invoked(app, item_id.as_str(), None, Some(capability));
}

fn append_recommendation_feed_resolve_completed(
    app: &AppHandle,
    capability: &str,
    cache_state: &super::types::LocalAiRecommendationFeedCacheState,
    item_count: usize,
) {
    append_app_audit_event_non_blocking(
        app,
        EVENT_RECOMMENDATION_RESOLVE_COMPLETED,
        None,
        None,
        Some(recommendation_feed_completed_payload(
            capability,
            cache_state,
            item_count,
        )),
    );
}

fn append_recommendation_feed_resolve_failed(app: &AppHandle, capability: &str, error: &str) {
    let item_id = recommendation_feed_item_id(capability);
    append_recommendation_resolve_failed(app, item_id.as_str(), None, Some(capability), error);
}

fn append_recommendation_resolve_invoked(
    app: &AppHandle,
    item_id: &str,
    model_id: Option<&str>,
    capability: Option<&str>,
) {
    append_app_audit_event_non_blocking(
        app,
        EVENT_RECOMMENDATION_RESOLVE_INVOKED,
        model_id,
        None,
        Some(recommendation_resolve_invoked_payload(
            item_id,
            model_id,
            capability,
        )),
    );
}

fn append_recommendation_resolve_completed(
    app: &AppHandle,
    item_id: &str,
    model_id: Option<&str>,
    capability: Option<&str>,
    recommendation: &super::types::LocalAiRecommendationDescriptor,
) {
    append_app_audit_event_non_blocking(
        app,
        EVENT_RECOMMENDATION_RESOLVE_COMPLETED,
        None,
        None,
        Some(recommendation_resolve_completed_payload(
            item_id,
            model_id,
            capability,
            recommendation,
        )),
    );
}

fn append_recommendation_resolve_failed(
    app: &AppHandle,
    item_id: &str,
    model_id: Option<&str>,
    capability: Option<&str>,
    error: &str,
) {
    append_app_audit_event_non_blocking(
        app,
        EVENT_RECOMMENDATION_RESOLVE_FAILED,
        model_id,
        None,
        Some(recommendation_resolve_failed_payload(
            item_id,
            model_id,
            capability,
            error,
        )),
    );
}
