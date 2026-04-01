#[tauri::command]
pub fn runtime_local_pick_asset_file(app: AppHandle) -> Result<Option<String>, String> {
    let start_dir =
        dirs::home_dir().unwrap_or_else(|| runtime_models_dir(&app).unwrap_or_default());
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select asset file to import")
        .add_filter(
            "Asset Files",
            &["gguf", "safetensors", "bin", "pt", "onnx", "pth"],
        )
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|p| p.to_string_lossy().to_string()))
}

fn copy_file_with_progress<F>(
    mut reader: std::fs::File,
    dest: &std::path::Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64),
{
    let mut writer = std::fs::File::create(dest).map_err(|e| {
        format!("LOCAL_AI_FILE_IMPORT_WRITE_FAILED: cannot create target file: {e}")
    })?;
    let mut buffer = vec![0u8; 64 * 1024];
    let mut bytes_copied: u64 = 0;
    loop {
        let n = reader.read(&mut buffer).map_err(|e| {
            format!("LOCAL_AI_FILE_IMPORT_READ_FAILED: read error at byte {bytes_copied}: {e}")
        })?;
        if n == 0 {
            break;
        }
        writer.write_all(&buffer[..n]).map_err(|e| {
            format!("LOCAL_AI_FILE_IMPORT_WRITE_FAILED: write error at byte {bytes_copied}: {e}")
        })?;
        bytes_copied += n as u64;
        on_progress(bytes_copied);
    }
    writer
        .flush()
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_FLUSH_FAILED: {e}"))?;
    writer
        .sync_all()
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_SYNC_FAILED: {e}"))?;
    Ok(())
}

