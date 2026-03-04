#[tauri::command]
pub fn local_ai_models_import_file(
    app: AppHandle,
    payload: LocalAiModelsImportFilePayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    // Validate source file exists
    let source_path = std::path::PathBuf::from(&payload.file_path);
    if !source_path.is_file() {
        return Err(format!(
            "LOCAL_AI_FILE_IMPORT_NOT_FOUND: file does not exist or is not a file: {}",
            payload.file_path
        ));
    }

    // Validate capabilities
    let capabilities = normalize_and_validate_capabilities(&payload.capabilities)?;
    if capabilities.is_empty() {
        return Err(
            "LOCAL_AI_FILE_IMPORT_CAPABILITIES_EMPTY: at least one capability is required"
                .to_string(),
        );
    }

    // Validate endpoint
    let engine = payload
        .engine
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("localai");
    let default_endpoint = default_runtime_endpoint_for(Some(engine));
    let endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(default_endpoint.as_str()),
    )?;

    // Derive model name from filename if not provided
    let file_name = source_path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("model")
        .to_string();
    let model_name = payload
        .model_name
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .unwrap_or_else(|| {
            // Strip known extensions to derive a friendly name
            let stem = source_path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("model");
            stem.to_string()
        });

    let model_id = format!("local-import/{model_name}");
    let slug = slugify_local_model_id(&model_id);
    let local_model_id = format!("file:{slug}");
    let install_session_id = next_install_session_id(&model_id);

    // Get file size
    let file_size = std::fs::metadata(&source_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Emit initial progress
    emit_download_progress_event(
        &app,
        LocalAiDownloadProgressEvent {
            install_session_id: install_session_id.clone(),
            model_id: model_id.clone(),
            local_model_id: Some(local_model_id.clone()),
            phase: "copy".to_string(),
            bytes_received: 0,
            bytes_total: Some(file_size),
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: Some("starting file import".to_string()),
            state: LocalAiDownloadState::Running,
            reason_code: None,
            retryable: Some(true),
            done: false,
            success: false,
        },
    );

    let accepted = LocalAiInstallAcceptedResponse {
        install_session_id: install_session_id.clone(),
        model_id: model_id.clone(),
        local_model_id: local_model_id.clone(),
    };

    // Spawn copy on background thread
    let bg_app = app.clone();
    let bg_install_session_id = install_session_id;
    let bg_model_id = model_id;
    let bg_local_model_id = local_model_id;
    let bg_slug = slug;
    let bg_file_name = file_name;
    let bg_capabilities = capabilities;
    let bg_engine = engine.to_string();
    let bg_endpoint = endpoint;
    std::thread::spawn(move || {
        execute_file_import(
            &bg_app,
            &bg_install_session_id,
            &bg_model_id,
            &bg_local_model_id,
            &bg_slug,
            &source_path,
            &bg_file_name,
            file_size,
            &bg_capabilities,
            &bg_engine,
            &bg_endpoint,
        );
    });

    Ok(accepted)
}

