#[tauri::command]
pub fn runtime_local_models_import(
    app: AppHandle,
    payload: LocalAiModelsImportPayload,
) -> Result<LocalAiModelRecord, String> {
    let models_root = runtime_models_dir(&app)?;
    let path = validate_import_manifest_path(&payload.manifest_path, models_root.as_path())?;
    let endpoint_override = payload
        .endpoint
        .as_deref()
        .map(validate_loopback_endpoint)
        .transpose()?;

    match parse_and_validate_manifest(&path) {
        Ok(manifest) => {
            let saved = upsert_model(
                &app,
                manifest_to_model_record(
                    &manifest,
                    endpoint_override.as_deref(),
                    path.parent(),
                )?,
            )?;
            append_app_audit_event_non_blocking(
                &app,
                EVENT_MODEL_IMPORT_VALIDATED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                Some(serde_json::json!({
                    "manifestPath": payload.manifest_path,
                })),
            );
            Ok(saved)
        }
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_MODEL_IMPORT_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "manifestPath": payload.manifest_path,
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn runtime_local_models_adopt(
    app: AppHandle,
    payload: LocalAiModelRecord,
) -> Result<LocalAiModelRecord, String> {
    let local_model_id = payload.local_model_id.trim();
    if local_model_id.is_empty() {
        return Err("LOCAL_AI_MODEL_ID_REQUIRED: localModelId is required".to_string());
    }
    let model_id = payload.model_id.trim();
    if model_id.is_empty() {
        return Err("LOCAL_AI_MODEL_ID_REQUIRED: modelId is required".to_string());
    }

    let normalized_engine = normalize_local_engine(payload.engine.as_str(), &payload.capabilities);
    let endpoint = if payload.endpoint.trim().is_empty() {
        default_endpoint_for_engine(normalized_engine.as_str())
    } else {
        validate_loopback_endpoint(payload.endpoint.as_str())?
    };
    let logical_model_id = if payload.logical_model_id.trim().is_empty() {
        default_logical_model_id(model_id)
    } else {
        payload.logical_model_id.trim().to_string()
    };
    let artifact_roles = if payload.artifact_roles.is_empty() {
        default_artifact_roles_for_capabilities(&payload.capabilities)
    } else {
        payload.artifact_roles.clone()
    };
    let preferred_engine = payload
        .preferred_engine
        .clone()
        .or_else(|| Some(default_preferred_engine_for_capabilities(&payload.capabilities)));
    let fallback_engines = if payload.fallback_engines.is_empty() {
        default_fallback_engines_for_engine(normalized_engine.as_str(), &payload.capabilities)
    } else {
        payload.fallback_engines.clone()
    };

    let now = now_iso_timestamp();
    let entry = payload.entry.trim().to_string();
    let files = if payload.files.is_empty() {
        vec![entry.clone()]
    } else {
        payload
            .files
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
    };
    let tags = payload
        .tags
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let record = LocalAiModelRecord {
        local_model_id: local_model_id.to_string(),
        model_id: model_id.to_string(),
        logical_model_id,
        capabilities: payload.capabilities,
        engine: normalized_engine,
        entry: entry.clone(),
        files: if files.is_empty() { vec![entry] } else { files },
        license: payload.license.trim().to_string(),
        source: LocalAiModelSource {
            repo: payload.source.repo.trim().to_string(),
            revision: payload.source.revision.trim().to_string(),
        },
        integrity_mode: payload.integrity_mode.or_else(|| {
            Some(infer_model_integrity_mode_from_source(&LocalAiModelSource {
                repo: payload.source.repo.trim().to_string(),
                revision: payload.source.revision.trim().to_string(),
            }))
        }),
        hashes: payload.hashes,
        tags,
        known_total_size_bytes: payload.known_total_size_bytes.filter(|value| *value > 0),
        endpoint,
        status: payload.status,
        installed_at: if payload.installed_at.trim().is_empty() {
            now.clone()
        } else {
            payload.installed_at
        },
        updated_at: now,
        health_detail: payload
            .health_detail
            .and_then(|value| {
                let normalized = value.trim().to_string();
                if normalized.is_empty() {
                    None
                } else {
                    Some(normalized)
                }
            }),
        artifact_roles,
        preferred_engine,
        fallback_engines,
        engine_config: payload.engine_config,
        recommendation: payload.recommendation,
    };

    let saved = upsert_model(&app, record)?;
    append_app_audit_event_non_blocking(
        &app,
        EVENT_MODEL_IMPORT_VALIDATED,
        Some(saved.model_id.as_str()),
        Some(saved.local_model_id.as_str()),
        Some(serde_json::json!({
            "source": "go-runtime-adopt",
        })),
    );
    Ok(saved)
}

#[tauri::command]
pub fn runtime_local_pick_model_file(app: AppHandle) -> Result<Option<String>, String> {
    let start_dir =
        dirs::home_dir().unwrap_or_else(|| runtime_models_dir(&app).unwrap_or_default());
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select model file to import")
        .add_filter(
            "Model Files",
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

    // Write resolved manifest.json
    let normalized_engine = normalize_local_engine(engine, capabilities);
    let artifact_roles = default_artifact_roles_for_capabilities(capabilities);
    let preferred_engine = default_preferred_engine_for_capabilities(capabilities);
    let fallback_engines =
        default_fallback_engines_for_engine(normalized_engine.as_str(), capabilities);
    let manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "model_id": model_id,
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
        "endpoint": endpoint
    });
    let manifest_path = resolved_model_manifest_path(&models_root, logical_model_id.as_str());
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

    // Register model via upsert
    let record = LocalAiModelRecord {
        local_model_id: local_model_id.to_string(),
        model_id: model_id.to_string(),
        logical_model_id: default_logical_model_id(model_id),
        capabilities: capabilities.to_vec(),
        engine: normalized_engine.clone(),
        entry: file_name.to_string(),
        files: vec![file_name.to_string()],
        license: "unknown".to_string(),
        source: super::types::LocalAiModelSource {
            repo: format!("local-import/{}", slug),
            revision: "local".to_string(),
        },
        integrity_mode: Some(LocalAiIntegrityMode::LocalUnverified),
        hashes: std::collections::HashMap::new(),
        tags: Vec::new(),
        known_total_size_bytes: Some(file_size),
        endpoint: endpoint.to_string(),
        status: super::types::LocalAiModelStatus::Installed,
        installed_at: now_iso_timestamp(),
        updated_at: now_iso_timestamp(),
        health_detail: None,
        artifact_roles: default_artifact_roles_for_capabilities(capabilities),
        preferred_engine: Some(preferred_engine.clone()),
        fallback_engines,
        engine_config: None,
        recommendation: None,
    };
    match upsert_model(app, record) {
        Ok(saved) => {
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: saved.model_id.clone(),
                    local_model_id: Some(saved.local_model_id.clone()),
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
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
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
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
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
                    phase: "upsert".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some("LOCAL_AI_FILE_IMPORT_UPSERT_FAILED".to_string()),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
        }
    }
}