fn execute_file_import(
    app: &AppHandle,
    install_session_id: &str,
    model_id: &str,
    local_model_id: &str,
    slug: &str,
    source_file: std::fs::File,
    file_name: &str,
    file_size: u64,
    capabilities: &[String],
    engine: &str,
    endpoint: &str,
) {
    let models_root = match runtime_models_dir(app) {
        Ok(dir) => dir,
        Err(error) => {
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    session_kind: LocalAiTransferSessionKind::Import,
                    phase: "copy".to_string(),
                    bytes_received: 0,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error.clone()),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some(extract_reason_code(error.as_str())),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
            return;
        }
    };
    let logical_model_id = default_logical_model_id(model_id);
    let dest_dir = resolved_model_dir(&models_root, logical_model_id.as_str());
    if let Err(error) = std::fs::create_dir_all(&dest_dir) {
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                session_kind: LocalAiTransferSessionKind::Import,
                phase: "copy".to_string(),
                bytes_received: 0,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: None,
                eta_seconds: None,
                message: Some(format!("LOCAL_AI_FILE_IMPORT_DIR_FAILED: {error}")),
                state: LocalAiDownloadState::Failed,
                reason_code: Some("LOCAL_AI_FILE_IMPORT_DIR_FAILED".to_string()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        return;
    }
    let dest_file = dest_dir.join(file_name);

    // Copy file with progress reporting (throttled to ~200ms intervals).
    let mut last_emit_ms: u64 = 0;
    let copy_start = std::time::Instant::now();
    let copy_result = copy_file_with_progress(source_file, &dest_file, |bytes_copied| {
        let elapsed = copy_start.elapsed();
        let elapsed_ms = elapsed.as_millis() as u64;
        if elapsed_ms.saturating_sub(last_emit_ms) < 200 && bytes_copied < file_size {
            return;
        }
        last_emit_ms = elapsed_ms;
        let speed = if elapsed.as_secs_f64() > 0.0 {
            Some(bytes_copied as f64 / elapsed.as_secs_f64())
        } else {
            None
        };
        let eta = speed.and_then(|s| {
            if s > 0.0 {
                Some((file_size.saturating_sub(bytes_copied)) as f64 / s)
            } else {
                None
            }
        });
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                session_kind: LocalAiTransferSessionKind::Import,
                phase: "copy".to_string(),
                bytes_received: bytes_copied,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: speed,
                eta_seconds: eta,
                message: None,
                state: LocalAiDownloadState::Running,
                reason_code: None,
                retryable: Some(true),
                done: false,
                success: false,
            },
        );
    });

    if let Err(error) = copy_result {
        let _ = std::fs::remove_dir_all(&dest_dir);
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                session_kind: LocalAiTransferSessionKind::Import,
                phase: "copy".to_string(),
                bytes_received: 0,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: None,
                eta_seconds: None,
                message: Some(error),
                state: LocalAiDownloadState::Failed,
                reason_code: Some("LOCAL_AI_FILE_IMPORT_COPY_FAILED".to_string()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        return;
    }

    let normalized_engine = normalize_local_engine(engine, capabilities);
    let artifact_roles = default_artifact_roles_for_capabilities(capabilities);
    let preferred_engine = default_preferred_engine_for_capabilities(capabilities);
    let fallback_engines =
        default_fallback_engines_for_engine(normalized_engine.as_str(), capabilities);
    let record = LocalAiAssetRecord {
        local_asset_id: local_model_id.to_string(),
        asset_id: model_id.to_string(),
        kind: LocalAiAssetKind::Chat,
        logical_model_id: logical_model_id.clone(),
        capabilities: capabilities.to_vec(),
        engine: normalized_engine.clone(),
        entry: file_name.to_string(),
        files: vec![file_name.to_string()],
        license: "unknown".to_string(),
        source: super::types::LocalAiAssetSource {
            repo: format!("local-import/{}", slug),
            revision: "local".to_string(),
        },
        integrity_mode: Some(LocalAiIntegrityMode::LocalUnverified),
        hashes: std::collections::HashMap::new(),
        tags: Vec::new(),
        known_total_size_bytes: Some(file_size),
        endpoint: endpoint.to_string(),
        status: super::types::LocalAiAssetStatus::Installed,
        installed_at: now_iso_timestamp(),
        updated_at: now_iso_timestamp(),
        health_detail: None,
        artifact_roles: artifact_roles.clone(),
        preferred_engine: Some(preferred_engine.clone()),
        fallback_engines: fallback_engines.clone(),
        engine_config: None,
        recommendation: None,
        metadata: None,
    };
    let manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "asset_id": model_id,
        "kind": "chat",
        "logical_model_id": logical_model_id,
        "capabilities": capabilities,
        "engine": normalized_engine,
        "entry": file_name,
        "files": [file_name],
        "license": "unknown",
        "source": {
            "repo": format!("local-import/{}", slug),
            "revision": "local"
        },
        "integrity_mode": "local_unverified",
        "hashes": {},
        "artifact_roles": artifact_roles,
        "preferred_engine": preferred_engine,
        "fallback_engines": fallback_engines,
        "endpoint": endpoint,
        "metadata": null
    });
    let manifest_path = runtime_managed_asset_manifest_path(&models_root, &record);
    let manifest_json = match serde_json::to_string_pretty(&manifest) {
        Ok(json) => json,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    session_kind: LocalAiTransferSessionKind::Import,
                    phase: "manifest".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(format!(
                        "LOCAL_AI_FILE_IMPORT_MANIFEST_SERIALIZE_FAILED: {error}"
                    )),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some("LOCAL_AI_FILE_IMPORT_MANIFEST_SERIALIZE_FAILED".to_string()),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
            return;
        }
    };
    if let Err(error) = std::fs::write(&manifest_path, manifest_json) {
        let _ = std::fs::remove_dir_all(&dest_dir);
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                session_kind: LocalAiTransferSessionKind::Import,
                phase: "manifest".to_string(),
                bytes_received: file_size,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: None,
                eta_seconds: None,
                message: Some(format!(
                    "LOCAL_AI_FILE_IMPORT_MANIFEST_WRITE_FAILED: {error}"
                )),
                state: LocalAiDownloadState::Failed,
                reason_code: Some("LOCAL_AI_FILE_IMPORT_MANIFEST_WRITE_FAILED".to_string()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        return;
    }

    match runtime_import_manifest_via_runtime(manifest_path.as_path(), Some(endpoint), None) {
        Ok(saved) => {
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: saved.asset_id.clone(),
                    local_model_id: Some(saved.local_asset_id.clone()),
                    session_kind: LocalAiTransferSessionKind::Import,
                    phase: "register".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: Some(0.0),
                    message: Some("file import completed".to_string()),
                    state: LocalAiDownloadState::Completed,
                    reason_code: None,
                    retryable: Some(false),
                    done: true,
                    success: true,
                },
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_FILE_IMPORT_STARTED,
                Some(saved.asset_id.as_str()),
                Some(saved.local_asset_id.as_str()),
                Some(serde_json::json!({
                    "source": "local-file",
                    "engine": engine,
                    "capabilities": capabilities,
                    "integrityMode": "local_unverified",
                })),
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_IMPORT_VALIDATED,
                Some(saved.asset_id.as_str()),
                Some(saved.local_asset_id.as_str()),
                Some(serde_json::json!({
                    "manifestPath": manifest_path.to_string_lossy().to_string(),
                })),
            );
        }
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    session_kind: LocalAiTransferSessionKind::Import,
                    phase: "register".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some("LOCAL_AI_FILE_IMPORT_RUNTIME_IMPORT_FAILED".to_string()),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
        }
    }
}
