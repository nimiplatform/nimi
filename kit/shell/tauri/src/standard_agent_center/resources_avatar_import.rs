use super::*;

fn backend_kind_id(kind: StandardAgentCenterAvatarBackendKind) -> Result<&'static str, String> {
    match kind {
        StandardAgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        StandardAgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        StandardAgentCenterAvatarBackendKind::Future => {
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

pub(crate) fn standard_agent_center_avatar_asset_import_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarAssetImportPayload,
) -> Result<StandardAgentCenterAvatarAssetImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    validate_local_agent_host_scope(&payload.host_scope)?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.runtime_source_ref,
        &payload.local_agent_ref,
    )?;
    let kind = backend_kind_id(payload.backend_kind)?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve Avatar asset source ({}): {error}",
            source_path.display()
        )
    })?;
    require_file_dialog_selected_source(&source, "agent_center_avatar_asset_import")?;
    let (files, entry_file) = read_avatar_source_files(kind, &source)?;
    let content_digest = avatar_content_digest(&files);
    let local_asset_id = format!("{kind}_{}", &content_digest[..12]);
    validate_local_asset_id(&local_asset_id, "localAssetId")?;
    let final_dir = avatar_asset_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        kind,
        &local_asset_id,
    )?;
    let selected = payload.select.unwrap_or(true);
    let backend_capability_profile_ref = backend_capability_profile_ref_for(kind, &local_asset_id);
    let materialization_ref =
        materialization_ref_for(&account_id, &scope.local_agent_ref, kind, &local_asset_id);

    if final_dir.exists() {
        let validation = validate_avatar_asset_manifest(&final_dir, &local_asset_id);
        write_avatar_asset_validation_sidecar(&final_dir, &validation)?;
        if validation.status != StandardAgentCenterAvatarAssetValidationStatus::Valid {
            return Err(format!(
                "Avatar asset id collision exists but is not valid: {local_asset_id}"
            ));
        }
        let _ = record_resource_operation(
            roots,
            &account_id,
            &scope.local_agent_ref,
            "avatar_asset_import_reuse",
            kind,
            &local_asset_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(StandardAgentCenterAvatarAssetImportResult {
            local_asset_id,
            backend_kind: payload.backend_kind,
            selected,
            materialization_ref,
            backend_capability_profile_ref,
            validation,
        });
    }

    let staging_dir = agent_center_dir(roots, &account_id, &scope.local_agent_ref)?
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
        if staging_validation.status != StandardAgentCenterAvatarAssetValidationStatus::Valid {
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
        if validation.status != StandardAgentCenterAvatarAssetValidationStatus::Valid {
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
                if validation.status != StandardAgentCenterAvatarAssetValidationStatus::Valid {
                    remove_dir_if_exists(&final_dir);
                }
            }
            return Err(error);
        }
    };

    let _ = record_resource_operation(
        roots,
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset_import",
        kind,
        &local_asset_id,
        "completed",
        "user_imported",
    )?;

    Ok(StandardAgentCenterAvatarAssetImportResult {
        local_asset_id,
        backend_kind: payload.backend_kind,
        selected,
        materialization_ref,
        backend_capability_profile_ref,
        validation,
    })
}
