#[tauri::command]
pub fn runtime_local_models_remove(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<LocalAiModelRecord, String> {
    remove_model(&app, &payload.local_model_id)
}

#[tauri::command]
pub fn runtime_local_models_start(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<LocalAiModelRecord, String> {
    start_model(&app, &payload.local_model_id)
}

#[tauri::command]
pub fn runtime_local_models_stop(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<LocalAiModelRecord, String> {
    stop_model(&app, &payload.local_model_id)
}

#[tauri::command]
pub fn runtime_local_models_health(
    app: AppHandle,
    payload: Option<LocalAiModelsHealthPayload>,
) -> Result<LocalAiModelsHealthResult, String> {
    let local_model_id = payload
        .and_then(|item| item.local_model_id)
        .filter(|value| !value.trim().is_empty());
    let output = health(&app, local_model_id.as_deref())?;
    Ok(LocalAiModelsHealthResult { models: output })
}

#[tauri::command]
pub fn runtime_local_append_inference_audit(
    app: AppHandle,
    payload: LocalAiInferenceAuditPayload,
) -> Result<(), String> {
    let event_type = validate_inference_event_type(payload.event_type.as_str())?;
    let source = validate_inference_source(payload.source.as_str())?;
    let modality = validate_inference_modality(payload.modality.as_str())?;
    let mod_id = payload.mod_id.trim();
    if mod_id.is_empty() {
        return Err("LOCAL_AI_AUDIT_MOD_ID_MISSING: modId is required".to_string());
    }
    let provider = payload.provider.trim();
    if provider.is_empty() {
        return Err("LOCAL_AI_AUDIT_PROVIDER_MISSING: provider is required".to_string());
    }

    let model = normalize_optional(payload.model);
    let local_model_id = normalize_optional(payload.local_model_id);
    let endpoint = normalize_optional(payload.endpoint);
    let reason_code = normalize_optional(payload.reason_code).map(|value| {
        normalize_local_ai_reason_code(value.as_str(), LOCAL_AI_PROVIDER_INTERNAL_ERROR)
    });
    let detail = normalize_optional(payload.detail);
    let adapter = normalize_optional(payload.adapter)
        .ok_or_else(|| "LOCAL_AI_AUDIT_ADAPTER_MISSING: adapter is required".to_string())?;

    let mut payload_object = serde_json::Map::<String, serde_json::Value>::new();
    payload_object.insert(
        "modId".to_string(),
        serde_json::Value::String(mod_id.to_string()),
    );
    payload_object.insert(
        "source".to_string(),
        serde_json::Value::String(source.to_string()),
    );
    payload_object.insert(
        "provider".to_string(),
        serde_json::Value::String(provider.to_string()),
    );
    payload_object.insert(
        "modality".to_string(),
        serde_json::Value::String(modality.to_string()),
    );
    payload_object.insert("adapter".to_string(), serde_json::Value::String(adapter));
    if let Some(value) = endpoint {
        payload_object.insert("endpoint".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = reason_code {
        payload_object.insert("reasonCode".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = detail {
        payload_object.insert("detail".to_string(), serde_json::Value::String(value));
    }
    if let Some(policy_gate) = payload.policy_gate {
        payload_object.insert("policyGate".to_string(), policy_gate);
    }
    if let Some(extra) = payload.extra {
        payload_object.insert("extra".to_string(), extra);
    }

    append_app_audit_event(
        &app,
        event_type,
        model.as_deref(),
        local_model_id.as_deref(),
        Some(serde_json::Value::Object(payload_object)),
    )
}

#[tauri::command]
pub fn runtime_local_append_runtime_audit(
    app: AppHandle,
    payload: LocalAiRuntimeAuditPayload,
) -> Result<(), String> {
    let event_type = validate_runtime_audit_event_type(payload.event_type.as_str())?;
    append_app_audit_event(
        &app,
        event_type,
        normalize_optional(payload.model_id).as_deref(),
        normalize_optional(payload.local_model_id).as_deref(),
        payload.payload,
    )
}

#[tauri::command]
pub fn runtime_local_models_reveal_in_folder(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<(), String> {
    let local_model_id = normalize_non_empty(payload.local_model_id.as_str())
        .ok_or_else(|| "LOCAL_AI_MODEL_ID_REQUIRED".to_string())?;
    let slug = slugify_local_model_id(local_model_id.as_str());
    let models_root = runtime_models_dir(&app)?;
    let model_dir = models_root.join(&slug);
    let target = if model_dir.exists() {
        &model_dir
    } else {
        &models_root
    };
    reveal_path_in_os(target)
}
