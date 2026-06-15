use super::*;

fn backend_kind_id(kind: AgentCenterAvatarBackendKind) -> Result<&'static str, String> {
    match kind {
        AgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        AgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        AgentCenterAvatarBackendKind::Future => {
            Err("Avatar asset import only admits live2d or vrm backends".to_string())
        }
    }
}

fn avatar_file_mime(kind: &str, path: &Path) -> String {
    let extension = extension_for(&path.to_string_lossy());
    if kind == "vrm" && extension == "vrm" {
        return "model/vrm".to_string();
    }
    if extension == "json" {
        return "application/json".to_string();
    }
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "moc3" => "application/octet-stream",
        "motion3" => "application/json",
        "exp3" => "application/json",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[derive(Debug, Clone)]
struct AvatarImportSourceFile {
    source_path: PathBuf,
    package_path: String,
    bytes: u64,
    sha256: String,
    mime: String,
}

fn package_relative_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::<String>::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let segment = value
                    .to_str()
                    .ok_or_else(|| "Avatar asset file paths must be UTF-8".to_string())?;
                if segment.trim().is_empty() || segment == "." || segment == ".." {
                    return Err("Avatar asset file path contains an unsafe segment".to_string());
                }
                parts.push(segment.to_string());
            }
            _ => return Err("Avatar asset file path must be package-relative".to_string()),
        }
    }
    let relative = parts.join("/");
    if !is_safe_relative_path(&relative) {
        return Err("Avatar asset file path was rejected".to_string());
    }
    Ok(format!("files/{relative}"))
}

fn collect_live2d_source_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(current)
        .map_err(|error| format!("failed to read Live2D source metadata: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Live2D source must not contain symlinks".to_string());
    }
    if metadata.is_file() {
        output.push(current.to_path_buf());
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err("Live2D source must contain only files and directories".to_string());
    }
    for entry in fs::read_dir(current)
        .map_err(|error| format!("failed to read Live2D source directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read Live2D source entry: {error}"))?;
        collect_live2d_source_files(root, &entry.path(), output)?;
    }
    if current == root && output.is_empty() {
        return Err("Live2D source folder contains no files".to_string());
    }
    Ok(())
}

