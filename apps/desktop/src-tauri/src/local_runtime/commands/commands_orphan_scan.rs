const KNOWN_MODEL_EXTENSIONS: &[&str] = &["gguf", "safetensors", "bin", "pt", "onnx", "pth"];

fn is_model_file_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| KNOWN_MODEL_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn scan_orphan_model_files(app: &AppHandle) -> Result<Vec<OrphanModelFile>, String> {
    let models_root = runtime_models_dir(app)?;
    let state = load_state(app)?;

    // Collect all registered model file paths (absolute) for cross-check
    let registered_paths: std::collections::HashSet<String> = state
        .models
        .iter()
        .filter_map(|m| {
            let slug = slugify_local_model_id(&m.model_id);
            let entry = &m.entry;
            if entry.is_empty() {
                return None;
            }
            Some(
                models_root
                    .join(&slug)
                    .join(entry)
                    .to_string_lossy()
                    .to_string(),
            )
        })
        .collect();

    let mut orphans = Vec::<OrphanModelFile>::new();

    let entries = std::fs::read_dir(&models_root).map_err(|e| {
        format!("LOCAL_AI_ORPHAN_SCAN_READ_DIR_FAILED: cannot read models directory: {e}")
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();

        if path.is_file() && is_model_file_extension(&path) {
            // Loose file directly in models root — definitely an orphan
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            orphans.push(OrphanModelFile {
                filename,
                path: path.to_string_lossy().to_string(),
                size_bytes,
            });
        } else if path.is_dir() {
            // Check subdirectories: if a subdir has model files but NO model.manifest.json,
            // those model files are orphans
            let manifest_path = path.join("model.manifest.json");
            if manifest_path.exists() {
                // This subdirectory is properly scaffolded, skip
                continue;
            }
            // Scan for model files inside this unmanifested subdir
            let sub_entries = match std::fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for sub_entry in sub_entries {
                let sub_entry = match sub_entry {
                    Ok(entry) => entry,
                    Err(_) => continue,
                };
                let sub_path = sub_entry.path();
                if sub_path.is_file() && is_model_file_extension(&sub_path) {
                    let abs_path_str = sub_path.to_string_lossy().to_string();
                    if registered_paths.contains(&abs_path_str) {
                        continue;
                    }
                    let filename = sub_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let size_bytes =
                        std::fs::metadata(&sub_path).map(|m| m.len()).unwrap_or(0);
                    orphans.push(OrphanModelFile {
                        filename,
                        path: abs_path_str,
                        size_bytes,
                    });
                }
            }
        }
    }

    // Sort by filename for consistent ordering
    orphans.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(orphans)
}

fn to_orphan_download_event(
    record: &super::types::LocalAiDownloadSessionRecord,
) -> LocalAiDownloadProgressEvent {
    let done = matches!(
        record.state,
        LocalAiDownloadState::Completed
            | LocalAiDownloadState::Failed
            | LocalAiDownloadState::Cancelled
    );
    LocalAiDownloadProgressEvent {
        install_session_id: record.install_session_id.clone(),
        model_id: record.model_id.clone(),
        local_model_id: Some(record.local_model_id.clone()),
        phase: record.phase.clone(),
        bytes_received: record.bytes_received,
        bytes_total: record.bytes_total,
        speed_bytes_per_sec: record.speed_bytes_per_sec,
        eta_seconds: record.eta_seconds,
        message: record.message.clone(),
        state: record.state.clone(),
        reason_code: record.reason_code.clone(),
        retryable: Some(record.retryable),
        done,
        success: record.state == LocalAiDownloadState::Completed,
    }
}

fn persist_orphan_download_record(
    app: &AppHandle,
    record: &mut super::types::LocalAiDownloadSessionRecord,
) -> Result<(), String> {
    record.updated_at = now_iso_timestamp();
    let snapshot = record.clone();
    let mut state = load_state(app)?;
    let existing = state
        .downloads
        .iter()
        .position(|item| item.install_session_id == snapshot.install_session_id);
    match existing {
        Some(index) => state.downloads[index] = snapshot.clone(),
        None => state.downloads.push(snapshot.clone()),
    }
    save_state(app, &state)?;
    emit_download_progress_event(app, to_orphan_download_event(&snapshot));
    Ok(())
}

fn persist_orphan_download_record_best_effort(
    app: &AppHandle,
    record: &mut super::types::LocalAiDownloadSessionRecord,
) {
    if let Err(error) = persist_orphan_download_record(app, record) {
        eprintln!("LOCAL_AI_ORPHAN_SCAFFOLD_PROGRESS_SAVE_FAILED: {error}");
        emit_download_progress_event(app, to_orphan_download_event(record));
    }
}

fn hash_existing_file_with_progress<F>(
    path: &std::path::Path,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(u64),
{
    let mut reader = std::fs::File::open(path)
        .map_err(|e| format!("LOCAL_AI_ORPHAN_SCAFFOLD_HASH_OPEN_FAILED: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut bytes_read = 0u64;
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("LOCAL_AI_ORPHAN_SCAFFOLD_HASH_READ_FAILED: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        bytes_read += n as u64;
        on_progress(bytes_read);
    }
    let digest = hasher.finalize();
    Ok(format!("sha256:{digest:x}"))
}

fn finalize_orphan_scaffold_failure(
    app: &AppHandle,
    record: &mut super::types::LocalAiDownloadSessionRecord,
    source_path: &std::path::Path,
    error: String,
) {
    let reason_code = extract_reason_code(error.as_str());
    record.state = LocalAiDownloadState::Failed;
    record.retryable = false;
    record.reason_code = Some(reason_code);
    record.message = Some(error.clone());
    record.speed_bytes_per_sec = None;
    record.eta_seconds = None;
    persist_orphan_download_record_best_effort(app, record);
    append_app_audit_event_non_blocking(
        app,
        EVENT_MODEL_IMPORT_FAILED,
        Some(record.model_id.as_str()),
        Some(record.local_model_id.as_str()),
        Some(serde_json::json!({
            "source": "orphan-scaffold",
            "sourcePath": source_path.to_string_lossy().to_string(),
            "error": error,
        })),
    );
}

fn execute_orphan_scaffold_import(
    app: &AppHandle,
    install_session_id: &str,
    model_id: &str,
    local_model_id: &str,
    slug: &str,
    source_path: &std::path::Path,
    file_name: &str,
    file_size: u64,
    capabilities: &[String],
    engine: &str,
    endpoint: &str,
) {
    let models_root = match runtime_models_dir(app) {
        Ok(dir) => dir,
        Err(error) => {
            let mut record = super::types::LocalAiDownloadSessionRecord {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: local_model_id.to_string(),
                request: LocalAiInstallRequest {
                    model_id: model_id.to_string(),
                    repo: format!("local-import/{slug}"),
                    revision: Some("local".to_string()),
                    capabilities: Some(capabilities.to_vec()),
                    engine: Some(engine.to_string()),
                    entry: Some(file_name.to_string()),
                    files: Some(vec![file_name.to_string()]),
                    license: Some("unknown".to_string()),
                    hashes: None,
                    endpoint: Some(endpoint.to_string()),
                    provider_hints: None,
                },
                install_metadata: Some(serde_json::json!({
                    "installKind": "orphan-scaffold",
                    "sourcePath": source_path.to_string_lossy().to_string(),
                })),
                phase: "copy".to_string(),
                state: LocalAiDownloadState::Failed,
                bytes_received: 0,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: None,
                eta_seconds: None,
                message: Some(error.clone()),
                reason_code: Some(extract_reason_code(error.as_str())),
                retryable: false,
                created_at: now_iso_timestamp(),
                updated_at: now_iso_timestamp(),
            };
            persist_orphan_download_record_best_effort(app, &mut record);
            return;
        }
    };

    let dest_dir = models_root.join(slug);
    let dest_file = dest_dir.join(file_name);
    let mut record = super::types::LocalAiDownloadSessionRecord {
        install_session_id: install_session_id.to_string(),
        model_id: model_id.to_string(),
        local_model_id: local_model_id.to_string(),
        request: LocalAiInstallRequest {
            model_id: model_id.to_string(),
            repo: format!("local-import/{slug}"),
            revision: Some("local".to_string()),
            capabilities: Some(capabilities.to_vec()),
            engine: Some(engine.to_string()),
            entry: Some(file_name.to_string()),
            files: Some(vec![file_name.to_string()]),
            license: Some("unknown".to_string()),
            hashes: None,
            endpoint: Some(endpoint.to_string()),
            provider_hints: None,
        },
        install_metadata: Some(serde_json::json!({
            "installKind": "orphan-scaffold",
            "sourcePath": source_path.to_string_lossy().to_string(),
        })),
        phase: "copy".to_string(),
        state: LocalAiDownloadState::Running,
        bytes_received: 0,
        bytes_total: Some(file_size),
        speed_bytes_per_sec: None,
        eta_seconds: None,
        message: Some("starting orphan import".to_string()),
        reason_code: None,
        retryable: true,
        created_at: now_iso_timestamp(),
        updated_at: now_iso_timestamp(),
    };

    if let Err(error) = persist_orphan_download_record(app, &mut record) {
        finalize_orphan_scaffold_failure(app, &mut record, source_path, error);
        return;
    }

    if let Err(error) = std::fs::create_dir_all(&dest_dir) {
        finalize_orphan_scaffold_failure(
            app,
            &mut record,
            source_path,
            format!("LOCAL_AI_ORPHAN_SCAFFOLD_DIR_FAILED: cannot create directory: {error}"),
        );
        return;
    }

    let source_parent = source_path.parent();
    let needs_move = source_parent
        .map(|parent| parent != dest_dir)
        .unwrap_or(true);
    let mut copied_from_source = false;

    let hash = if !needs_move {
        record.phase = "verify".to_string();
        record.bytes_received = 0;
        record.speed_bytes_per_sec = None;
        record.eta_seconds = None;
        record.message = Some("verifying imported file".to_string());
        persist_orphan_download_record_best_effort(app, &mut record);
        let mut last_emit_ms = 0u64;
        let verify_start = std::time::Instant::now();
        match hash_existing_file_with_progress(&dest_file, |bytes_read| {
            let elapsed = verify_start.elapsed();
            let elapsed_ms = elapsed.as_millis() as u64;
            if elapsed_ms.saturating_sub(last_emit_ms) < 200 && bytes_read < file_size {
                return;
            }
            last_emit_ms = elapsed_ms;
            record.bytes_received = bytes_read;
            record.speed_bytes_per_sec = if elapsed.as_secs_f64() > 0.0 {
                Some(bytes_read as f64 / elapsed.as_secs_f64())
            } else {
                None
            };
            record.eta_seconds = record.speed_bytes_per_sec.and_then(|speed| {
                if speed > 0.0 {
                    Some((file_size.saturating_sub(bytes_read)) as f64 / speed)
                } else {
                    None
                }
            });
            persist_orphan_download_record_best_effort(app, &mut record);
        }) {
            Ok(hash) => hash,
            Err(error) => {
                finalize_orphan_scaffold_failure(app, &mut record, source_path, error);
                return;
            }
        }
    } else if std::fs::rename(source_path, &dest_file).is_ok() {
        record.phase = "verify".to_string();
        record.bytes_received = 0;
        record.speed_bytes_per_sec = None;
        record.eta_seconds = None;
        record.message = Some("verifying moved file".to_string());
        persist_orphan_download_record_best_effort(app, &mut record);
        let mut last_emit_ms = 0u64;
        let verify_start = std::time::Instant::now();
        match hash_existing_file_with_progress(&dest_file, |bytes_read| {
            let elapsed = verify_start.elapsed();
            let elapsed_ms = elapsed.as_millis() as u64;
            if elapsed_ms.saturating_sub(last_emit_ms) < 200 && bytes_read < file_size {
                return;
            }
            last_emit_ms = elapsed_ms;
            record.bytes_received = bytes_read;
            record.speed_bytes_per_sec = if elapsed.as_secs_f64() > 0.0 {
                Some(bytes_read as f64 / elapsed.as_secs_f64())
            } else {
                None
            };
            record.eta_seconds = record.speed_bytes_per_sec.and_then(|speed| {
                if speed > 0.0 {
                    Some((file_size.saturating_sub(bytes_read)) as f64 / speed)
                } else {
                    None
                }
            });
            persist_orphan_download_record_best_effort(app, &mut record);
        }) {
            Ok(hash) => hash,
            Err(error) => {
                finalize_orphan_scaffold_failure(app, &mut record, source_path, error);
                return;
            }
        }
    } else {
        copied_from_source = true;
        let mut last_emit_ms = 0u64;
        let copy_start = std::time::Instant::now();
        match copy_and_hash_file(source_path, &dest_file, file_size, |bytes_copied| {
            let elapsed = copy_start.elapsed();
            let elapsed_ms = elapsed.as_millis() as u64;
            if elapsed_ms.saturating_sub(last_emit_ms) < 200 && bytes_copied < file_size {
                return;
            }
            last_emit_ms = elapsed_ms;
            record.bytes_received = bytes_copied;
            record.speed_bytes_per_sec = if elapsed.as_secs_f64() > 0.0 {
                Some(bytes_copied as f64 / elapsed.as_secs_f64())
            } else {
                None
            };
            record.eta_seconds = record.speed_bytes_per_sec.and_then(|speed| {
                if speed > 0.0 {
                    Some((file_size.saturating_sub(bytes_copied)) as f64 / speed)
                } else {
                    None
                }
            });
            record.message = Some("copying orphan file".to_string());
            persist_orphan_download_record_best_effort(app, &mut record);
        }) {
            Ok(hash) => hash,
            Err(error) => {
                finalize_orphan_scaffold_failure(
                    app,
                    &mut record,
                    source_path,
                    format!("LOCAL_AI_ORPHAN_SCAFFOLD_MOVE_FAILED: cannot move file: {error}"),
                );
                return;
            }
        }
    };

    record.phase = "manifest".to_string();
    record.bytes_received = file_size;
    record.speed_bytes_per_sec = None;
    record.eta_seconds = None;
    record.message = Some("writing model manifest".to_string());
    persist_orphan_download_record_best_effort(app, &mut record);

    let manifest = serde_json::json!({
        "model_id": model_id,
        "capabilities": capabilities,
        "engine": engine,
        "entry": file_name,
        "license": "unknown",
        "source": {
            "repo": format!("local-import/{}", slug),
            "revision": "local"
        },
        "hashes": {
            file_name: hash
        },
        "endpoint": endpoint
    });
    let manifest_path = dest_dir.join("model.manifest.json");
    let manifest_json = match serde_json::to_string_pretty(&manifest) {
        Ok(json) => json,
        Err(error) => {
            finalize_orphan_scaffold_failure(
                app,
                &mut record,
                source_path,
                format!("LOCAL_AI_ORPHAN_SCAFFOLD_MANIFEST_SERIALIZE_FAILED: {error}"),
            );
            return;
        }
    };
    if let Err(error) = std::fs::write(&manifest_path, manifest_json) {
        finalize_orphan_scaffold_failure(
            app,
            &mut record,
            source_path,
            format!("LOCAL_AI_ORPHAN_SCAFFOLD_MANIFEST_WRITE_FAILED: {error}"),
        );
        return;
    }

    record.phase = "upsert".to_string();
    record.message = Some("registering imported model".to_string());
    persist_orphan_download_record_best_effort(app, &mut record);

    let hashes = std::collections::HashMap::from([(file_name.to_string(), hash.clone())]);
    let model_record = LocalAiModelRecord {
        local_model_id: local_model_id.to_string(),
        model_id: model_id.to_string(),
        capabilities: capabilities.to_vec(),
        engine: engine.to_string(),
        entry: file_name.to_string(),
        license: "unknown".to_string(),
        source: super::types::LocalAiModelSource {
            repo: format!("local-import/{}", slug),
            revision: "local".to_string(),
        },
        hashes,
        endpoint: endpoint.to_string(),
        status: super::types::LocalAiModelStatus::Installed,
        installed_at: now_iso_timestamp(),
        updated_at: now_iso_timestamp(),
        health_detail: None,
    };

    let saved = match upsert_model(app, model_record) {
        Ok(saved) => saved,
        Err(error) => {
            finalize_orphan_scaffold_failure(app, &mut record, source_path, error);
            return;
        }
    };

    if copied_from_source {
        let _ = std::fs::remove_file(source_path);
    }

    record.state = LocalAiDownloadState::Completed;
    record.retryable = false;
    record.reason_code = None;
    record.phase = "verify".to_string();
    record.bytes_received = file_size;
    record.speed_bytes_per_sec = None;
    record.eta_seconds = Some(0.0);
    record.message = Some("orphan model import completed".to_string());
    persist_orphan_download_record_best_effort(app, &mut record);

    append_app_audit_event_non_blocking(
        app,
        EVENT_MODEL_FILE_IMPORT_STARTED,
        Some(saved.model_id.as_str()),
        Some(saved.local_model_id.as_str()),
        Some(serde_json::json!({
            "source": "orphan-scaffold",
            "engine": engine,
            "capabilities": capabilities,
            "hash": hash,
        })),
    );
    append_app_audit_event_non_blocking(
        app,
        EVENT_MODEL_IMPORT_VALIDATED,
        Some(saved.model_id.as_str()),
        Some(saved.local_model_id.as_str()),
        Some(serde_json::json!({
            "manifestPath": manifest_path.to_string_lossy().to_string(),
            "source": "orphan-scaffold",
        })),
    );
}

#[tauri::command]
pub fn runtime_local_models_scan_orphans(
    app: AppHandle,
) -> Result<Vec<OrphanModelFile>, String> {
    scan_orphan_model_files(&app)
}

#[tauri::command]
pub fn runtime_local_models_scaffold_orphan(
    app: AppHandle,
    payload: LocalAiScaffoldOrphanPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let source_path = std::path::PathBuf::from(&payload.path);
    if !source_path.is_file() {
        return Err(format!(
            "LOCAL_AI_ORPHAN_SCAFFOLD_NOT_FOUND: file does not exist: {}",
            source_path.display()
        ));
    }

    // Validate capabilities
    let capabilities = normalize_and_validate_capabilities(&payload.capabilities)?;
    if capabilities.is_empty() {
        return Err(
            "LOCAL_AI_ORPHAN_SCAFFOLD_CAPABILITIES_EMPTY: at least one capability is required"
                .to_string(),
        );
    }

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

    let file_name = source_path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("model")
        .to_string();
    let model_name = source_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("model")
        .to_string();
    let model_id = format!("local-import/{model_name}");
    let slug = slugify_local_model_id(&model_id);
    let local_model_id = format!("file:{slug}");
    let install_session_id = next_install_session_id(&model_id);
    let file_size = std::fs::metadata(&source_path)
        .map(|meta| meta.len())
        .unwrap_or(0);

    let accepted = LocalAiInstallAcceptedResponse {
        install_session_id: install_session_id.clone(),
        model_id: model_id.clone(),
        local_model_id: local_model_id.clone(),
    };

    let bg_app = app.clone();
    let bg_source_path = source_path.clone();
    let bg_capabilities = capabilities.clone();
    let bg_engine = engine.to_string();
    let bg_endpoint = endpoint.clone();
    std::thread::spawn(move || {
        execute_orphan_scaffold_import(
            &bg_app,
            &install_session_id,
            &model_id,
            &local_model_id,
            &slug,
            &bg_source_path,
            &file_name,
            file_size,
            &bg_capabilities,
            &bg_engine,
            bg_endpoint.as_str(),
        );
    });

    Ok(accepted)
}
