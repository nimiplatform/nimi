use super::*;

#[derive(Debug, Clone)]
struct AvatarPackageSourceFile {
    source_path: PathBuf,
    package_path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifest {
    manifest_version: u8,
    package_version: String,
    package_id: String,
    kind: String,
    loader_min_version: String,
    display_name: String,
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AvatarPackageManifestFile>,
    limits: AvatarPackageManifestLimits,
    capabilities: serde_json::Value,
    import: AvatarPackageManifestImport,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestLimits {
    max_manifest_bytes: u64,
    max_package_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarCapabilityProfile {
    schema_version: u8,
    profile_ref: String,
    package_id: String,
    backend_kind: String,
    evidence_ref: String,
    file_count: usize,
    package_bytes: u64,
    generated_motion_supported: bool,
    embedded_live2d_adapter_manifest: bool,
    imported_at: String,
}

fn avatar_backend_kind_label(kind: AgentCenterAvatarBackendKind) -> Result<&'static str, String> {
    match kind {
        AgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        AgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        AgentCenterAvatarBackendKind::Future => {
            Err("future avatar backend cannot import a local package".to_string())
        }
    }
}

fn avatar_backend_kind_mime(kind: AgentCenterAvatarBackendKind, relative_path: &str) -> String {
    let extension = extension_for(relative_path);
    match (kind, extension.as_str()) {
        (AgentCenterAvatarBackendKind::Vrm, "vrm") => "model/vrm".to_string(),
        (_, "json") => "application/json".to_string(),
        (_, "png") => "image/png".to_string(),
        (_, "jpg" | "jpeg") => "image/jpeg".to_string(),
        (_, "webp") => "image/webp".to_string(),
        (_, "moc3" | "mtn" | "physics3") => "application/octet-stream".to_string(),
        (_, "vrma") => "model/vrma".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn collect_live2d_source_files(root: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    let mut files = Vec::new();
    let mut model3_files = Vec::new();
    fn visit(
        dir: &Path,
        files: &mut Vec<PathBuf>,
        model3_files: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|error| {
            format!(
                "failed to read Live2D package directory ({}): {error}",
                dir.display()
            )
        })? {
            let entry =
                entry.map_err(|error| format!("failed to read Live2D package entry: {error}"))?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "failed to inspect Live2D package entry ({}): {error}",
                    path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Live2D package must not contain symlinks ({})",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                visit(&path, files, model3_files)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            if path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.ends_with(".model3.json"))
                .unwrap_or(false)
            {
                model3_files.push(path.clone());
            }
            files.push(path);
        }
        Ok(())
    }
    visit(root, &mut files, &mut model3_files)?;
    match model3_files.len() {
        1 => Ok((files, model3_files.remove(0))),
        0 => Err("Live2D package must contain exactly one .model3.json file".to_string()),
        _ => Err(
            "Live2D package contains multiple .model3.json files; select a single model folder"
                .to_string(),
        ),
    }
}

fn collect_vrm_source_files(source: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    if extension_for(&source.to_string_lossy()) != "vrm" {
        return Err("VRM package source must be a .vrm file".to_string());
    }
    let mut files = vec![source.to_path_buf()];
    if let Some(parent) = source.parent() {
        let presets = parent.join("vrm-motion-presets");
        if presets.is_dir() {
            fn visit(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
                for entry in fs::read_dir(dir).map_err(|error| {
                    format!(
                        "failed to read VRM motion preset directory ({}): {error}",
                        dir.display()
                    )
                })? {
                    let entry = entry.map_err(|error| {
                        format!("failed to read VRM motion preset entry: {error}")
                    })?;
                    let path = entry.path();
                    let metadata = fs::symlink_metadata(&path).map_err(|error| {
                        format!(
                            "failed to inspect VRM motion preset entry ({}): {error}",
                            path.display()
                        )
                    })?;
                    if metadata.file_type().is_symlink() {
                        return Err(format!(
                            "VRM motion preset package must not contain symlinks ({})",
                            path.display()
                        ));
                    }
                    if metadata.is_dir() {
                        visit(&path, files)?;
                    } else if metadata.is_file() {
                        files.push(path);
                    }
                }
                Ok(())
            }
            visit(&presets, &mut files)?;
        }
    }
    Ok((files, source.to_path_buf()))
}

fn package_relative_path(
    kind: AgentCenterAvatarBackendKind,
    root: &Path,
    entry_source: &Path,
    source_path: &Path,
) -> Result<String, String> {
    let relative = match kind {
        AgentCenterAvatarBackendKind::Live2d => source_path
            .strip_prefix(root)
            .map_err(|error| {
                format!(
                    "Live2D package file is outside selected root ({}): {error}",
                    source_path.display()
                )
            })?
            .to_path_buf(),
        AgentCenterAvatarBackendKind::Vrm => {
            if source_path == entry_source {
                source_path
                    .file_name()
                    .map(PathBuf::from)
                    .ok_or_else(|| "VRM package source has no file name".to_string())?
            } else {
                let parent = entry_source
                    .parent()
                    .ok_or_else(|| "VRM package source has no parent directory".to_string())?;
                source_path
                    .strip_prefix(parent)
                    .map_err(|error| {
                        format!(
                            "VRM package sidecar file is outside selected root ({}): {error}",
                            source_path.display()
                        )
                    })?
                    .to_path_buf()
            }
        }
        AgentCenterAvatarBackendKind::Future => {
            return Err("future avatar backend cannot import a local package".to_string());
        }
    };
    let text = relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");
    if !is_safe_relative_path(&text) {
        return Err(format!("avatar package file path is not admitted: {text}"));
    }
    Ok(format!("files/{text}"))
}

fn collect_avatar_package_files(
    kind: AgentCenterAvatarBackendKind,
    source: &Path,
) -> Result<(Vec<AvatarPackageSourceFile>, String, u64), String> {
    let canonical_source = fs::canonicalize(source).map_err(|error| {
        format!(
            "failed to resolve avatar package source ({}): {error}",
            source.display()
        )
    })?;
    let source_metadata = fs::symlink_metadata(&canonical_source).map_err(|error| {
        format!(
            "failed to read avatar package source metadata ({}): {error}",
            canonical_source.display()
        )
    })?;
    if source_metadata.file_type().is_symlink() {
        return Err("avatar package source must not be a symlink".to_string());
    }
    let (raw_files, entry_source) = match kind {
        AgentCenterAvatarBackendKind::Live2d => {
            if !source_metadata.is_dir() {
                return Err("Live2D package source must be a folder".to_string());
            }
            collect_live2d_source_files(&canonical_source)?
        }
        AgentCenterAvatarBackendKind::Vrm => {
            if !source_metadata.is_file() {
                return Err("VRM package source must be a file".to_string());
            }
            collect_vrm_source_files(&canonical_source)?
        }
        AgentCenterAvatarBackendKind::Future => {
            return Err("future avatar backend cannot import a local package".to_string());
        }
    };
    if raw_files.is_empty() {
        return Err("avatar package source contains no files".to_string());
    }
    if raw_files.len() > MAX_AVATAR_PACKAGE_FILE_COUNT {
        return Err("avatar package exceeds the fixed file count cap".to_string());
    }
    let mut out = Vec::with_capacity(raw_files.len());
    let mut package_bytes = 0_u64;
    for file in raw_files {
        let metadata = fs::symlink_metadata(&file).map_err(|error| {
            format!(
                "failed to inspect avatar package file ({}): {error}",
                file.display()
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "avatar package file must be a regular file ({})",
                file.display()
            ));
        }
        let bytes = metadata.len();
        if bytes == 0 || bytes > MAX_AVATAR_PACKAGE_FILE_BYTES {
            return Err(format!(
                "avatar package file is outside the fixed byte cap ({})",
                file.display()
            ));
        }
        package_bytes = package_bytes
            .checked_add(bytes)
            .ok_or_else(|| "avatar package byte count overflowed".to_string())?;
        if package_bytes > MAX_AVATAR_PACKAGE_BYTES {
            return Err("avatar package exceeds the fixed package byte cap".to_string());
        }
        let package_path = package_relative_path(kind, &canonical_source, &entry_source, &file)?;
        let (_, sha256) = sha256_file(&file).map_err(|issue| issue.message)?;
        let mime = avatar_backend_kind_mime(kind, &package_path);
        out.push(AvatarPackageSourceFile {
            source_path: file,
            package_path,
            sha256,
            bytes,
            mime,
        });
    }
    out.sort_by(|left, right| left.package_path.cmp(&right.package_path));
    let entry_file = package_relative_path(kind, &canonical_source, &entry_source, &entry_source)?;
    Ok((out, entry_file, package_bytes))
}

fn avatar_package_content_digest(files: &[AvatarPackageSourceFile]) -> String {
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(file.package_path.as_bytes());
        hasher.update([0]);
        hasher.update(file.sha256.as_bytes());
        hasher.update([0]);
        hasher.update(file.bytes.to_string().as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn avatar_package_source_fingerprint(source_path: &Path, content_digest: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_label_for(source_path).as_bytes());
    hasher.update([0]);
    hasher.update(content_digest.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn avatar_package_kind_prefix(kind: AgentCenterAvatarBackendKind) -> Result<&'static str, String> {
    match kind {
        AgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        AgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        AgentCenterAvatarBackendKind::Future => {
            Err("future avatar backend cannot import a local package".to_string())
        }
    }
}

fn select_imported_avatar_package(
    account_id: &str,
    scope: &LocalAgentScope,
    kind: AgentCenterAvatarBackendKind,
    package_id: &str,
    capability_profile_ref: &str,
    evidence_ref: &str,
    embedded_live2d_adapter_manifest: bool,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    config.modules.avatar_package.avatar_package_ref = Some(package_id.to_string());
    config.modules.avatar_package.backend_kind = kind;
    config.modules.avatar_package.backend_capability_profile_ref =
        Some(capability_profile_ref.to_string());
    config.modules.avatar_package.live2d_adapter_manifest_ref = None;
    config.modules.avatar_package.live2d_adapter_manifest_source =
        if kind == AgentCenterAvatarBackendKind::Live2d && embedded_live2d_adapter_manifest {
            AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest
        } else {
            AgentCenterLive2dAdapterManifestSource::None
        };
    config.modules.avatar_package.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_package.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: evidence_ref.to_string(),
    };
    desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
        config,
    })?;
    Ok(())
}

fn clear_selected_avatar_package(
    account_id: &str,
    scope: &LocalAgentScope,
    package_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    if config.modules.avatar_package.avatar_package_ref.as_deref() == Some(package_id) {
        config.modules.avatar_package.avatar_package_ref = None;
        config.modules.avatar_package.backend_capability_profile_ref = None;
        config.modules.avatar_package.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::None;
        config.modules.avatar_package.live2d_adapter_manifest_ref = None;
        config.modules.avatar_package.updated_at =
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        config.modules.avatar_package.provenance = AgentCenterAvatarConfigProvenance {
            source: AgentCenterAvatarConfigProvenanceSource::UserSelection,
            evidence_ref: "agent-center-avatar-package-cleared".to_string(),
        };
        desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        })?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_package_pick_live2d_source(
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select Live2D model folder")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_package_pick_vrm_source() -> Result<Option<String>, String>
{
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select VRM file")
        .add_filter("VRM", &["vrm"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_package_import(
    payload: DesktopAgentCenterAvatarPackageImportPayload,
) -> Result<DesktopAgentCenterAvatarPackageImportResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_package_import", move || {
        desktop_agent_center_avatar_package_import_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_package_import_blocking(
    payload: DesktopAgentCenterAvatarPackageImportPayload,
) -> Result<DesktopAgentCenterAvatarPackageImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let kind = payload.kind;
    let kind_label = avatar_backend_kind_label(kind)?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve avatar package source ({}): {error}",
            source_path.display()
        )
    })?;
    let (files, entry_file, package_bytes) = collect_avatar_package_files(kind, &source)?;
    let content_digest = avatar_package_content_digest(&files);
    let prefix = avatar_package_kind_prefix(kind)?;
    let package_id = format!("{prefix}_{}", &content_digest[..12]);
    validate_package_id(&package_id, "packageId")?;
    let capability_profile_ref = format!("avatar_profile_{prefix}_{}", &content_digest[..12]);
    validate_normalized_id(&capability_profile_ref, "backendCapabilityProfileRef")?;
    let imported_at = checked_at();
    let selected = payload.select.unwrap_or(true);
    let display_name = safe_display_name(payload.display_name, &source)?;
    let embedded_live2d_adapter_manifest = kind == AgentCenterAvatarBackendKind::Live2d
        && files
            .iter()
            .any(|file| file.package_path == "files/nimi/live2d-adapter.json");
    let generated_motion_supported = kind == AgentCenterAvatarBackendKind::Vrm
        && files
            .iter()
            .any(|file| file.package_path.starts_with("files/vrm-motion-presets/"));
    let final_dir = avatar_package_dir(&account_id, &scope.local_agent_ref, kind, &package_id)?;

    if final_dir.exists() {
        if selected {
            select_imported_avatar_package(
                &account_id,
                &scope,
                kind,
                &package_id,
                &capability_profile_ref,
                &package_id,
                embedded_live2d_adapter_manifest,
            )?;
        }
        let manifest_raw = fs::read(final_dir.join(MANIFEST_FILE_NAME))
            .map_err(|error| format!("failed to read existing avatar package manifest: {error}"))?;
        let mut hasher = Sha256::new();
        hasher.update(&manifest_raw);
        let manifest_sha256 = format!("{:x}", hasher.finalize());
        let _ = record_resource_operation(
            &account_id,
            &scope.local_agent_ref,
            "avatar_package_import_reuse",
            "avatar_package",
            &package_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterAvatarPackageImportResult {
            package_id,
            backend_kind: kind,
            backend_capability_profile_ref: capability_profile_ref,
            selected,
            manifest_sha256,
            package_bytes,
            file_count: files.len(),
            imported_at,
        });
    }

    let staging_dir = agent_center_dir(&account_id, &scope.local_agent_ref)?
        .join("modules")
        .join("avatar_package")
        .join("staging")
        .join(format!(
            "{}_{}",
            package_id,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
    remove_dir_if_exists(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "failed to create avatar package staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        for file in &files {
            let target = staging_dir.join(&file.package_path);
            let parent = target
                .parent()
                .ok_or_else(|| "avatar package target path has no parent".to_string())?;
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create avatar package file directory ({}): {error}",
                    parent.display()
                )
            })?;
            fs::copy(&file.source_path, &target).map_err(|error| {
                format!(
                    "failed to copy avatar package file ({} -> {}): {error}",
                    file.source_path.display(),
                    target.display()
                )
            })?;
        }
        let manifest = AvatarPackageManifest {
            manifest_version: 1,
            package_version: "1.0.0".to_string(),
            package_id: package_id.clone(),
            kind: kind_label.to_string(),
            loader_min_version: "1.0.0".to_string(),
            display_name,
            display_name_i18n: serde_json::Map::new(),
            entry_file: entry_file.clone(),
            required_files: vec![entry_file],
            content_digest: content_digest.clone(),
            files: files
                .iter()
                .map(|file| AvatarPackageManifestFile {
                    path: file.package_path.clone(),
                    sha256: file.sha256.clone(),
                    bytes: file.bytes,
                    mime: file.mime.clone(),
                })
                .collect(),
            limits: AvatarPackageManifestLimits {
                max_manifest_bytes: MAX_AVATAR_PACKAGE_MANIFEST_BYTES,
                max_package_bytes: MAX_AVATAR_PACKAGE_BYTES,
                max_file_bytes: MAX_AVATAR_PACKAGE_FILE_BYTES,
                max_file_count: MAX_AVATAR_PACKAGE_FILE_COUNT,
            },
            capabilities: serde_json::json!({
                "backend_kind": kind_label,
                "generated_motion_supported": generated_motion_supported,
                "embedded_live2d_adapter_manifest": embedded_live2d_adapter_manifest,
                "capability_profile_ref": capability_profile_ref,
            }),
            import: AvatarPackageManifestImport {
                imported_at: imported_at.clone(),
                source_label: source_label_for(&source),
                source_fingerprint: avatar_package_source_fingerprint(&source, &content_digest),
            },
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let manifest_meta = fs::metadata(staging_dir.join(MANIFEST_FILE_NAME))
            .map_err(|error| format!("failed to inspect avatar package manifest: {error}"))?;
        if manifest_meta.len() > MAX_AVATAR_PACKAGE_MANIFEST_BYTES {
            return Err("avatar package manifest exceeds the fixed byte cap".to_string());
        }
        let profile = AvatarCapabilityProfile {
            schema_version: 1,
            profile_ref: capability_profile_ref.clone(),
            package_id: package_id.clone(),
            backend_kind: kind_label.to_string(),
            evidence_ref: package_id.clone(),
            file_count: files.len(),
            package_bytes,
            generated_motion_supported,
            embedded_live2d_adapter_manifest,
            imported_at: imported_at.clone(),
        };
        write_json_pretty(&staging_dir.join(CAPABILITY_PROFILE_FILE_NAME), &profile)?;
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
        Ok::<_, String>(())
    })();

