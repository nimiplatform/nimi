const KNOWN_MODEL_EXTENSIONS: &[&str] = &["gguf", "safetensors", "bin", "pt", "onnx", "pth"];

fn is_model_file_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| KNOWN_MODEL_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn normalize_optional_capability(value: Option<&str>) -> Option<String> {
    let normalized = value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn default_orphan_engine(profile: &LocalAiDeviceProfile, capability: &str) -> &'static str {
    if matches!(capability, "image" | "video") {
        return "media";
    }
    if matches!(
        capability,
        "stt" | "tts" | "audio.transcribe" | "audio.synthesize"
    ) {
        return "speech";
    }
    let _ = profile;
    "llama"
}

fn recommendation_for_orphan_file(
    item: &OrphanModelFile,
    preference: Option<&LocalAiOrphanScanPreference>,
    profile: &LocalAiDeviceProfile,
) -> Option<super::types::LocalAiRecommendationDescriptor> {
    let capability = normalize_optional_capability(
        preference.and_then(|value| value.capability.as_deref()),
    )?;
    let engine = preference
        .and_then(|value| value.engine.as_deref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| default_orphan_engine(profile, capability.as_str()).to_string());
    let capabilities = vec![capability];
    build_recommendation_candidate(
        item.filename.as_str(),
        item.path.as_str(),
        item.filename.as_str(),
        &capabilities,
        engine.as_str(),
        Some(item.filename.as_str()),
        Some(item.size_bytes),
        Some(item.size_bytes),
        Vec::new(),
        &[],
    )
    .and_then(|candidate| build_catalog_recommendation(&candidate, profile))
}

fn scan_orphan_model_files(
    app: &AppHandle,
    payload: Option<LocalAiModelsScanOrphansPayload>,
) -> Result<Vec<OrphanModelFile>, String> {
    let models_root = runtime_models_dir(app)?;
    let state = load_state(app)?;
    let registered_paths = registered_model_paths(&models_root, &state);
    let profile = collect_device_profile(app);
    let preferences = payload.unwrap_or_default().preferences;
    scan_orphan_binary_candidates(
        &models_root,
        &registered_paths,
        "LOCAL_AI_ORPHAN_SCAN_READ_DIR_FAILED",
    )
    .map(|items| {
        items
            .into_iter()
            .map(|item| OrphanModelFile {
                recommendation: recommendation_for_orphan_file(
                    &OrphanModelFile {
                        filename: item.filename.clone(),
                        path: item.path.clone(),
                        size_bytes: item.size_bytes,
                        recommendation: None,
                    },
                    preferences.get(item.path.as_str()),
                    &profile,
                ),
                filename: item.filename,
                path: item.path,
                size_bytes: item.size_bytes,
            })
            .collect()
    })
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
                    engine_config: None,
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

    let logical_model_id = default_logical_model_id(model_id);
    let dest_dir = resolved_model_dir(&models_root, logical_model_id.as_str());
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
            engine_config: None,
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
    record.message = Some("writing resolved model manifest".to_string());
    persist_orphan_download_record_best_effort(app, &mut record);

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
        "hashes": {
            file_name: hash
        },
        "artifact_roles": artifact_roles,
        "preferred_engine": preferred_engine,
        "fallback_engines": fallback_engines,
        "endpoint": endpoint
    });
    let manifest_path = resolved_model_manifest_path(&models_root, logical_model_id.as_str());
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
        hashes,
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
    payload: Option<LocalAiModelsScanOrphansPayload>,
) -> Result<Vec<OrphanModelFile>, String> {
    append_recommendation_resolve_invoked(&app, "orphan-scan", None, None);
    match scan_orphan_model_files(&app, payload) {
        Ok(items) => {
            for item in &items {
                if let Some(recommendation) = item.recommendation.as_ref() {
                    append_recommendation_resolve_completed(
                        &app,
                        item.path.as_str(),
                        Some(item.filename.as_str()),
                        None,
                        recommendation,
                    );
                }
            }
            Ok(items)
        }
        Err(error) => {
            append_recommendation_resolve_failed(&app, "orphan-scan", None, None, error.as_str());
            Err(error)
        }
    }
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

    let profile = collect_device_profile(&app);
    let engine = payload
        .engine
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| default_orphan_engine(&profile, capabilities[0].as_str()).to_string());
    let default_endpoint = default_runtime_endpoint_for(Some(engine.as_str()));
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
    let bg_engine = engine.clone();
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
