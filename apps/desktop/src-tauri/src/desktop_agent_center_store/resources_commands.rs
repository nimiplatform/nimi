use super::*;

pub(super) fn select_imported_avatar_package(
    account_id: &str,
    agent_id: &str,
    kind: AgentCenterAvatarPackageKind,
    package_id: &str,
    checked_at: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        agent_id: agent_id.to_string(),
    })?;
    config.modules.avatar_package.selected_package = Some(AgentCenterSelectedAvatarPackage {
        kind,
        package_id: package_id.to_string(),
    });
    config.modules.avatar_package.last_validated_at = Some(checked_at.to_string());
    desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
        account_id: account_id.to_string(),
        agent_id: agent_id.to_string(),
        config,
    })?;
    Ok(())
}

pub(super) fn select_imported_background(
    account_id: &str,
    agent_id: &str,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        agent_id: agent_id.to_string(),
    })?;
    config.modules.appearance.background_asset_id = Some(background_asset_id.to_string());
    desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
        account_id: account_id.to_string(),
        agent_id: agent_id.to_string(),
        config,
    })?;
    Ok(())
}

pub(super) fn clear_selected_avatar_package(
    account_id: &str,
    agent_id: &str,
    kind: AgentCenterAvatarPackageKind,
    package_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        agent_id: agent_id.to_string(),
    })?;
    let selected = config.modules.avatar_package.selected_package.clone();
    if selected
        .as_ref()
        .is_some_and(|entry| entry.kind == kind && entry.package_id == package_id)
    {
        config.modules.avatar_package.selected_package = None;
        config.modules.avatar_package.last_validated_at = None;
        if config
            .modules
            .avatar_package
            .last_launch_package_id
            .as_deref()
            == Some(package_id)
        {
            config.modules.avatar_package.last_launch_package_id = None;
        }
        desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            agent_id: agent_id.to_string(),
            config,
        })?;
    }
    Ok(())
}

pub(super) fn clear_selected_background(
    account_id: &str,
    agent_id: &str,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        agent_id: agent_id.to_string(),
    })?;
    if config.modules.appearance.background_asset_id.as_deref() == Some(background_asset_id) {
        config.modules.appearance.background_asset_id = None;
        desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            agent_id: agent_id.to_string(),
            config,
        })?;
    }
    Ok(())
}

