use super::*;

pub(super) fn issue(
    code: &str,
    message: &str,
    path: Option<String>,
    severity: StandardAgentCenterValidationIssueSeverity,
) -> StandardAgentCenterValidationIssue {
    StandardAgentCenterValidationIssue {
        code: code.to_string(),
        message: message.to_string(),
        path,
        severity,
    }
}

pub(super) fn error(
    code: &str,
    message: &str,
    path: Option<String>,
) -> StandardAgentCenterValidationIssue {
    issue(
        code,
        message,
        path,
        StandardAgentCenterValidationIssueSeverity::Error,
    )
}

pub(super) fn write_background_validation_sidecar(
    background_dir: &Path,
    result: &StandardAgentCenterBackgroundValidationResult,
) -> Result<(), String> {
    if !background_dir.exists() {
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(result)
        .map_err(|error| format!("failed to serialize background validation sidecar: {error}"))?;
    fs::write(background_dir.join(VALIDATION_FILE_NAME), raw)
        .map_err(|error| format!("failed to write background validation sidecar: {error}"))
}

pub(super) fn write_avatar_asset_validation_sidecar(
    asset_dir: &Path,
    result: &StandardAgentCenterAvatarAssetValidationResult,
) -> Result<(), String> {
    if !asset_dir.exists() {
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(result)
        .map_err(|error| format!("failed to serialize Avatar asset validation sidecar: {error}"))?;
    fs::write(asset_dir.join(VALIDATION_FILE_NAME), raw)
        .map_err(|error| format!("failed to write Avatar asset validation sidecar: {error}"))
}

pub(super) fn background_dir(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    account_id: &str,
    local_agent_ref: &str,
    background_asset_id: &str,
) -> Result<PathBuf, String> {
    Ok(agent_center_dir(roots, account_id, local_agent_ref)?
        .join("modules")
        .join("appearance")
        .join("backgrounds")
        .join(background_asset_id))
}

pub(super) fn avatar_asset_dir(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    account_id: &str,
    local_agent_ref: &str,
    kind: &str,
    local_asset_id: &str,
) -> Result<PathBuf, String> {
    Ok(agent_center_dir(roots, account_id, local_agent_ref)?
        .join("modules")
        .join("avatar_asset")
        .join("packages")
        .join(kind)
        .join(local_asset_id))
}

pub(super) fn materialization_ref_for(
    account_id: &str,
    local_agent_ref: &str,
    kind: &str,
    local_asset_id: &str,
) -> String {
    format!(
        "agent-center-avatar-asset:{}:{}:{kind}:{local_asset_id}",
        local_scope_path_segment(account_id),
        local_scope_path_segment(local_agent_ref),
    )
}

pub(super) fn backend_capability_profile_ref_for(kind: &str, local_asset_id: &str) -> String {
    format!("avatar.backend_profile:{kind}:{local_asset_id}:import_validated")
}

pub(super) fn live2d_adapter_manifest_dir(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    account_id: &str,
    local_agent_ref: &str,
    local_asset_id: &str,
    manifest_ref: &str,
) -> Result<PathBuf, String> {
    Ok(agent_center_dir(roots, account_id, local_agent_ref)?
        .join("modules")
        .join("avatar_asset")
        .join("adapter_manifests")
        .join(local_asset_id)
        .join(manifest_ref))
}

pub(super) fn is_safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !path.is_absolute()
        && !path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

pub(super) fn resolve_under_root(
    root: &Path,
    relative: &str,
) -> Result<PathBuf, StandardAgentCenterValidationIssue> {
    if !is_safe_relative_path(relative) {
        return Err(error(
            "path_rejected",
            "Package file path must stay within the package.",
            Some(relative.to_string()),
        ));
    }
    let path = root.join(relative);
    let canonical_root = fs::canonicalize(root).map_err(|source| {
        error(
            "permission_denied",
            &format!("Package root cannot be resolved: {source}"),
            Some(root.display().to_string()),
        )
    })?;
    let canonical_path = fs::canonicalize(&path).map_err(|source| {
        error(
            "missing_required_file",
            &format!("Package file cannot be read: {source}"),
            Some(relative.to_string()),
        )
    })?;
    if !canonical_path.starts_with(canonical_root) {
        return Err(error(
            "path_rejected",
            "Package file resolves outside the package.",
            Some(relative.to_string()),
        ));
    }
    Ok(canonical_path)
}

pub(super) fn managed_custody_directory_exists(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    target: &Path,
) -> Result<bool, String> {
    let raw_root = roots.data_root();
    if !raw_root.exists() {
        return Ok(false);
    }
    let canonical_root = fs::canonicalize(raw_root).map_err(|error| {
        format!(
            "Agent Center managed data root cannot be resolved ({}): {error}",
            raw_root.display()
        )
    })?;
    let relative = target.strip_prefix(raw_root).map_err(|_| {
        format!(
            "Agent Center managed path escaped the data root ({})",
            target.display()
        )
    })?;
    let mut current = canonical_root.clone();
    let components = relative.components().collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(segment) = component else {
            return Err(format!(
                "Agent Center managed path contains a rejected component ({})",
                target.display()
            ));
        };
        current.push(segment);
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(format!(
                    "Agent Center managed path cannot be inspected ({}): {error}",
                    current.display()
                ));
            }
        };
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Agent Center managed path contains a symlink ({})",
                current.display()
            ));
        }
        if !metadata.is_dir() && index + 1 < components.len() {
            return Err(format!(
                "Agent Center managed path contains a non-directory ({})",
                current.display()
            ));
        }
    }
    let metadata = fs::symlink_metadata(&current).map_err(|error| {
        format!(
            "Agent Center managed directory cannot be inspected ({}): {error}",
            current.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "Agent Center managed custody must be a directory ({})",
            current.display()
        ));
    }
    let canonical_target = fs::canonicalize(&current).map_err(|error| {
        format!(
            "Agent Center managed directory cannot be resolved ({}): {error}",
            current.display()
        )
    })?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!(
            "Agent Center managed directory escaped its data root ({})",
            target.display()
        ));
    }
    Ok(true)
}

