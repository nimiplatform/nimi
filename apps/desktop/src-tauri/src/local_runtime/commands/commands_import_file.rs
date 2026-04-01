fn symlink_target_display(source_path: &std::path::Path) -> Option<String> {
    source_path
        .canonicalize()
        .ok()
        .map(|target| target.display().to_string())
        .or_else(|| {
            std::fs::read_link(source_path)
                .ok()
                .map(|target| target.display().to_string())
        })
}

fn symlink_forbidden_error(source_path: &std::path::Path) -> String {
    let source = source_path.display().to_string();
    match symlink_target_display(source_path) {
        Some(target) => format!(
            "LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: Symbolic links are not supported for import. Import the real file path instead. Link source: {source}. Link target: {target}"
        ),
        None => format!(
            "LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: Symbolic links are not supported for import. Import the real file path instead. Link source: {source}"
        ),
    }
}

fn prepare_import_source_file(
    raw_path: &str,
) -> Result<(std::path::PathBuf, std::fs::File, u64), String> {
    let source_path = std::path::PathBuf::from(raw_path);
    let metadata = std::fs::symlink_metadata(&source_path).map_err(|_| {
        format!(
            "LOCAL_AI_FILE_IMPORT_NOT_FOUND: file does not exist or is not a file: {}",
            raw_path
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(symlink_forbidden_error(&source_path));
    }
    if !metadata.is_file() {
        return Err(format!(
            "LOCAL_AI_FILE_IMPORT_NOT_FOUND: file does not exist or is not a file: {}",
            raw_path
        ));
    }

    let canonical_path = source_path
        .canonicalize()
        .map_err(|error| format!("LOCAL_AI_FILE_IMPORT_CANONICALIZE_FAILED: {error}"))?;
    let file = std::fs::File::open(&canonical_path)
        .map_err(|error| format!("LOCAL_AI_FILE_IMPORT_READ_FAILED: cannot open source file: {error}"))?;
    let file_size = file
        .metadata()
        .map_err(|error| format!("LOCAL_AI_FILE_IMPORT_READ_FAILED: cannot stat source file: {error}"))?
        .len();
    Ok((canonical_path, file, file_size))
}

fn runtime_local_assets_import_file_impl(
    app: AppHandle,
    payload: LocalAiAssetsImportFilePayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let (canonical_source_path, source_file, file_size) =
        prepare_import_source_file(&payload.file_path)?;

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
        .unwrap_or("llama");
    let default_endpoint = default_runtime_endpoint_for(Some(engine));
    let endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(default_endpoint.as_str()),
    )?;

    // Derive model name from filename if not provided
    let file_name = canonical_source_path
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
            let stem = canonical_source_path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("model");
            stem.to_string()
        });

    let model_id = format!("local-import/{model_name}");
    let slug = slugify_local_model_id(&model_id);
    let local_model_id = format!("file:{slug}");
    let install_session_id = next_install_session_id(&model_id);

    // Emit initial progress
    emit_download_progress_event(
        &app,
        LocalAiDownloadProgressEvent {
            install_session_id: install_session_id.clone(),
            model_id: model_id.clone(),
            local_model_id: Some(local_model_id.clone()),
            session_kind: LocalAiTransferSessionKind::Import,
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
            source_file,
            &bg_file_name,
            file_size,
            &bg_capabilities,
            &bg_engine,
            &bg_endpoint,
        );
    });

    Ok(accepted)
}

#[tauri::command]
pub fn runtime_local_assets_import_file(
    app: AppHandle,
    payload: LocalAiAssetsImportFilePayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    runtime_local_assets_import_file_impl(app, payload)
}

#[cfg(all(test, unix))]
mod commands_import_file_tests {
    use super::*;

    #[test]
    fn prepare_import_source_file_rejects_symlink_sources() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let real_path = temp_dir.path().join("model.gguf");
        std::fs::write(&real_path, b"weights").expect("write file");
        let link_path = temp_dir.path().join("model-link.gguf");
        std::os::unix::fs::symlink(&real_path, &link_path).expect("symlink");

        let error = prepare_import_source_file(link_path.to_string_lossy().as_ref())
            .expect_err("symlink should be rejected");
        assert!(error.contains("LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN"));
        assert!(error.contains(real_path.to_string_lossy().as_ref()));
    }

    #[test]
    fn prepare_import_source_file_rejects_symlinked_directories() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let real_dir = temp_dir.path().join("models");
        std::fs::create_dir_all(&real_dir).expect("create dir");
        let link_path = temp_dir.path().join("models-link");
        std::os::unix::fs::symlink(&real_dir, &link_path).expect("symlink");

        let error = prepare_import_source_file(link_path.to_string_lossy().as_ref())
            .expect_err("symlinked directory should be rejected");
        assert!(error.contains("LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN"));
    }
}