pub(super) fn collect_import_source_files(
    kind: AgentCenterAvatarPackageKind,
    source: &Path,
) -> Result<(Vec<(PathBuf, String)>, String), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        format!(
            "failed to read source package ({}): {error}",
            source.display()
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err("source package path must not be a symlink".to_string());
    }

    match kind {
        AgentCenterAvatarPackageKind::Vrm => {
            if !metadata.is_file() || extension_for(&source.to_string_lossy()) != "vrm" {
                return Err("VRM import source must be a .vrm file".to_string());
            }
            Ok((
                vec![(source.to_path_buf(), "model.vrm".to_string())],
                "model.vrm".to_string(),
            ))
        }
        AgentCenterAvatarPackageKind::Live2d => {
            let source_root = if metadata.is_file() {
                source
                    .parent()
                    .ok_or_else(|| "Live2D model file has no parent directory".to_string())?
                    .to_path_buf()
            } else if metadata.is_dir() {
                source.to_path_buf()
            } else {
                return Err(
                    "Live2D import source must be a directory or .model3.json file".to_string(),
                );
            };
            let mut collected = Vec::<(PathBuf, String)>::new();
            collect_files_recursive(&source_root, &source_root, &mut collected)?;
            let mut files = Vec::<(PathBuf, String)>::new();
            let mut entry_candidates = BTreeSet::<String>::new();
            for (path, relative) in collected {
                if relative.ends_with(".model3.json") {
                    entry_candidates.insert(relative.clone());
                }
                files.push((path, relative));
            }
            let requested_entry = if metadata.is_file() {
                let relative = source.strip_prefix(&source_root).map_err(|error| {
                    format!("Live2D model file is outside its source root: {error}")
                })?;
                Some(relative_path_to_string(relative)?)
            } else {
                None
            };
            let entry_file = requested_entry
                .or_else(|| entry_candidates.iter().next().cloned())
                .ok_or_else(|| {
                    "Live2D package must contain a .model3.json entry file".to_string()
                })?;
            Ok((files, entry_file))
        }
    }
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_import(
    payload: DesktopAgentCenterBackgroundImportPayload,
) -> Result<DesktopAgentCenterBackgroundImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve background source ({}): {error}",
            source_path.display()
        )
    })?;
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("failed to read background source metadata: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("background source path must not be a symlink".to_string());
    }
    if !metadata.is_file() {
        return Err("background source must be an image file".to_string());
    }
    let mime = background_mime_for_path(&source)?;
    let source_bytes = fs::read(&source).map_err(|error| {
        format!(
            "failed to read background source ({}): {error}",
            source.display()
        )
    })?;
    let bytes = u64::try_from(source_bytes.len()).unwrap_or(u64::MAX);
    if bytes == 0 || bytes > MAX_BACKGROUND_BYTES {
        return Err("background source is outside the fixed byte cap".to_string());
    }
    let (pixel_width, pixel_height) = background_dimensions(&source_bytes, &mime)?;
    let sha256 = {
        let mut hasher = Sha256::new();
        hasher.update(&source_bytes);
        format!("{:x}", hasher.finalize())
    };
    let background_asset_id = format!("bg_{}", &sha256[..12]);
    validate_background_id(&background_asset_id, "backgroundAssetId")?;
    let final_dir = background_dir(&account_id, &agent_id, &background_asset_id)?;
    let selected = payload.select.unwrap_or(true);

    if final_dir.exists() {
        let validation = validate_background_manifest(&final_dir, &background_asset_id);
        write_background_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterBackgroundValidationStatus::Valid {
            return Err(format!(
                "background id collision exists but is not valid: {background_asset_id}"
            ));
        }
        if selected {
            select_imported_background(&account_id, &agent_id, &background_asset_id)?;
        }
        let _ = record_resource_operation(
            &account_id,
            &agent_id,
            "background_import_reuse",
            "background",
            &background_asset_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterBackgroundImportResult {
            background_asset_id,
            selected,
            validation,
        });
    }

    let staging_dir = agent_center_dir(&account_id, &agent_id)?
        .join("modules")
        .join("appearance")
        .join("staging")
        .join(format!(
            "{}_{}",
            background_asset_id,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
    remove_dir_if_exists(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "failed to create background staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        let extension = extension_for(&source.to_string_lossy());
        let image_file = format!("image.{extension}");
        fs::write(staging_dir.join(&image_file), &source_bytes).map_err(|error| {
            format!(
                "failed to copy background image into staging ({}): {error}",
                staging_dir.display()
            )
        })?;
        let display_name = safe_display_name(payload.display_name, &source)?;
        let manifest = BackgroundManifest {
            manifest_version: 1,
            background_asset_id: background_asset_id.clone(),
            display_name,
            image_file,
            mime,
            bytes,
            pixel_width,
            pixel_height,
            limits: BackgroundManifestLimits {
                max_bytes: MAX_BACKGROUND_BYTES,
                max_pixel_width: MAX_BACKGROUND_PIXELS,
                max_pixel_height: MAX_BACKGROUND_PIXELS,
            },
            sha256,
            imported_at: checked_at(),
            source_label: source_label_for(&source),
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let staging_validation = validate_background_manifest(&staging_dir, &background_asset_id);
        if staging_validation.status != AgentCenterBackgroundValidationStatus::Valid {
            return Err(format!(
                "staged background failed validation: {:?}",
                staging_validation.errors
            ));
        }
        let parent = final_dir
            .parent()
            .ok_or_else(|| "background final path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create background final directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::rename(&staging_dir, &final_dir).map_err(|error| {
            format!(
                "failed to finalize background import ({} -> {}): {error}",
                staging_dir.display(),
                final_dir.display()
            )
        })?;
        let validation = validate_background_manifest(&final_dir, &background_asset_id);
        write_background_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterBackgroundValidationStatus::Valid {
            return Err(format!(
                "final background failed validation: {:?}",
                validation.errors
            ));
        }
        Ok::<_, String>(validation)
    })();

    let validation = match import_result {
        Ok(validation) => validation,
        Err(error) => {
            remove_dir_if_exists(&staging_dir);
            if final_dir.exists() {
                let validation = validate_background_manifest(&final_dir, &background_asset_id);
                if validation.status != AgentCenterBackgroundValidationStatus::Valid {
                    remove_dir_if_exists(&final_dir);
                }
            }
            return Err(error);
        }
    };

    if selected {
        select_imported_background(&account_id, &agent_id, &background_asset_id)?;
    }
    let _ = record_resource_operation(
        &account_id,
        &agent_id,
        "background_import",
        "background",
        &background_asset_id,
        "completed",
        "user_imported",
    )?;

    Ok(DesktopAgentCenterBackgroundImportResult {
        background_asset_id,
        selected,
        validation,
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_package_import(
    payload: DesktopAgentCenterAvatarPackageImportPayload,
) -> Result<DesktopAgentCenterAvatarPackageImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve avatar package source ({}): {error}",
            source_path.display()
        )
    })?;
    let display_name = safe_display_name(payload.display_name, &source)?;
    let source_label = source_label_for(&source);
    let (source_files, entry_file_without_prefix) =
        collect_import_source_files(payload.kind, &source)?;

    if source_files.is_empty() || source_files.len() > MAX_FILE_COUNT {
        return Err("avatar package source must contain 1..2048 files".to_string());
    }

    let mut manifest_files = Vec::<AvatarPackageManifestFile>::new();
    let mut seen_paths = HashSet::<String>::new();
    for (source_file, relative) in &source_files {
        let manifest_path = format!("files/{relative}");
        if !seen_paths.insert(manifest_path.clone()) {
            return Err(format!(
                "avatar package source has duplicate file path: {manifest_path}"
            ));
        }
        let (bytes, sha256) = sha256_file(source_file).map_err(|issue| issue.message)?;
        if bytes == 0 || bytes > MAX_FILE_BYTES {
            return Err(format!(
                "avatar package source file is outside the fixed size cap: {manifest_path}"
            ));
        }
        manifest_files.push(AvatarPackageManifestFile {
            path: manifest_path,
            sha256,
            bytes,
            mime: mime_for(relative),
        });
    }

    let package_bytes = manifest_files
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.bytes));
    if package_bytes > MAX_PACKAGE_BYTES {
        return Err("avatar package source is over the fixed package byte cap".to_string());
    }

    let content_digest = aggregate_content_digest(&manifest_files);
    let package_id = package_id_for(payload.kind, &content_digest);
    validate_package_id(&package_id, "packageId")?;
    let final_dir = package_dir(&account_id, &agent_id, payload.kind, &package_id)?;
    let selected = payload.select.unwrap_or(true);

    if final_dir.exists() {
        let validation = validate_manifest(&final_dir, payload.kind, &package_id);
        write_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterAvatarPackageValidationStatus::Valid {
            return Err(format!(
                "avatar package id collision exists but is not valid: {package_id}"
            ));
        }
        if selected {
            select_imported_avatar_package(
                &account_id,
                &agent_id,
                payload.kind,
                &package_id,
                &validation.checked_at,
            )?;
        }
        let _ = record_resource_operation(
            &account_id,
            &agent_id,
            "package_import_reuse",
            "avatar_package",
            &package_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterAvatarPackageImportResult {
            package_id,
            kind: payload.kind,
            selected,
            validation,
        });
    }

    let staging_dir = agent_center_dir(&account_id, &agent_id)?
        .join("modules")
        .join("avatar_package")
        .join("staging")
        .join(format!(
            "{}_{}",
            package_id,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
    remove_dir_if_exists(&staging_dir);
    fs::create_dir_all(staging_dir.join("files")).map_err(|error| {
        format!(
            "failed to create avatar package staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        for (source_file, relative) in &source_files {
            let target = staging_dir.join("files").join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "failed to create staged package directory ({}): {error}",
                        parent.display()
                    )
                })?;
            }
            fs::copy(source_file, &target).map_err(|error| {
                format!(
                    "failed to copy avatar package file ({} -> {}): {error}",
                    source_file.display(),
                    target.display()
                )
            })?;
        }

        let entry_file = format!("files/{entry_file_without_prefix}");
        let imported_at = checked_at();
        let manifest = AvatarPackageManifest {
            manifest_version: AVATAR_PACKAGE_MANIFEST_VERSION,
            package_version: "1.0.0".to_string(),
            package_id: package_id.clone(),
            kind: payload.kind,
            loader_min_version: "1.0.0".to_string(),
            display_name,
            display_name_i18n: serde_json::Map::new(),
            entry_file: entry_file.clone(),
            required_files: vec![entry_file],
            content_digest: format!("sha256:{content_digest}"),
            files: manifest_files,
            limits: AvatarPackageManifestLimits {
                max_manifest_bytes: MAX_MANIFEST_BYTES,
                max_package_bytes: MAX_PACKAGE_BYTES,
                max_file_bytes: MAX_FILE_BYTES,
                max_file_count: MAX_FILE_COUNT,
            },
            capabilities: serde_json::json!({}),
            import: AvatarPackageManifestImport {
                imported_at,
                source_label,
                source_fingerprint: format!("sha256:{content_digest}"),
            },
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let staging_validation = validate_manifest(&staging_dir, payload.kind, &package_id);
        if staging_validation.status != AgentCenterAvatarPackageValidationStatus::Valid {
            return Err(format!(
                "staged avatar package failed validation: {:?}",
                staging_validation.errors
            ));
        }
        let parent = final_dir
            .parent()
            .ok_or_else(|| "avatar package final path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create avatar package final directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::rename(&staging_dir, &final_dir).map_err(|error| {
            format!(
                "failed to finalize avatar package import ({} -> {}): {error}",
                staging_dir.display(),
                final_dir.display()
            )
        })?;
        let validation = validate_manifest(&final_dir, payload.kind, &package_id);
        write_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterAvatarPackageValidationStatus::Valid {
            return Err(format!(
                "final avatar package failed validation: {:?}",
                validation.errors
            ));
        }
        Ok::<_, String>(validation)
    })();

    let validation = match import_result {
        Ok(validation) => validation,
        Err(error) => {
            remove_dir_if_exists(&staging_dir);
            if final_dir.exists() {
                let validation = validate_manifest(&final_dir, payload.kind, &package_id);
                if validation.status != AgentCenterAvatarPackageValidationStatus::Valid {
                    remove_dir_if_exists(&final_dir);
                }
            }
            return Err(error);
        }
    };

    if selected {
        select_imported_avatar_package(
            &account_id,
            &agent_id,
            payload.kind,
            &package_id,
            &validation.checked_at,
        )?;
    }
    let _ = record_resource_operation(
        &account_id,
        &agent_id,
        "package_import",
        "avatar_package",
        &package_id,
        "completed",
        "user_imported",
    )?;

    Ok(DesktopAgentCenterAvatarPackageImportResult {
        package_id,
        kind: payload.kind,
        selected,
        validation,
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_package_remove(
    payload: DesktopAgentCenterAvatarPackageRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_package_id(&payload.package_id, "packageId")?;
    if !payload
        .package_id
        .starts_with(package_kind_dir(payload.kind))
    {
        return Err("packageId must match kind".to_string());
    }
    clear_selected_avatar_package(&account_id, &agent_id, payload.kind, &payload.package_id)?;
    let source = package_dir(&account_id, &agent_id, payload.kind, &payload.package_id)?;
    let destination = quarantine_path(
        &account_id,
        &agent_id,
        "avatar_package",
        &payload.package_id,
    )?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                &account_id,
                &agent_id,
                "package_quarantine",
                "avatar_package",
                &payload.package_id,
                "failed",
                "user_removed",
            );
            return Err(error);
        }
    };
    let operation_id = record_resource_operation(
        &account_id,
        &agent_id,
        "package_quarantine",
        "avatar_package",
        &payload.package_id,
        "completed",
        if quarantined {
            "user_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "avatar_package".to_string(),
        resource_id: payload.package_id,
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_remove(
    payload: DesktopAgentCenterBackgroundRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_background_id(&payload.background_asset_id, "backgroundAssetId")?;
    clear_selected_background(&account_id, &agent_id, &payload.background_asset_id)?;
    let source = background_dir(&account_id, &agent_id, &payload.background_asset_id)?;
    let destination = quarantine_path(
        &account_id,
        &agent_id,
        "background",
        &payload.background_asset_id,
    )?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                &account_id,
                &agent_id,
                "background_quarantine",
                "background",
                &payload.background_asset_id,
                "failed",
                "user_removed",
            );
            return Err(error);
        }
    };
    let operation_id = record_resource_operation(
        &account_id,
        &agent_id,
        "background_quarantine",
        "background",
        &payload.background_asset_id,
        "completed",
        if quarantined {
            "user_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "background".to_string(),
        resource_id: payload.background_asset_id,
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_agent_local_resources_remove(
    payload: DesktopAgentCenterAgentLocalResourcesRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    quarantine_agent_center_tree(&account_id, &agent_id, "agent_removed")
}

#[tauri::command]
pub(crate) fn desktop_agent_center_account_local_resources_remove(
    payload: DesktopAgentCenterAccountLocalResourcesRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let account_root = account_dir(&account_id)?;
    let agents_root = account_root.join("agents");
    if !agents_root.exists() {
        let operation_id = record_account_resource_operation(
            &account_id,
            "account_local_resources_quarantine",
            "account_local_resources",
            &account_id,
            "completed",
            "already_missing",
        )?;
        return Ok(DesktopAgentCenterLocalResourceRemoveResult {
            resource_kind: "account_local_resources".to_string(),
            resource_id: account_id,
            quarantined: false,
            operation_id,
            status: "completed".to_string(),
        });
    }

    let mut quarantined_any = false;
    for entry in fs::read_dir(&agents_root).map_err(|error| {
        format!(
            "failed to read Agent Center account agents directory ({}): {error}",
            agents_root.display()
        )
    })? {
        let entry = entry
            .map_err(|error| format!("failed to read Agent Center account agent entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            format!(
                "failed to inspect Agent Center account agent entry ({}): {error}",
                path.display()
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Agent Center account agent entry must not be a symlink ({})",
                path.display()
            ));
        }
        if !metadata.is_dir() {
            continue;
        }
        let Some(agent_id_raw) = path.file_name().and_then(|value| value.to_str()) else {
            return Err(format!(
                "Agent Center account agent entry has invalid name ({})",
                path.display()
            ));
        };
        let agent_id = validate_normalized_id(agent_id_raw, "agentId")?;
        let result = quarantine_agent_center_tree(&account_id, &agent_id, "account_removed")?;
        quarantined_any = quarantined_any || result.quarantined;
    }

    let operation_id = record_account_resource_operation(
        &account_id,
        "account_local_resources_quarantine",
        "account_local_resources",
        &account_id,
        "completed",
        if quarantined_any {
            "account_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "account_local_resources".to_string(),
        resource_id: account_id,
        quarantined: quarantined_any,
        operation_id,
        status: "completed".to_string(),
    })
}
