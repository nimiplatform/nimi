fn artifact_kind_matches_filter(
    artifact: &LocalAiArtifactRecord,
    kind_filter: Option<&str>,
) -> bool {
    match kind_filter
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(filter) => serde_json::to_string(&artifact.kind)
            .unwrap_or_default()
            .trim_matches('"')
            .eq_ignore_ascii_case(filter.as_str()),
        None => true,
    }
}

fn artifact_status_matches_filter(
    artifact: &LocalAiArtifactRecord,
    status_filter: Option<&str>,
) -> bool {
    match status_filter
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(filter) => serde_json::to_string(&artifact.status)
            .unwrap_or_default()
            .trim_matches('"')
            .eq_ignore_ascii_case(filter.as_str()),
        None => true,
    }
}

fn verify_downloaded_artifact_hashes(
    descriptor: &LocalAiVerifiedArtifactDescriptor,
    artifact_dir: &std::path::Path,
) -> Result<(), String> {
    for file in &descriptor.files {
        let expected = descriptor
            .hashes
            .get(file)
            .map(|value| value.trim().trim_start_matches("sha256:").to_ascii_lowercase())
            .unwrap_or_default();
        if expected.is_empty() {
            continue;
        }
        let actual = sha256_hex_for_local_runtime(&artifact_dir.join(file))?;
        if actual != expected {
            return Err(format!(
                "LOCAL_AI_ARTIFACT_HASH_MISMATCH: file={file}, expected={expected}, actual={actual}"
            ));
        }
    }
    Ok(())
}

fn install_verified_artifact_descriptor(
    app: &AppHandle,
    descriptor: &LocalAiVerifiedArtifactDescriptor,
) -> Result<LocalAiArtifactRecord, String> {
    if let Some(existing) = find_installed_artifact_by_identity(
        app,
        descriptor.artifact_id.as_str(),
        &descriptor.kind,
        descriptor.engine.as_str(),
    )? {
        return Ok(existing);
    }

    let models_root = runtime_models_dir(app)?;
    let artifact_dir = artifact_dir(models_root.as_path(), descriptor.artifact_id.as_str());
    if artifact_dir.exists() {
        std::fs::remove_dir_all(&artifact_dir).map_err(|error| {
            format!(
                "LOCAL_AI_ARTIFACT_DIR_REMOVE_FAILED: failed to clear existing dir ({}): {error}",
                artifact_dir.display()
            )
        })?;
    }
    std::fs::create_dir_all(&artifact_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ARTIFACT_DIR_CREATE_FAILED: failed to create artifact dir ({}): {error}",
            artifact_dir.display()
        )
    })?;

    let base_url = hf_download_base_url();
    for file in &descriptor.files {
        let relative = file.trim();
        if relative.is_empty() {
            return Err("LOCAL_AI_ARTIFACT_FILE_PATH_REQUIRED: artifact file path is required".to_string());
        }
        let destination = artifact_dir.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "LOCAL_AI_ARTIFACT_DIR_CREATE_FAILED: failed to create artifact file dir ({}): {error}",
                    parent.display()
                )
            })?;
        }
        let url = format!(
            "{}/{}/resolve/{}/{}",
            base_url.trim_end_matches('/'),
            descriptor.repo.trim_matches('/'),
            descriptor.revision.trim(),
            relative
        );
        download_file_for_local_runtime(&url, &destination, &mut |_progress| HfDownloadControl::Continue)?;
    }

    verify_downloaded_artifact_hashes(descriptor, &artifact_dir)?;
    let manifest_path = artifact_dir.join("artifact.manifest.json");
    let manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "artifactId": descriptor.artifact_id,
        "kind": serde_json::to_string(&descriptor.kind).unwrap_or_default().trim_matches('"'),
        "engine": descriptor.engine,
        "entry": descriptor.entry,
        "files": descriptor.files,
        "license": descriptor.license,
        "source": {
            "repo": descriptor.repo,
            "revision": descriptor.revision,
        },
        "integrity_mode": "verified",
        "hashes": descriptor.hashes,
        "metadata": descriptor.metadata,
    });
    std::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("LOCAL_AI_ARTIFACT_MANIFEST_SERIALIZE_FAILED: {error}"))?,
    )
    .map_err(|error| {
        format!(
            "LOCAL_AI_ARTIFACT_MANIFEST_WRITE_FAILED: failed to write manifest ({}): {error}",
            manifest_path.display()
        )
    })?;

    let now = now_iso_timestamp();
    upsert_artifact(
        app,
        LocalAiArtifactRecord {
            local_artifact_id: format!(
                "local_artifact_{}_{}",
                slugify_local_model_id(descriptor.artifact_id.as_str()),
                generate_ulid_string()
            ),
            artifact_id: descriptor.artifact_id.clone(),
            kind: descriptor.kind.clone(),
            engine: descriptor.engine.clone(),
            entry: descriptor.entry.clone(),
            files: descriptor.files.clone(),
            license: descriptor.license.clone(),
            source: LocalAiArtifactSource {
                repo: descriptor.repo.clone(),
                revision: descriptor.revision.clone(),
            },
            integrity_mode: Some(LocalAiIntegrityMode::Verified),
            hashes: descriptor.hashes.clone(),
            status: LocalAiArtifactStatus::Installed,
            installed_at: now.clone(),
            updated_at: now,
            health_detail: None,
            metadata: descriptor.metadata.clone(),
        },
    )
}

