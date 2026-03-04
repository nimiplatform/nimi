#[tauri::command]
pub fn local_ai_models_list(app: AppHandle) -> Result<Vec<LocalAiModelRecord>, String> {
    list_models(&app)
}

#[tauri::command]
pub fn local_ai_audits_list(
    app: AppHandle,
    payload: Option<LocalAiAuditsListPayload>,
) -> Result<Vec<LocalAiAuditEvent>, String> {
    let state = load_state(&app)?;
    let limit = payload
        .as_ref()
        .and_then(|item| item.limit)
        .unwrap_or(100)
        .clamp(1, 4000);
    let event_types = normalize_optional_slice(&merge_event_type_filters(payload.as_ref()));
    let source = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.source.clone()));
    let modality = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.modality.clone()));
    let local_model_id = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.local_model_id.clone()));
    let mod_id = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.mod_id.clone()));
    let reason_code = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.reason_code.clone()));
    let from_timestamp_ms = payload
        .as_ref()
        .and_then(|item| item.time_range.as_ref())
        .and_then(|range| normalize_optional(range.from.clone()))
        .map(|value| {
            parse_iso_timestamp_millis(value.as_str()).ok_or(format!(
                "LOCAL_AI_AUDIT_TIME_RANGE_INVALID: from must be RFC3339 timestamp: {value}"
            ))
        })
        .transpose()?;
    let to_timestamp_ms = payload
        .as_ref()
        .and_then(|item| item.time_range.as_ref())
        .and_then(|range| normalize_optional(range.to.clone()))
        .map(|value| {
            parse_iso_timestamp_millis(value.as_str()).ok_or(format!(
                "LOCAL_AI_AUDIT_TIME_RANGE_INVALID: to must be RFC3339 timestamp: {value}"
            ))
        })
        .transpose()?;
    if let (Some(from_ms), Some(to_ms)) = (from_timestamp_ms, to_timestamp_ms) {
        if from_ms > to_ms {
            return Err("LOCAL_AI_AUDIT_TIME_RANGE_INVALID: from must be <= to".to_string());
        }
    }

    let mut filtered = state
        .audits
        .iter()
        .filter(|event| {
            if let Some(expected_types) = event_types.as_ref() {
                if !expected_types.contains(event.event_type.as_str()) {
                    return false;
                }
            }
            if let Some(expected_local_model_id) = local_model_id.as_ref() {
                if event.local_model_id.as_ref() != Some(expected_local_model_id) {
                    return false;
                }
            }
            if let Some(expected_mod_id) = mod_id.as_ref() {
                if payload_field_as_string(&event.payload, "modId").as_ref()
                    != Some(expected_mod_id)
                {
                    return false;
                }
            }
            if let Some(expected_source) = source.as_ref() {
                if payload_field_as_string(&event.payload, "source").as_ref()
                    != Some(expected_source)
                {
                    return false;
                }
            }
            if let Some(expected_modality) = modality.as_ref() {
                if payload_field_as_string(&event.payload, "modality").as_ref()
                    != Some(expected_modality)
                {
                    return false;
                }
            }
            if let Some(expected_reason_code) = reason_code.as_ref() {
                if payload_field_as_string(&event.payload, "reasonCode").as_ref()
                    != Some(expected_reason_code)
                {
                    return false;
                }
            }
            if from_timestamp_ms.is_some() || to_timestamp_ms.is_some() {
                let Some(event_timestamp_ms) =
                    parse_iso_timestamp_millis(event.occurred_at.as_str())
                else {
                    return false;
                };
                if let Some(from_ms) = from_timestamp_ms {
                    if event_timestamp_ms < from_ms {
                        return false;
                    }
                }
                if let Some(to_ms) = to_timestamp_ms {
                    if event_timestamp_ms > to_ms {
                        return false;
                    }
                }
            }
            true
        })
        .cloned()
        .collect::<Vec<_>>();

    // Keep the newest events first for diagnostics timeline.
    filtered.reverse();
    if filtered.len() > limit {
        filtered.truncate(limit);
    }
    Ok(filtered)
}

#[tauri::command]
pub fn local_ai_pick_manifest_path(app: AppHandle) -> Result<Option<String>, String> {
    let models_root = runtime_models_dir(&app)?;
    let selected = rfd::FileDialog::new()
        .set_directory(models_root)
        .set_title("Select model.manifest.json")
        .add_filter("Model Manifest", &["json"])
        .pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if file_name != "model.manifest.json" {
        return Err(
            "LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: 仅支持导入 model.manifest.json 清单文件"
                .to_string(),
        );
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