fn read_avatar_source_files(
    kind: &str,
    source: &Path,
) -> Result<(Vec<AvatarImportSourceFile>, String), String> {
    let mut source_files = Vec::<PathBuf>::new();
    let entry_package_path = if kind == "vrm" {
        let metadata = fs::symlink_metadata(source)
            .map_err(|error| format!("failed to read VRM source metadata: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("VRM source path must not be a symlink".to_string());
        }
        if !metadata.is_file() || extension_for(&source.to_string_lossy()) != "vrm" {
            return Err("VRM source must be a .vrm file".to_string());
        }
        source_files.push(source.to_path_buf());
        let name = source
            .file_name()
            .ok_or_else(|| "VRM source file has no file name".to_string())?;
        package_relative_path(Path::new(name))?
    } else {
        let metadata = fs::symlink_metadata(source)
            .map_err(|error| format!("failed to read Live2D source metadata: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Live2D source path must not be a symlink".to_string());
        }
        if !metadata.is_dir() {
            return Err("Live2D source must be a folder".to_string());
        }
        collect_live2d_source_files(source, source, &mut source_files)?;
        let mut model_entries = source_files
            .iter()
            .filter(|path| path.to_string_lossy().ends_with(".model3.json"))
            .collect::<Vec<_>>();
        model_entries.sort();
        if model_entries.len() != 1 {
            return Err(
                "Live2D source folder must contain exactly one .model3.json entry".to_string(),
            );
        }
        let entry_relative = model_entries[0]
            .strip_prefix(source)
            .map_err(|_| "Live2D entry file must stay under source folder".to_string())?;
        package_relative_path(entry_relative)?
    };

    let canonical_source = fs::canonicalize(source)
        .map_err(|error| format!("failed to resolve Avatar source path: {error}"))?;
    let mut records = Vec::<AvatarImportSourceFile>::new();
    for file_path in source_files {
        let canonical = fs::canonicalize(&file_path).map_err(|error| {
            format!(
                "failed to resolve Avatar source file ({}): {error}",
                file_path.display()
            )
        })?;
        if kind == "live2d" && !canonical.starts_with(&canonical_source) {
            return Err("Live2D source file escaped the selected source folder".to_string());
        }
        let package_path = if kind == "vrm" {
            let name = canonical
                .file_name()
                .ok_or_else(|| "VRM source file has no file name".to_string())?;
            package_relative_path(Path::new(name))?
        } else {
            let relative = canonical
                .strip_prefix(&canonical_source)
                .map_err(|_| "Live2D source file must stay under source folder".to_string())?;
            package_relative_path(relative)?
        };
        let (bytes, sha256) = sha256_file(&canonical).map_err(|issue| issue.message)?;
        if bytes == 0 || bytes > MAX_AVATAR_ASSET_FILE_BYTES {
            return Err("Avatar source file is outside the fixed byte cap".to_string());
        }
        records.push(AvatarImportSourceFile {
            source_path: canonical.clone(),
            package_path,
            bytes,
            sha256,
            mime: avatar_file_mime(kind, &canonical),
        });
    }
    records.sort_by(|a, b| a.package_path.cmp(&b.package_path));
    if records.len() > MAX_AVATAR_ASSET_FILE_COUNT {
        return Err("Avatar source contains too many files".to_string());
    }
    let total_bytes = records
        .iter()
        .fold(0_u64, |sum, file| sum.saturating_add(file.bytes));
    if total_bytes == 0 || total_bytes > MAX_AVATAR_ASSET_BYTES {
        return Err("Avatar source package is outside the fixed byte cap".to_string());
    }
    Ok((records, entry_package_path))
}

fn avatar_content_digest(files: &[AvatarImportSourceFile]) -> String {
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(file.package_path.as_bytes());
        hasher.update(b"\0");
        hasher.update(file.bytes.to_string().as_bytes());
        hasher.update(b"\0");
        hasher.update(file.sha256.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

fn copy_avatar_source_files(
    staging_dir: &Path,
    files: &[AvatarImportSourceFile],
) -> Result<(), String> {
    for file in files {
        let target = staging_dir.join(&file.package_path);
        let parent = target
            .parent()
            .ok_or_else(|| "Avatar asset package file has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Avatar asset package directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::copy(&file.source_path, &target).map_err(|error| {
            format!(
                "failed to copy Avatar asset file ({} -> {}): {error}",
                file.source_path.display(),
                target.display()
            )
        })?;
    }
    Ok(())
}

fn select_imported_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    kind: AgentCenterAvatarBackendKind,
    local_asset_id: &str,
    backend_capability_profile_ref: &str,
    embedded_live2d_adapter: bool,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    config.modules.avatar_asset.local_avatar_asset_ref = Some(local_asset_id.to_string());
    config.modules.avatar_asset.backend_kind = kind;
    config.modules.avatar_asset.backend_capability_profile_ref =
        Some(backend_capability_profile_ref.to_string());
    if kind == AgentCenterAvatarBackendKind::Live2d && embedded_live2d_adapter {
        config.modules.avatar_asset.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest;
        config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
    } else {
        config.modules.avatar_asset.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::None;
        config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
    }
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: local_asset_id.to_string(),
    };
    desktop_agent_center_config_put_blocking(
        account_id,
        DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        },
    )?;
    Ok(())
}