    if let Err(error) = import_result {
        remove_dir_if_exists(&staging_dir);
        if final_dir.exists() {
            remove_dir_if_exists(&final_dir);
        }
        return Err(error);
    }

    if selected {
        select_imported_avatar_package(
            &account_id,
            &scope,
            kind,
            &package_id,
            &capability_profile_ref,
            &package_id,
            embedded_live2d_adapter_manifest,
        )?;
    }
    let manifest_raw = fs::read(final_dir.join(MANIFEST_FILE_NAME))
        .map_err(|error| format!("failed to read avatar package manifest: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&manifest_raw);
    let manifest_sha256 = format!("{:x}", hasher.finalize());
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "avatar_package_import",
        "avatar_package",
        &package_id,
        "completed",
        "user_imported",
    )?;
    Ok(DesktopAgentCenterAvatarPackageImportResult {
        package_id,
        backend_kind: kind,
        backend_capability_profile_ref: capability_profile_ref,
        selected,
        manifest_sha256,
        package_bytes,
        file_count: files.len(),
        imported_at,
    })
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_package_remove(
    payload: DesktopAgentCenterAvatarPackageRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_package_remove", move || {
        desktop_agent_center_avatar_package_remove_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_package_remove_blocking(
    payload: DesktopAgentCenterAvatarPackageRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    validate_package_id(&payload.package_id, "packageId")?;
    let kind = if payload.package_id.starts_with("live2d_") {
        AgentCenterAvatarBackendKind::Live2d
    } else {
        AgentCenterAvatarBackendKind::Vrm
    };
    clear_selected_avatar_package(&account_id, &scope, &payload.package_id)?;
    let source = avatar_package_dir(
        &account_id,
        &scope.local_agent_ref,
        kind,
        &payload.package_id,
    )?;
    let destination = quarantine_path(
        &account_id,
        &scope.local_agent_ref,
        "avatar_package",
        &payload.package_id,
    )?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                &account_id,
                &scope.local_agent_ref,
                "avatar_package_quarantine",
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
        &scope.local_agent_ref,
        "avatar_package_quarantine",
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
