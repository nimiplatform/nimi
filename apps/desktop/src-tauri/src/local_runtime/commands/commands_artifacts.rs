fn verify_downloaded_asset_hashes(
    descriptor: &LocalAiVerifiedAssetDescriptor,
    asset_dir: &std::path::Path,
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
        let actual = sha256_hex_for_local_runtime(&asset_dir.join(file))?;
        if actual != expected {
            return Err(format!(
                "LOCAL_AI_ASSET_HASH_MISMATCH: file={file}, expected={expected}, actual={actual}"
            ));
        }
    }
    Ok(())
}

fn install_verified_asset_descriptor(
    app: &AppHandle,
    descriptor: &LocalAiVerifiedAssetDescriptor,
) -> Result<LocalAiAssetRecord, String> {
    if let Some(existing) = find_installed_asset_by_identity(
        app,
        descriptor.asset_id.as_str(),
        &descriptor.kind,
        descriptor.engine.as_str(),
    )? {
        return Ok(existing);
    }

    let models_root = runtime_models_dir(app)?;
    let asset_target_dir = artifact_dir(models_root.as_path(), descriptor.asset_id.as_str());
    if asset_target_dir.exists() {
        std::fs::remove_dir_all(&asset_target_dir).map_err(|error| {
            format!(
                "LOCAL_AI_ASSET_DIR_REMOVE_FAILED: failed to clear existing dir ({}): {error}",
                asset_target_dir.display()
            )
        })?;
    }
    std::fs::create_dir_all(&asset_target_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ASSET_DIR_CREATE_FAILED: failed to create asset dir ({}): {error}",
            asset_target_dir.display()
        )
    })?;

    let base_url = hf_download_base_url();
    for file in &descriptor.files {
        let relative = file.trim();
        if relative.is_empty() {
            return Err("LOCAL_AI_ASSET_FILE_PATH_REQUIRED: asset file path is required".to_string());
        }
        let destination = asset_target_dir.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "LOCAL_AI_ASSET_DIR_CREATE_FAILED: failed to create asset file dir ({}): {error}",
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

    verify_downloaded_asset_hashes(descriptor, &asset_target_dir)?;
    let manifest_path = asset_target_dir.join("asset.manifest.json");
    let manifest = serde_json::json!({
        "schemaVersion": "2.0.0",
        "assetId": descriptor.asset_id,
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
            .map_err(|error| format!("LOCAL_AI_ASSET_MANIFEST_SERIALIZE_FAILED: {error}"))?,
    )
    .map_err(|error| {
        format!(
            "LOCAL_AI_ASSET_MANIFEST_WRITE_FAILED: failed to write manifest ({}): {error}",
            manifest_path.display()
        )
    })?;

    let now = now_iso_timestamp();
    upsert_asset(
        app,
        LocalAiAssetRecord {
            local_asset_id: format!(
                "local_asset_{}_{}",
                slugify_local_model_id(descriptor.asset_id.as_str()),
                generate_ulid_string()
            ),
            asset_id: descriptor.asset_id.clone(),
            kind: descriptor.kind.clone(),
            engine: descriptor.engine.clone(),
            entry: descriptor.entry.clone(),
            files: descriptor.files.clone(),
            license: descriptor.license.clone(),
            source: LocalAiAssetSource {
                repo: descriptor.repo.clone(),
                revision: descriptor.revision.clone(),
            },
            integrity_mode: Some(LocalAiIntegrityMode::Verified),
            hashes: descriptor.hashes.clone(),
            status: LocalAiAssetStatus::Installed,
            installed_at: now.clone(),
            updated_at: now,
            health_detail: None,
            metadata: descriptor.metadata.clone(),
        },
    )
}

#[tauri::command]
pub fn runtime_local_assets_install_verified(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiAssetRecord, String> {
    let template_id = payload
        .get("templateId")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_VERIFIED_ASSET_TEMPLATE_REQUIRED: templateId is required".to_string())?;
    let descriptor = find_verified_asset(template_id.as_str()).ok_or_else(|| {
        format!("LOCAL_AI_VERIFIED_ASSET_TEMPLATE_NOT_FOUND: templateId={template_id}")
    })?;
    install_verified_asset_descriptor(&app, &descriptor)
}

#[tauri::command]
pub fn runtime_local_assets_import(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiAssetRecord, String> {
    let manifest_path = payload
        .get("manifestPath")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_IMPORT_ASSET_MANIFEST_PATH_REQUIRED: manifestPath is required".to_string())?;
    let models_root = runtime_models_dir(&app)?;
    let path = validate_import_asset_manifest_path(&manifest_path, models_root.as_path())?;
    let manifest = parse_and_validate_asset_manifest(&path)?;
    upsert_asset(&app, manifest_to_artifact_record(&manifest)?)
}

#[tauri::command]
pub fn runtime_local_assets_adopt(
    app: AppHandle,
    payload: LocalAiAssetRecord,
) -> Result<LocalAiAssetRecord, String> {
    let local_asset_id = payload.local_asset_id.trim();
    if local_asset_id.is_empty() {
        return Err("LOCAL_AI_ASSET_ID_REQUIRED: localAssetId is required".to_string());
    }
    let asset_id = payload.asset_id.trim();
    if asset_id.is_empty() {
        return Err("LOCAL_AI_ASSET_ID_REQUIRED: assetId is required".to_string());
    }
    let engine = payload.engine.trim();
    if engine.is_empty() {
        return Err("LOCAL_AI_ASSET_ENGINE_REQUIRED: engine is required".to_string());
    }
    let entry = payload.entry.trim();
    if entry.is_empty() {
        return Err("LOCAL_AI_ASSET_ENTRY_REQUIRED: entry is required".to_string());
    }

    let now = now_iso_timestamp();
    upsert_asset(
        &app,
        LocalAiAssetRecord {
            local_asset_id: local_asset_id.to_string(),
            asset_id: asset_id.to_string(),
            kind: payload.kind,
            engine: engine.to_string(),
            entry: entry.to_string(),
            files: payload.files,
            license: payload.license.trim().to_string(),
            source: LocalAiAssetSource {
                repo: payload.source.repo.trim().to_string(),
                revision: payload.source.revision.trim().to_string(),
            },
            integrity_mode: payload.integrity_mode.or_else(|| {
                Some(infer_asset_integrity_mode_from_source(&LocalAiAssetSource {
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