pub(super) fn validate_display_text(
    value: &str,
    field_name: &str,
    max_chars: usize,
) -> Result<(), StandardAgentCenterValidationIssue> {
    let char_count = value.chars().count();
    if char_count == 0 || char_count > max_chars {
        return Err(error(
            "invalid_manifest",
            &format!("{field_name} must be 1..{max_chars} characters."),
            Some(field_name.to_string()),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(error(
            "invalid_manifest",
            &format!("{field_name} must not contain control characters."),
            Some(field_name.to_string()),
        ));
    }
    Ok(())
}

pub(super) fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
}

pub(super) fn extension_for(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

pub(super) fn sha256_file(
    path: &Path,
) -> Result<(u64, String), StandardAgentCenterValidationIssue> {
    let mut file = fs::File::open(path).map_err(|source| {
        error(
            "permission_denied",
            &format!("Package file cannot be opened: {source}"),
            Some(path.display().to_string()),
        )
    })?;
    let mut hasher = Sha256::new();
    let bytes = std::io::copy(&mut file, &mut hasher).map_err(|source| {
        error(
            "permission_denied",
            &format!("Package file cannot be read: {source}"),
            Some(path.display().to_string()),
        )
    })?;
    Ok((bytes, format!("{:x}", hasher.finalize())))
}

pub(super) fn source_label_for(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(120).collect::<String>())
        .unwrap_or_else(|| "local import".to_string())
}

pub(super) fn safe_display_name(source_path: &Path) -> Result<String, String> {
    let name = source_label_for(source_path);
    validate_display_text(&name, "displayName", 80).map_err(|issue| issue.message)?;
    Ok(name)
}

pub(super) fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize JSON ({}): {error}", path.display()))?;
    fs::write(path, raw)
        .map_err(|error| format!("failed to write JSON ({}): {error}", path.display()))
}

