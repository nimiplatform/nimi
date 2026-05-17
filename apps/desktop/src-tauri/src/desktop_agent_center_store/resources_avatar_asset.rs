use super::*;

#[derive(Debug, Clone)]
struct AvatarAssetSourceFile {
    source_path: PathBuf,
    asset_path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifest {
    manifest_version: u8,
    asset_version: String,
    local_asset_id: String,
    kind: String,
    loader_min_version: String,
    display_name: String,
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AvatarAssetManifestFile>,
    limits: AvatarAssetManifestLimits,
    capabilities: serde_json::Value,
    import: AvatarAssetManifestImport,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifestLimits {
    max_manifest_bytes: u64,
    max_asset_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarCapabilityProfile {
    schema_version: u8,
    profile_ref: String,
    local_asset_id: String,
    backend_kind: String,
    evidence_ref: String,
    file_count: usize,
    asset_bytes: u64,
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

fn avatar_asset_validation_result(
    local_asset_id: Option<String>,
    backend_kind: Option<AgentCenterAvatarBackendKind>,
    backend_capability_profile_ref: Option<String>,
    status: AgentCenterAvatarAssetValidationStatus,
    errors: Vec<AgentCenterValidationIssue>,
    warnings: Vec<AgentCenterValidationIssue>,
) -> AgentCenterAvatarAssetValidationResult {
    AgentCenterAvatarAssetValidationResult {
        schema_version: VALIDATION_SCHEMA_VERSION,
        local_asset_id,
        backend_kind,
        backend_capability_profile_ref,
        checked_at: checked_at(),
        status,
        errors,
        warnings,
    }
}

fn status_for_avatar_asset_errors(
    errors: &[AgentCenterValidationIssue],
) -> AgentCenterAvatarAssetValidationStatus {
    if errors.iter().any(|entry| entry.code == "selection_missing") {
        return AgentCenterAvatarAssetValidationStatus::SelectionMissing;
    }
    if errors.iter().any(|entry| entry.code == "unsupported_backend") {
        return AgentCenterAvatarAssetValidationStatus::UnsupportedBackend;
    }
    if errors.iter().any(|entry| entry.code == "avatar_asset_missing") {
        return AgentCenterAvatarAssetValidationStatus::AssetMissing;
    }
    if errors.iter().any(|entry| entry.code == "path_rejected") {
        return AgentCenterAvatarAssetValidationStatus::PathRejected;
    }
    if errors.iter().any(|entry| entry.code == "permission_denied") {
        return AgentCenterAvatarAssetValidationStatus::PermissionDenied;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "missing_entry" || entry.code == "missing_required_file")
    {
        return AgentCenterAvatarAssetValidationStatus::MissingEntry;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "content_digest_mismatch")
    {
        return AgentCenterAvatarAssetValidationStatus::DigestMismatch;
    }
    AgentCenterAvatarAssetValidationStatus::InvalidManifest
}

fn write_avatar_asset_validation_sidecar(
    asset_dir: &Path,
    result: &AgentCenterAvatarAssetValidationResult,
) -> Result<(), String> {
    if !asset_dir.exists() {
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(result).map_err(|error| {
        format!("failed to serialize avatar asset validation sidecar: {error}")
    })?;
    fs::write(asset_dir.join(VALIDATION_FILE_NAME), raw)
        .map_err(|error| format!("failed to write avatar asset validation sidecar: {error}"))
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
                "failed to read Live2D asset directory ({}): {error}",
                dir.display()
            )
        })? {
            let entry =
                entry.map_err(|error| format!("failed to read Live2D asset entry: {error}"))?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "failed to inspect Live2D asset entry ({}): {error}",
                    path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Live2D asset must not contain symlinks ({})",
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
        0 => Err("Live2D asset must contain exactly one .model3.json file".to_string()),
        _ => Err(
            "Live2D asset contains multiple .model3.json files; select a single model folder"
                .to_string(),
        ),
    }
}

fn collect_vrm_source_files(source: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    if extension_for(&source.to_string_lossy()) != "vrm" {
        return Err("VRM asset source must be a .vrm file".to_string());
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

fn asset_relative_path(
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
                    "Live2D asset file is outside selected root ({}): {error}",
                    source_path.display()
                )
            })?
            .to_path_buf(),
        AgentCenterAvatarBackendKind::Vrm => {
            if source_path == entry_source {
                source_path
                    .file_name()
                    .map(PathBuf::from)
                    .ok_or_else(|| "VRM asset source has no file name".to_string())?
            } else {
                let parent = entry_source
                    .parent()
                    .ok_or_else(|| "VRM asset source has no parent directory".to_string())?;
                source_path
                    .strip_prefix(parent)
                    .map_err(|error| {
                        format!(
                            "VRM asset sidecar file is outside selected root ({}): {error}",
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
        return Err(format!("avatar asset file path is not admitted: {text}"));
    }
    Ok(format!("files/{text}"))
}

fn collect_avatar_asset_files(
    kind: AgentCenterAvatarBackendKind,
    source: &Path,
) -> Result<(Vec<AvatarAssetSourceFile>, String, u64), String> {
    let canonical_source = fs::canonicalize(source).map_err(|error| {
        format!(
            "failed to resolve avatar asset source ({}): {error}",
            source.display()
        )
    })?;
    let source_metadata = fs::symlink_metadata(&canonical_source).map_err(|error| {
        format!(
            "failed to read avatar asset source metadata ({}): {error}",
            canonical_source.display()
        )
    })?;
    if source_metadata.file_type().is_symlink() {
        return Err("avatar asset source must not be a symlink".to_string());
    }
    let (raw_files, entry_source) = match kind {
        AgentCenterAvatarBackendKind::Live2d => {
            if !source_metadata.is_dir() {
                return Err("Live2D asset source must be a folder".to_string());
            }
            collect_live2d_source_files(&canonical_source)?
        }
        AgentCenterAvatarBackendKind::Vrm => {
            if !source_metadata.is_file() {
                return Err("VRM asset source must be a file".to_string());
            }
            collect_vrm_source_files(&canonical_source)?
        }
        AgentCenterAvatarBackendKind::Future => {
            return Err("future avatar backend cannot import a local package".to_string());
        }
    };
    if raw_files.is_empty() {
        return Err("avatar asset source contains no files".to_string());
    }
    if raw_files.len() > MAX_AVATAR_ASSET_FILE_COUNT {
        return Err("avatar asset exceeds the fixed file count cap".to_string());
    }
    let mut out = Vec::with_capacity(raw_files.len());
    let mut asset_bytes = 0_u64;
    for file in raw_files {
        let metadata = fs::symlink_metadata(&file).map_err(|error| {
            format!(
                "failed to inspect avatar asset file ({}): {error}",
                file.display()
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "avatar asset file must be a regular file ({})",
                file.display()
            ));
        }
        let bytes = metadata.len();
        if bytes == 0 || bytes > MAX_AVATAR_ASSET_FILE_BYTES {
            return Err(format!(
                "avatar asset file is outside the fixed byte cap ({})",
                file.display()
            ));
        }
        asset_bytes = asset_bytes
            .checked_add(bytes)
            .ok_or_else(|| "avatar asset byte count overflowed".to_string())?;
        if asset_bytes > MAX_AVATAR_ASSET_BYTES {
            return Err("avatar asset exceeds the fixed asset byte cap".to_string());
        }
        let asset_path = asset_relative_path(kind, &canonical_source, &entry_source, &file)?;
        let (_, sha256) = sha256_file(&file).map_err(|issue| issue.message)?;
        let mime = avatar_backend_kind_mime(kind, &asset_path);
        out.push(AvatarAssetSourceFile {
            source_path: file,
            asset_path,
            sha256,
            bytes,
            mime,
        });
    }
    out.sort_by(|left, right| left.asset_path.cmp(&right.asset_path));
    let entry_file = asset_relative_path(kind, &canonical_source, &entry_source, &entry_source)?;
    Ok((out, entry_file, asset_bytes))
}

fn avatar_asset_content_digest(files: &[AvatarAssetSourceFile]) -> String {
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(file.asset_path.as_bytes());
        hasher.update([0]);
        hasher.update(file.sha256.as_bytes());
        hasher.update([0]);
        hasher.update(file.bytes.to_string().as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn avatar_asset_source_fingerprint(source_path: &Path, content_digest: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_label_for(source_path).as_bytes());
    hasher.update([0]);
    hasher.update(content_digest.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn avatar_asset_kind_prefix(kind: AgentCenterAvatarBackendKind) -> Result<&'static str, String> {
    match kind {
        AgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        AgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        AgentCenterAvatarBackendKind::Future => {
            Err("future avatar backend cannot import a local package".to_string())
        }
    }
}

fn select_imported_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    kind: AgentCenterAvatarBackendKind,
    local_asset_id: &str,
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
    config.modules.avatar_asset.local_avatar_asset_ref = Some(local_asset_id.to_string());
    config.modules.avatar_asset.backend_kind = kind;
    config.modules.avatar_asset.backend_capability_profile_ref =
        Some(capability_profile_ref.to_string());
    config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
    config.modules.avatar_asset.live2d_adapter_manifest_source =
        if kind == AgentCenterAvatarBackendKind::Live2d && embedded_live2d_adapter_manifest {
            AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest
        } else {
            AgentCenterLive2dAdapterManifestSource::None
        };
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
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

fn clear_selected_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    local_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    if config.modules.avatar_asset.local_avatar_asset_ref.as_deref() == Some(local_asset_id) {
        config.modules.avatar_asset.local_avatar_asset_ref = None;
        config.modules.avatar_asset.backend_capability_profile_ref = None;
        config.modules.avatar_asset.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::None;
        config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
        config.modules.avatar_asset.updated_at =
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
            source: AgentCenterAvatarConfigProvenanceSource::UserSelection,
            evidence_ref: "agent-center-avatar-asset-cleared".to_string(),
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

fn validate_avatar_asset_manifest(
    asset_root: &Path,
    expected_local_asset_id: &str,
    expected_kind: AgentCenterAvatarBackendKind,
    expected_capability_profile_ref: &str,
) -> AgentCenterAvatarAssetValidationResult {
    let mut errors = Vec::<AgentCenterValidationIssue>::new();
    let kind_label = match avatar_backend_kind_label(expected_kind) {
        Ok(label) => label,
        Err(message) => {
            return avatar_asset_validation_result(
                Some(expected_local_asset_id.to_string()),
                Some(expected_kind),
                Some(expected_capability_profile_ref.to_string()),
                AgentCenterAvatarAssetValidationStatus::UnsupportedBackend,
                vec![error("unsupported_backend", &message, Some("backend_kind".to_string()))],
                vec![],
            );
        }
    };
    let manifest_path = asset_root.join(MANIFEST_FILE_NAME);
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return avatar_asset_validation_result(
                Some(expected_local_asset_id.to_string()),
                Some(expected_kind),
                Some(expected_capability_profile_ref.to_string()),
                AgentCenterAvatarAssetValidationStatus::AssetMissing,
                vec![error(
                    "avatar_asset_missing",
                    &format!("Avatar asset manifest is missing: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest = match serde_json::from_str::<AvatarAssetManifest>(&raw) {
        Ok(manifest) => manifest,
        Err(source) => {
            return avatar_asset_validation_result(
                Some(expected_local_asset_id.to_string()),
                Some(expected_kind),
                Some(expected_capability_profile_ref.to_string()),
                AgentCenterAvatarAssetValidationStatus::InvalidManifest,
                vec![error(
                    "avatar_asset_manifest_invalid",
                    &format!("Avatar asset manifest is malformed: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    if manifest.manifest_version != 1 {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "manifest_version must be 1.",
            Some("manifest_version".to_string()),
        ));
    }
    if manifest.local_asset_id != expected_local_asset_id {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "local_asset_id must match the selected local asset.",
            Some("local_asset_id".to_string()),
        ));
    }
    if manifest.kind != kind_label {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "kind must match the selected backend kind.",
            Some("kind".to_string()),
        ));
    }
    if let Err(message) = validate_local_asset_id(&manifest.local_asset_id, "local_asset_id") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            &message,
            Some("local_asset_id".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    if let Err(issue) = validate_display_text(&manifest.import.source_label, "source_label", 120) {
        errors.push(issue);
    }
    if Path::new(&manifest.import.source_label).is_absolute() {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "source_label must not store an absolute path.",
            Some("source_label".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.import.imported_at, "imported_at") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            &message,
            Some("imported_at".to_string()),
        ));
    }
    if !is_digest(&manifest.content_digest) {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "content_digest must be a lowercase sha256 digest.",
            Some("content_digest".to_string()),
        ));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_AVATAR_ASSET_FILE_COUNT {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "files must be non-empty and remain within the fixed file count cap.",
            Some("files".to_string()),
        ));
    }
    if manifest.limits.max_manifest_bytes != MAX_AVATAR_ASSET_MANIFEST_BYTES
        || manifest.limits.max_asset_bytes != MAX_AVATAR_ASSET_BYTES
        || manifest.limits.max_file_bytes != MAX_AVATAR_ASSET_FILE_BYTES
        || manifest.limits.max_file_count != MAX_AVATAR_ASSET_FILE_COUNT
    {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "limits must match the fixed Avatar asset caps.",
            Some("limits".to_string()),
        ));
    }
    if !is_safe_relative_path(&manifest.entry_file)
        || !manifest.entry_file.starts_with("files/")
        || match expected_kind {
            AgentCenterAvatarBackendKind::Live2d => {
                !manifest.entry_file.ends_with(".model3.json")
            }
            AgentCenterAvatarBackendKind::Vrm => extension_for(&manifest.entry_file) != "vrm",
            AgentCenterAvatarBackendKind::Future => true,
        }
    {
        errors.push(error(
            "missing_entry",
            "entry_file must be a backend-specific file inside the local Avatar asset.",
            Some("entry_file".to_string()),
        ));
    }
    let entry_declared = manifest
        .files
        .iter()
        .any(|file| file.path == manifest.entry_file);
    if !entry_declared {
        errors.push(error(
            "missing_entry",
            "entry_file must be declared in files.",
            Some(manifest.entry_file.clone()),
        ));
    }

    let mut content_digest = Sha256::new();
    for file in &manifest.files {
        if !is_safe_relative_path(&file.path) || !file.path.starts_with("files/") {
            errors.push(error(
                "path_rejected",
                "Avatar asset file path must stay under files/.",
                Some(file.path.clone()),
            ));
            continue;
        }
        if !is_digest(&file.sha256) {
            errors.push(error(
                "avatar_asset_manifest_invalid",
                "file sha256 must be a lowercase sha256 digest.",
                Some(file.path.clone()),
            ));
        }
        if file.bytes == 0 || file.bytes > MAX_AVATAR_ASSET_FILE_BYTES {
            errors.push(error(
                "avatar_asset_file_rejected",
                "Avatar asset file is outside the fixed byte cap.",
                Some(file.path.clone()),
            ));
        }
        match resolve_under_root(asset_root, &file.path).and_then(|path| sha256_file(&path)) {
            Ok((actual_bytes, actual_sha256)) => {
                if actual_bytes != file.bytes {
                    errors.push(error(
                        "file_size_mismatch",
                        "Avatar asset file size differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
                if actual_sha256 != file.sha256 {
                    errors.push(error(
                        "content_digest_mismatch",
                        "Avatar asset file digest differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
            }
            Err(mut issue) => {
                if issue.code == "missing_required_file" {
                    issue.code = "missing_entry".to_string();
                }
                errors.push(issue);
            }
        }
        content_digest.update(file.path.as_bytes());
        content_digest.update([0]);
        content_digest.update(file.sha256.as_bytes());
        content_digest.update([0]);
        content_digest.update(file.bytes.to_string().as_bytes());
        content_digest.update([0]);
    }
    let actual_content_digest = format!("{:x}", content_digest.finalize());
    if manifest.content_digest != actual_content_digest {
        errors.push(error(
            "content_digest_mismatch",
            "Avatar asset content digest differs from manifest file list.",
            Some("content_digest".to_string()),
        ));
    }

    let profile_path = asset_root.join(CAPABILITY_PROFILE_FILE_NAME);
    match fs::read_to_string(&profile_path)
        .map_err(|source| {
            error(
                "missing_required_file",
                &format!("Avatar capability profile is missing: {source}"),
                Some(CAPABILITY_PROFILE_FILE_NAME.to_string()),
            )
        })
        .and_then(|raw| {
            serde_json::from_str::<AvatarCapabilityProfile>(&raw).map_err(|source| {
                error(
                    "avatar_asset_manifest_invalid",
                    &format!("Avatar capability profile is malformed: {source}"),
                    Some(CAPABILITY_PROFILE_FILE_NAME.to_string()),
                )
            })
        }) {
        Ok(profile) => {
            if profile.schema_version != 1 {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile schema_version must be 1.",
                    Some("capability-profile.schema_version".to_string()),
                ));
            }
            if profile.profile_ref != expected_capability_profile_ref {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile ref must match selected backend evidence.",
                    Some("capability-profile.profile_ref".to_string()),
                ));
            }
            if profile.local_asset_id != expected_local_asset_id {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile local_asset_id must match selected asset.",
                    Some("capability-profile.local_asset_id".to_string()),
                ));
            }
            if profile.backend_kind != kind_label {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile backend_kind must match selected backend.",
                    Some("capability-profile.backend_kind".to_string()),
                ));
            }
        }
        Err(mut issue) => {
            if issue.code == "missing_required_file" {
                issue.code = "missing_entry".to_string();
            }
            errors.push(issue);
        }
    }

    if errors.is_empty() {
        avatar_asset_validation_result(
            Some(expected_local_asset_id.to_string()),
            Some(expected_kind),
            Some(expected_capability_profile_ref.to_string()),
            AgentCenterAvatarAssetValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_avatar_asset_errors(&errors);
        avatar_asset_validation_result(
            Some(expected_local_asset_id.to_string()),
            Some(expected_kind),
            Some(expected_capability_profile_ref.to_string()),
            status,
            errors,
            vec![],
        )
    }
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_validate(
    payload: DesktopAgentCenterAvatarAssetValidatePayload,
) -> Result<AgentCenterAvatarAssetValidationResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_validate", move || {
        desktop_agent_center_avatar_asset_validate_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_validate_blocking(
    payload: DesktopAgentCenterAvatarAssetValidatePayload,
) -> Result<AgentCenterAvatarAssetValidationResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.clone(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    let avatar = config.modules.avatar_asset;
    let local_asset_id = match avatar.local_avatar_asset_ref {
        Some(value) => value,
        None => {
            return Ok(avatar_asset_validation_result(
                None,
                Some(avatar.backend_kind),
                avatar.backend_capability_profile_ref,
                AgentCenterAvatarAssetValidationStatus::SelectionMissing,
                vec![error(
                    "selection_missing",
                    "Select a local Avatar asset before launch.",
                    Some("modules.avatar_asset.local_avatar_asset_ref".to_string()),
                )],
                vec![],
            ));
        }
    };
    validate_local_asset_id(&local_asset_id, "localAssetId")?;
    let profile_ref = match avatar.backend_capability_profile_ref {
        Some(value) => value,
        None => {
            return Ok(avatar_asset_validation_result(
                Some(local_asset_id),
                Some(avatar.backend_kind),
                None,
                AgentCenterAvatarAssetValidationStatus::SelectionMissing,
                vec![error(
                    "selection_missing",
                    "Selected Avatar asset is missing backend capability evidence.",
                    Some("modules.avatar_asset.backend_capability_profile_ref".to_string()),
                )],
                vec![],
            ));
        }
    };
    validate_normalized_id(&profile_ref, "backendCapabilityProfileRef")?;
    if avatar.backend_kind == AgentCenterAvatarBackendKind::Future {
        return Ok(avatar_asset_validation_result(
            Some(local_asset_id),
            Some(avatar.backend_kind),
            Some(profile_ref),
            AgentCenterAvatarAssetValidationStatus::UnsupportedBackend,
            vec![error(
                "unsupported_backend",
                "Future Avatar backend cannot be launched from local assets yet.",
                Some("modules.avatar_asset.backend_kind".to_string()),
            )],
            vec![],
        ));
    }
    let asset_dir = avatar_asset_dir(
        &account_id,
        &scope.local_agent_ref,
        avatar.backend_kind,
        &local_asset_id,
    )?;
    if !asset_dir.exists() {
        return Ok(avatar_asset_validation_result(
            Some(local_asset_id),
            Some(avatar.backend_kind),
            Some(profile_ref),
            AgentCenterAvatarAssetValidationStatus::AssetMissing,
            vec![error(
                "avatar_asset_missing",
                "Selected local Avatar asset directory is missing.",
                Some(asset_dir.display().to_string()),
            )],
            vec![],
        ));
    }
    let result = validate_avatar_asset_manifest(
        &asset_dir,
        &local_asset_id,
        avatar.backend_kind,
        &profile_ref,
    );
    write_avatar_asset_validation_sidecar(&asset_dir, &result)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_live2d_source(
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
pub(crate) fn desktop_agent_center_avatar_asset_pick_vrm_source() -> Result<Option<String>, String>
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
pub(crate) async fn desktop_agent_center_avatar_asset_import(
    payload: DesktopAgentCenterAvatarAssetImportPayload,
) -> Result<DesktopAgentCenterAvatarAssetImportResult, String> {
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
    let kind = payload.kind;
    let kind_label = avatar_backend_kind_label(kind)?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve avatar asset source ({}): {error}",
            source_path.display()
        )
    })?;
    let (files, entry_file, asset_bytes) = collect_avatar_asset_files(kind, &source)?;
    let content_digest = avatar_asset_content_digest(&files);
    let prefix = avatar_asset_kind_prefix(kind)?;
    let local_asset_id = format!("{prefix}_{}", &content_digest[..12]);
    validate_local_asset_id(&local_asset_id, "localAssetId")?;
    let capability_profile_ref = format!("avatar_profile_{prefix}_{}", &content_digest[..12]);
    validate_normalized_id(&capability_profile_ref, "backendCapabilityProfileRef")?;
    let imported_at = checked_at();
    let selected = payload.select.unwrap_or(true);
    let display_name = safe_display_name(payload.display_name, &source)?;
    let embedded_live2d_adapter_manifest = kind == AgentCenterAvatarBackendKind::Live2d
        && files
            .iter()
            .any(|file| file.asset_path == "files/nimi/live2d-adapter.json");
    let generated_motion_supported = kind == AgentCenterAvatarBackendKind::Vrm
        && files
            .iter()
            .any(|file| file.asset_path.starts_with("files/vrm-motion-presets/"));
    let final_dir = avatar_asset_dir(&account_id, &scope.local_agent_ref, kind, &local_asset_id)?;

    if final_dir.exists() {
        if selected {
            select_imported_avatar_asset(
                &account_id,
                &scope,
                kind,
                &local_asset_id,
                &capability_profile_ref,
                &local_asset_id,
                embedded_live2d_adapter_manifest,
            )?;
        }
        let manifest_raw = fs::read(final_dir.join(MANIFEST_FILE_NAME))
            .map_err(|error| format!("failed to read existing avatar asset manifest: {error}"))?;
        let mut hasher = Sha256::new();
        hasher.update(&manifest_raw);
        let manifest_sha256 = format!("{:x}", hasher.finalize());
        let _ = record_resource_operation(
            &account_id,
            &scope.local_agent_ref,
            "avatar_asset_import_reuse",
            "avatar_asset",
            &local_asset_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterAvatarAssetImportResult {
            local_asset_id,
            backend_kind: kind,
            backend_capability_profile_ref: capability_profile_ref,
            selected,
            manifest_sha256,
            asset_bytes,
            file_count: files.len(),
            imported_at,
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
            "failed to create avatar asset staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        for file in &files {
            let target = staging_dir.join(&file.asset_path);
            let parent = target
                .parent()
                .ok_or_else(|| "avatar asset target path has no parent".to_string())?;
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create avatar asset file directory ({}): {error}",
                    parent.display()
                )
            })?;
            fs::copy(&file.source_path, &target).map_err(|error| {
                format!(
                    "failed to copy avatar asset file ({} -> {}): {error}",
                    file.source_path.display(),
                    target.display()
                )
            })?;
        }
        let manifest = AvatarAssetManifest {
            manifest_version: 1,
            asset_version: "1.0.0".to_string(),
            local_asset_id: local_asset_id.clone(),
            kind: kind_label.to_string(),
            loader_min_version: "1.0.0".to_string(),
            display_name,
            display_name_i18n: serde_json::Map::new(),
            entry_file: entry_file.clone(),
            required_files: vec![entry_file],
            content_digest: content_digest.clone(),
            files: files
                .iter()
                .map(|file| AvatarAssetManifestFile {
                    path: file.asset_path.clone(),
                    sha256: file.sha256.clone(),
                    bytes: file.bytes,
                    mime: file.mime.clone(),
                })
                .collect(),
            limits: AvatarAssetManifestLimits {
                max_manifest_bytes: MAX_AVATAR_ASSET_MANIFEST_BYTES,
                max_asset_bytes: MAX_AVATAR_ASSET_BYTES,
                max_file_bytes: MAX_AVATAR_ASSET_FILE_BYTES,
                max_file_count: MAX_AVATAR_ASSET_FILE_COUNT,
            },
            capabilities: serde_json::json!({
                "backend_kind": kind_label,
                "generated_motion_supported": generated_motion_supported,
                "embedded_live2d_adapter_manifest": embedded_live2d_adapter_manifest,
                "capability_profile_ref": capability_profile_ref,
            }),
            import: AvatarAssetManifestImport {
                imported_at: imported_at.clone(),
                source_label: source_label_for(&source),
                source_fingerprint: avatar_asset_source_fingerprint(&source, &content_digest),
            },
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let manifest_meta = fs::metadata(staging_dir.join(MANIFEST_FILE_NAME))
            .map_err(|error| format!("failed to inspect avatar asset manifest: {error}"))?;
        if manifest_meta.len() > MAX_AVATAR_ASSET_MANIFEST_BYTES {
            return Err("avatar asset manifest exceeds the fixed byte cap".to_string());
        }
        let profile = AvatarCapabilityProfile {
            schema_version: 1,
            profile_ref: capability_profile_ref.clone(),
            local_asset_id: local_asset_id.clone(),
            backend_kind: kind_label.to_string(),
            evidence_ref: local_asset_id.clone(),
            file_count: files.len(),
            asset_bytes,
            generated_motion_supported,
            embedded_live2d_adapter_manifest,
            imported_at: imported_at.clone(),
        };
        write_json_pretty(&staging_dir.join(CAPABILITY_PROFILE_FILE_NAME), &profile)?;
        let parent = final_dir
            .parent()
            .ok_or_else(|| "avatar asset final path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create avatar asset final directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::rename(&staging_dir, &final_dir).map_err(|error| {
            format!(
                "failed to finalize avatar asset import ({} -> {}): {error}",
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
        select_imported_avatar_asset(
            &account_id,
            &scope,
            kind,
            &local_asset_id,
            &capability_profile_ref,
            &local_asset_id,
            embedded_live2d_adapter_manifest,
        )?;
    }
    let manifest_raw = fs::read(final_dir.join(MANIFEST_FILE_NAME))
        .map_err(|error| format!("failed to read avatar asset manifest: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&manifest_raw);
    let manifest_sha256 = format!("{:x}", hasher.finalize());
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset_import",
        "avatar_asset",
        &local_asset_id,
        "completed",
        "user_imported",
    )?;
    Ok(DesktopAgentCenterAvatarAssetImportResult {
        local_asset_id,
        backend_kind: kind,
        backend_capability_profile_ref: capability_profile_ref,
        selected,
        manifest_sha256,
        asset_bytes,
        file_count: files.len(),
        imported_at,
    })
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_remove(
    payload: DesktopAgentCenterAvatarAssetRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_remove", move || {
        desktop_agent_center_avatar_asset_remove_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_remove_blocking(
    payload: DesktopAgentCenterAvatarAssetRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    validate_local_asset_id(&payload.local_asset_id, "localAssetId")?;
    let kind = if payload.local_asset_id.starts_with("live2d_") {
        AgentCenterAvatarBackendKind::Live2d
    } else {
        AgentCenterAvatarBackendKind::Vrm
    };
    clear_selected_avatar_asset(&account_id, &scope, &payload.local_asset_id)?;
    let source = avatar_asset_dir(
        &account_id,
        &scope.local_agent_ref,
        kind,
        &payload.local_asset_id,
    )?;
    let destination = quarantine_path(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset",
        &payload.local_asset_id,
    )?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                &account_id,
                &scope.local_agent_ref,
                "avatar_asset_quarantine",
                "avatar_asset",
                &payload.local_asset_id,
                "failed",
                "user_removed",
            );
            return Err(error);
        }
    };
    let operation_id = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset_quarantine",
        "avatar_asset",
        &payload.local_asset_id,
        "completed",
        if quarantined {
            "user_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "avatar_asset".to_string(),
        resource_id: payload.local_asset_id,
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}