#[tauri::command]
pub fn runtime_local_artifacts_list(
    payload: Option<serde_json::Value>,
    app: AppHandle,
) -> Result<Vec<LocalAiArtifactRecord>, String> {
    let payload = payload.unwrap_or_default();
    let status_filter = payload
        .get("status")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let kind_filter = payload
        .get("kind")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let engine_filter = payload
        .get("engine")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_ascii_lowercase());
    let artifacts = list_artifacts(&app)?;
    Ok(artifacts
        .into_iter()
        .filter(|artifact| artifact_status_matches_filter(artifact, status_filter.as_deref()))
        .filter(|artifact| artifact_kind_matches_filter(artifact, kind_filter.as_deref()))
        .filter(|artifact| {
            engine_filter
                .as_deref()
                .map(|value| artifact.engine.trim().eq_ignore_ascii_case(value))
                .unwrap_or(true)
        })
        .collect())
}

#[tauri::command]
pub fn runtime_local_artifacts_verified_list(
    payload: Option<serde_json::Value>,
) -> Result<Vec<LocalAiVerifiedArtifactDescriptor>, String> {
    let payload = payload.unwrap_or_default();
    let kind_filter = payload
        .get("kind")
        .and_then(|value| value.as_str())
        .map(|value| value.to_ascii_lowercase());
    let engine_filter = payload
        .get("engine")
        .and_then(|value| value.as_str())
        .map(|value| value.to_ascii_lowercase());
    Ok(verified_artifact_list()
        .into_iter()
        .filter(|artifact| {
            kind_filter
                .as_deref()
                .map(|value| serde_json::to_string(&artifact.kind).unwrap_or_default().trim_matches('"').eq_ignore_ascii_case(value))
                .unwrap_or(true)
        })
        .filter(|artifact| {
            engine_filter
                .as_deref()
                .map(|value| artifact.engine.trim().eq_ignore_ascii_case(value))
                .unwrap_or(true)
        })
        .collect())
}

#[tauri::command]
pub fn runtime_local_artifacts_install_verified(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiArtifactRecord, String> {
    let template_id = payload
        .get("templateId")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_VERIFIED_ARTIFACT_TEMPLATE_REQUIRED: templateId is required".to_string())?;
    let descriptor = find_verified_artifact(template_id.as_str()).ok_or_else(|| {
        format!("LOCAL_AI_VERIFIED_ARTIFACT_TEMPLATE_NOT_FOUND: templateId={template_id}")
    })?;
    install_verified_artifact_descriptor(&app, &descriptor)
}

#[tauri::command]
pub fn runtime_local_artifacts_import(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiArtifactRecord, String> {
    let manifest_path = payload
        .get("manifestPath")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_PATH_REQUIRED: manifestPath is required".to_string())?;
    let models_root = runtime_models_dir(&app)?;
    let path = validate_import_artifact_manifest_path(&manifest_path, models_root.as_path())?;
    let manifest = parse_and_validate_artifact_manifest(&path)?;
    upsert_artifact(&app, manifest_to_artifact_record(&manifest)?)
}

#[tauri::command]
pub fn runtime_local_artifacts_adopt(
    app: AppHandle,
    payload: LocalAiArtifactRecord,
) -> Result<LocalAiArtifactRecord, String> {
    let local_artifact_id = payload.local_artifact_id.trim();
    if local_artifact_id.is_empty() {
        return Err("LOCAL_AI_ARTIFACT_ID_REQUIRED: localArtifactId is required".to_string());
    }
    let artifact_id = payload.artifact_id.trim();
    if artifact_id.is_empty() {
        return Err("LOCAL_AI_ARTIFACT_ID_REQUIRED: artifactId is required".to_string());
    }
    let engine = payload.engine.trim();
    if engine.is_empty() {
        return Err("LOCAL_AI_ARTIFACT_ENGINE_REQUIRED: engine is required".to_string());
    }
    let entry = payload.entry.trim();
    if entry.is_empty() {
        return Err("LOCAL_AI_ARTIFACT_ENTRY_REQUIRED: entry is required".to_string());
    }

    let now = now_iso_timestamp();
    upsert_artifact(
        &app,
        LocalAiArtifactRecord {
            local_artifact_id: local_artifact_id.to_string(),
            artifact_id: artifact_id.to_string(),
            kind: payload.kind,
            engine: engine.to_string(),
            entry: entry.to_string(),
            files: payload.files,
            license: payload.license.trim().to_string(),
            source: LocalAiArtifactSource {
                repo: payload.source.repo.trim().to_string(),
                revision: payload.source.revision.trim().to_string(),
            },
            integrity_mode: payload.integrity_mode.or_else(|| {
                Some(infer_artifact_integrity_mode_from_source(&LocalAiArtifactSource {
                    repo: payload.source.repo.trim().to_string(),
                    revision: payload.source.revision.trim().to_string(),
                }))
            }),
            hashes: payload.hashes,
            status: payload.status,
            installed_at: if payload.installed_at.trim().is_empty() {
                now.clone()
            } else {
                payload.installed_at
            },
            updated_at: now,
            health_detail: payload.health_detail.and_then(|value| {
                let normalized = value.trim().to_string();
                if normalized.is_empty() {
                    None
                } else {
                    Some(normalized)
                }
            }),
            metadata: payload.metadata,
        },
    )
}

#[tauri::command]
pub fn runtime_local_artifacts_remove(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiArtifactRecord, String> {
    let local_artifact_id = payload
        .get("localArtifactId")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_ARTIFACT_ID_REQUIRED: localArtifactId is required".to_string())?;
    remove_artifact(&app, local_artifact_id.as_str())
}