pub(super) fn remove_dir_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}

pub(super) fn background_validation_result(
    background_asset_id: &str,
    status: StandardAgentCenterBackgroundValidationStatus,
    errors: Vec<StandardAgentCenterValidationIssue>,
    warnings: Vec<StandardAgentCenterValidationIssue>,
) -> StandardAgentCenterBackgroundValidationResult {
    StandardAgentCenterBackgroundValidationResult {
        schema_version: VALIDATION_SCHEMA_VERSION,
        background_asset_id: background_asset_id.to_string(),
        checked_at: checked_at(),
        status,
        errors,
        warnings,
    }
}

pub(super) fn avatar_asset_validation_result(
    local_asset_id: &str,
    status: StandardAgentCenterAvatarAssetValidationStatus,
    errors: Vec<StandardAgentCenterValidationIssue>,
    warnings: Vec<StandardAgentCenterValidationIssue>,
) -> StandardAgentCenterAvatarAssetValidationResult {
    StandardAgentCenterAvatarAssetValidationResult {
        schema_version: VALIDATION_SCHEMA_VERSION,
        local_asset_id: local_asset_id.to_string(),
        checked_at: checked_at(),
        status,
        errors,
        warnings,
    }
}

pub(super) fn status_for_avatar_asset_errors(
    errors: &[StandardAgentCenterValidationIssue],
) -> StandardAgentCenterAvatarAssetValidationStatus {
    if errors
        .iter()
        .any(|entry| entry.code == "avatar_asset_missing")
    {
        return StandardAgentCenterAvatarAssetValidationStatus::AssetMissing;
    }
    if errors.iter().any(|entry| entry.code == "path_rejected") {
        return StandardAgentCenterAvatarAssetValidationStatus::PathRejected;
    }
    if errors.iter().any(|entry| entry.code == "permission_denied") {
        return StandardAgentCenterAvatarAssetValidationStatus::PermissionDenied;
    }
    if errors.iter().any(|entry| entry.code == "unsupported_kind") {
        return StandardAgentCenterAvatarAssetValidationStatus::UnsupportedKind;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "missing_required_file")
    {
        return StandardAgentCenterAvatarAssetValidationStatus::MissingEntry;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "content_digest_mismatch" || entry.code == "file_size_mismatch")
    {
        return StandardAgentCenterAvatarAssetValidationStatus::DigestMismatch;
    }
    StandardAgentCenterAvatarAssetValidationStatus::InvalidManifest
}

pub(super) fn status_for_background_errors(
    errors: &[StandardAgentCenterValidationIssue],
) -> StandardAgentCenterBackgroundValidationStatus {
    if errors
        .iter()
        .any(|entry| entry.code == "background_missing")
    {
        return StandardAgentCenterBackgroundValidationStatus::AssetMissing;
    }
    if errors.iter().any(|entry| entry.code == "path_rejected") {
        return StandardAgentCenterBackgroundValidationStatus::PathRejected;
    }
    if errors.iter().any(|entry| entry.code == "permission_denied") {
        return StandardAgentCenterBackgroundValidationStatus::PermissionDenied;
    }
    if errors.iter().any(|entry| entry.code == "unsupported_mime") {
        return StandardAgentCenterBackgroundValidationStatus::UnsupportedMime;
    }
    if errors.iter().any(|entry| entry.code == "missing_image") {
        return StandardAgentCenterBackgroundValidationStatus::MissingImage;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "content_digest_mismatch")
    {
        return StandardAgentCenterBackgroundValidationStatus::DigestMismatch;
    }
    StandardAgentCenterBackgroundValidationStatus::InvalidManifest
}
