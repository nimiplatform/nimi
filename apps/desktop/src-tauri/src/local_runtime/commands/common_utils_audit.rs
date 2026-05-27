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

#[cfg(test)]
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
            item_id, model_id, capability,
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
            item_id, model_id, capability, error,
        )),
    );
}