pub(super) fn select_imported_live2d_adapter_manifest(
    account_id: &str,
    scope: &LocalAgentScope,
    local_asset_id: &str,
    manifest_ref: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    if config.modules.avatar_asset.backend_kind != AgentCenterAvatarBackendKind::Live2d
        || config
            .modules
            .avatar_asset
            .local_avatar_asset_ref
            .as_deref()
            != Some(local_asset_id)
    {
        return Err(
            "external Live2D adapter manifest requires matching runtime-projected Live2D asset evidence".to_string(),
        );
    }
    config.modules.avatar_asset.live2d_adapter_manifest_source =
        AgentCenterLive2dAdapterManifestSource::ExternalSidecarManifest;
    config.modules.avatar_asset.live2d_adapter_manifest_ref = Some(manifest_ref.to_string());
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: manifest_ref.to_string(),
    };
    desktop_agent_center_config_put_blocking(
        account_id,
        DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_live2d_source(
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select Live2D folder")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_vrm_source() -> Result<Option<String>, String>
{
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select VRM file")
        .add_filter("VRM", &["vrm"])
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_import(
    payload: DesktopAgentCenterAvatarAssetImportPayload,
) -> Result<DesktopAgentCenterAvatarAssetImportResult, String> {
    let account_id = crate::desktop_agent_center_store::active_agent_center_account_id().await?;
    let mut payload = payload;
    payload.account_id = account_id;
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_import", move || {
        desktop_agent_center_avatar_asset_import_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_import_blocking(
    payload: DesktopAgentCenterAvatarAssetImportPayload,
) -> Result<DesktopAgentCenterAvatarAssetImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let kind = backend_kind_id(payload.kind)?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve Avatar asset source ({}): {error}",
            source_path.display()
        )
    })?;
    let (files, entry_file) = read_avatar_source_files(kind, &source)?;
    let content_digest = avatar_content_digest(&files);
    let local_asset_id = format!("{kind}_{}", &content_digest[..12]);
    validate_local_asset_id(&local_asset_id, "localAssetId")?;
    let final_dir = avatar_asset_dir(&account_id, &scope.local_agent_ref, kind, &local_asset_id)?;
    let selected = payload.select.unwrap_or(true);
    let backend_capability_profile_ref = backend_capability_profile_ref_for(kind, &local_asset_id);
    let materialization_ref =
        materialization_ref_for(&account_id, &scope.local_agent_ref, kind, &local_asset_id);

    if final_dir.exists() {
        let validation = validate_avatar_asset_manifest(&final_dir, &local_asset_id);
        write_avatar_asset_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterAvatarAssetValidationStatus::Valid {
            return Err(format!(
                "Avatar asset id collision exists but is not valid: {local_asset_id}"
            ));
        }
        if selected {
            let embedded = final_dir
                .join(&entry_file)
                .parent()
                .map(|parent| parent.join("nimi").join("live2d-adapter.json").is_file())
                .unwrap_or(false);
            select_imported_avatar_asset(
                &account_id,
                &scope,
                payload.kind,
                &local_asset_id,
                &backend_capability_profile_ref,
                embedded,
            )?;
        }
        let _ = record_resource_operation(
            &account_id,
            &scope.local_agent_ref,
            "avatar_asset_import_reuse",
            kind,
            &local_asset_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterAvatarAssetImportResult {
            local_asset_id,
            backend_kind: payload.kind,
            selected,
            materialization_ref,
            backend_capability_profile_ref,
            validation,
        });
    }

    let staging_dir = agent_center_dir(&account_id, &scope.local_agent_ref)?
        .join("modules")
        .join("avatar_asset")
        .join("staging")
        .join(format!(
            "{}_{}",
            local_asset_id,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
    remove_dir_if_exists(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "failed to create Avatar asset staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        copy_avatar_source_files(&staging_dir, &files)?;
        let display_name = safe_display_name(payload.display_name, &source)?;
        let manifest_files = files
            .iter()
            .map(|file| AvatarAssetManifestFile {
                path: file.package_path.clone(),
                sha256: file.sha256.clone(),
                bytes: file.bytes,
                mime: file.mime.clone(),
            })
            .collect::<Vec<_>>();
        let manifest = AvatarAssetManifest {
            manifest_version: 1,
            asset_version: "1.0.0".to_string(),
            local_asset_id: local_asset_id.clone(),
            kind: kind.to_string(),
            loader_min_version: "1.0.0".to_string(),
            display_name,
            display_name_i18n: serde_json::Map::new(),
            entry_file: entry_file.clone(),
            required_files: vec![entry_file.clone()],
            content_digest: format!("sha256:{content_digest}"),
            files: manifest_files,
            limits: AvatarAssetManifestLimits {
                max_manifest_bytes: MAX_AVATAR_ASSET_MANIFEST_BYTES,
                max_asset_bytes: MAX_AVATAR_ASSET_BYTES,
                max_file_bytes: MAX_AVATAR_ASSET_FILE_BYTES,
                max_file_count: MAX_AVATAR_ASSET_FILE_COUNT,
            },
            capabilities: serde_json::json!({
                "backend_kind": kind,
                "profile_ref": backend_capability_profile_ref,
                "materialization_ref": materialization_ref,
            }),
            import: AvatarAssetManifestImport {
                imported_at: checked_at(),
                source_label: source_label_for(&source),
                source_fingerprint: format!("sha256:{content_digest}"),
            },
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let staging_validation = validate_avatar_asset_manifest(&staging_dir, &local_asset_id);
        if staging_validation.status != AgentCenterAvatarAssetValidationStatus::Valid {
            return Err(format!(
                "staged Avatar asset failed validation: {:?}",
                staging_validation.errors
            ));
        }
        let parent = final_dir
            .parent()
            .ok_or_else(|| "Avatar asset final path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Avatar asset final directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::rename(&staging_dir, &final_dir).map_err(|error| {
            format!(
                "failed to finalize Avatar asset import ({} -> {}): {error}",
                staging_dir.display(),
                final_dir.display()
            )
        })?;
        let validation = validate_avatar_asset_manifest(&final_dir, &local_asset_id);
        write_avatar_asset_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterAvatarAssetValidationStatus::Valid {
            return Err(format!(
                "final Avatar asset failed validation: {:?}",
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
                let validation = validate_avatar_asset_manifest(&final_dir, &local_asset_id);
                if validation.status != AgentCenterAvatarAssetValidationStatus::Valid {
                    remove_dir_if_exists(&final_dir);
                }
            }
            return Err(error);
        }
    };

    if selected {
        let embedded = final_dir
            .join(&entry_file)
            .parent()
            .map(|parent| parent.join("nimi").join("live2d-adapter.json").is_file())
            .unwrap_or(false);
        select_imported_avatar_asset(
            &account_id,
            &scope,
            payload.kind,
            &local_asset_id,
            &backend_capability_profile_ref,
            embedded,
        )?;
    }
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset_import",
        kind,
        &local_asset_id,
        "completed",
        "user_imported",
    )?;

    Ok(DesktopAgentCenterAvatarAssetImportResult {
        local_asset_id,
        backend_kind: payload.kind,
        selected,
        materialization_ref,
        backend_capability_profile_ref,
        validation,
    })
}

pub(super) fn select_imported_background(
    account_id: &str,
    scope: &LocalAgentScope,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    config.modules.appearance.background_asset_id = Some(background_asset_id.to_string());
    desktop_agent_center_config_put_blocking(
        account_id,
        DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        },
    )?;
    Ok(())
}

pub(super) fn clear_selected_background(
    account_id: &str,
    scope: &LocalAgentScope,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    if config.modules.appearance.background_asset_id.as_deref() == Some(background_asset_id) {
        config.modules.appearance.background_asset_id = None;
        desktop_agent_center_config_put_blocking(
            account_id,
            DesktopAgentCenterConfigPutPayload {
                account_id: account_id.to_string(),
                owner_user_id: scope.owner_user_id.clone(),
                realm_agent_id: scope.realm_agent_id.clone(),
                local_agent_ref: scope.local_agent_ref.clone(),
                config,
            },
        )?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_background_import(
    payload: DesktopAgentCenterBackgroundImportPayload,
) -> Result<DesktopAgentCenterBackgroundImportResult, String> {
    let account_id = crate::desktop_agent_center_store::active_agent_center_account_id().await?;
    let mut payload = payload;
    payload.account_id = account_id;
    run_agent_center_resource_blocking("desktop_agent_center_background_import", move || {
        desktop_agent_center_background_import_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_background_import_blocking(
    payload: DesktopAgentCenterBackgroundImportPayload,
) -> Result<DesktopAgentCenterBackgroundImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
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
    let final_dir = background_dir(&account_id, &scope.local_agent_ref, &background_asset_id)?;
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
            select_imported_background(&account_id, &scope, &background_asset_id)?;
        }
        let _ = record_resource_operation(
            &account_id,
            &scope.local_agent_ref,
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

    let staging_dir = agent_center_dir(&account_id, &scope.local_agent_ref)?
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
        select_imported_background(&account_id, &scope, &background_asset_id)?;
    }
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
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
pub(crate) async fn desktop_agent_center_live2d_adapter_manifest_import(
    payload: DesktopAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<DesktopAgentCenterLive2dAdapterManifestImportResult, String> {
    let account_id = crate::desktop_agent_center_store::active_agent_center_account_id().await?;
    let mut payload = payload;
    payload.account_id = account_id;
    run_agent_center_resource_blocking(
        "desktop_agent_center_live2d_adapter_manifest_import",
        move || desktop_agent_center_live2d_adapter_manifest_import_blocking(payload),
    )
    .await
}

pub(crate) fn desktop_agent_center_live2d_adapter_manifest_import_blocking(
    payload: DesktopAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<DesktopAgentCenterLive2dAdapterManifestImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    validate_local_asset_id(&payload.local_asset_id, "localAssetId")?;
    if !payload.local_asset_id.starts_with("live2d_") {
        return Err("localAssetId must reference a Live2D asset".to_string());
    }
    let source_path = PathBuf::from(&payload.source_path);
    let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
        format!(
            "failed to read Live2D adapter manifest metadata ({}): {error}",
            source_path.display()
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err("Live2D adapter manifest source path must not be a symlink".to_string());
    }
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve Live2D adapter manifest source ({}): {error}",
            source_path.display()
        )
    })?;
    if !metadata.is_file() || extension_for(&source.to_string_lossy()) != "json" {
        return Err("Live2D adapter manifest source must be a .json file".to_string());
    }
    let bytes = metadata.len();
    if bytes == 0 || bytes > MAX_LIVE2D_ADAPTER_MANIFEST_BYTES {
        return Err("Live2D adapter manifest is outside the fixed byte cap".to_string());
    }
    let raw = fs::read(&source).map_err(|error| {
        format!(
            "failed to read Live2D adapter manifest source ({}): {error}",
            source.display()
        )
    })?;
    let value: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Live2D adapter manifest JSON is invalid: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Live2D adapter manifest must be a JSON object".to_string())?;
    if object
        .get("manifest_kind")
        .and_then(serde_json::Value::as_str)
        != Some("nimi.avatar.live2d.adapter")
    {
        return Err("Live2D adapter manifest_kind must be nimi.avatar.live2d.adapter".to_string());
    }
    if object
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err("Live2D adapter manifest schema_version must be 1".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(&raw);
    let sha256 = format!("{:x}", hasher.finalize());
    let manifest_ref = format!("live2d_adapter_{}", &sha256[..12]);
    validate_live2d_adapter_manifest_ref(&manifest_ref, "live2dAdapterManifestRef")?;
    let final_dir =
        live2d_adapter_manifest_dir(&account_id, &scope.local_agent_ref, &manifest_ref)?;
    let selected = payload.select.unwrap_or(true);
    let imported_at = checked_at();

    if !final_dir.exists() {
        fs::create_dir_all(&final_dir).map_err(|error| {
            format!(
                "failed to create Live2D adapter manifest directory ({}): {error}",
                final_dir.display()
            )
        })?;
        fs::write(final_dir.join(LIVE2D_ADAPTER_FILE_NAME), &raw).map_err(|error| {
            format!(
                "failed to write Live2D adapter manifest custody file ({}): {error}",
                final_dir.display()
            )
        })?;
    }
    let custody = Live2dAdapterManifestCustody {
        custody_version: 1,
        manifest_ref: manifest_ref.clone(),
        local_asset_id: payload.local_asset_id.clone(),
        manifest_kind: "nimi.avatar.live2d.adapter".to_string(),
        schema_version: 1,
        sha256: sha256.clone(),
        bytes,
        imported_at: imported_at.clone(),
        source_label: source_label_for(&source),
    };
    write_json_pretty(&final_dir.join(LIVE2D_ADAPTER_CUSTODY_FILE_NAME), &custody)?;

    if selected {
        select_imported_live2d_adapter_manifest(
            &account_id,
            &scope,
            &payload.local_asset_id,
            &manifest_ref,
        )?;
    }
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "live2d_adapter_manifest_import",
        "avatar_asset",
        &manifest_ref,
        "completed",
        "user_imported",
    )?;

    Ok(DesktopAgentCenterLive2dAdapterManifestImportResult {
        manifest_ref,
        local_asset_id: payload.local_asset_id,
        selected,
        sha256,
        bytes,
        imported_at,
    })
}
