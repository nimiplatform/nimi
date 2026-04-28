use super::*;

pub(super) fn issue(
    code: &str,
    message: &str,
    path: Option<String>,
    severity: AgentCenterValidationIssueSeverity,
) -> AgentCenterValidationIssue {
    AgentCenterValidationIssue {
        code: code.to_string(),
        message: message.to_string(),
        path,
        severity,
    }
}

pub(super) fn error(code: &str, message: &str, path: Option<String>) -> AgentCenterValidationIssue {
    issue(
        code,
        message,
        path,
        AgentCenterValidationIssueSeverity::Error,
    )
}

pub(super) fn validation_result(
    package_id: &str,
    status: AgentCenterAvatarPackageValidationStatus,
    errors: Vec<AgentCenterValidationIssue>,
    warnings: Vec<AgentCenterValidationIssue>,
) -> AgentCenterAvatarPackageValidationResult {
    AgentCenterAvatarPackageValidationResult {
        schema_version: VALIDATION_SCHEMA_VERSION,
        package_id: package_id.to_string(),
        checked_at: checked_at(),
        status,
        errors,
        warnings,
    }
}

pub(super) fn write_validation_sidecar(
    package_dir: &Path,
    result: &AgentCenterAvatarPackageValidationResult,
) -> Result<(), String> {
    if !package_dir.exists() {
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(result)
        .map_err(|error| format!("failed to serialize package validation sidecar: {error}"))?;
    fs::write(package_dir.join(VALIDATION_FILE_NAME), raw)
        .map_err(|error| format!("failed to write package validation sidecar: {error}"))
}

pub(super) fn write_background_validation_sidecar(
    background_dir: &Path,
    result: &AgentCenterBackgroundValidationResult,
) -> Result<(), String> {
    if !background_dir.exists() {
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(result)
        .map_err(|error| format!("failed to serialize background validation sidecar: {error}"))?;
    fs::write(background_dir.join(VALIDATION_FILE_NAME), raw)
        .map_err(|error| format!("failed to write background validation sidecar: {error}"))
}

pub(super) fn package_kind_dir(kind: AgentCenterAvatarPackageKind) -> &'static str {
    match kind {
        AgentCenterAvatarPackageKind::Live2d => "live2d",
        AgentCenterAvatarPackageKind::Vrm => "vrm",
    }
}

pub(super) fn package_dir(
    account_id: &str,
    agent_id: &str,
    kind: AgentCenterAvatarPackageKind,
    package_id: &str,
) -> Result<PathBuf, String> {
    Ok(agent_center_dir(account_id, agent_id)?
        .join("modules")
        .join("avatar_package")
        .join("packages")
        .join(package_kind_dir(kind))
        .join(package_id))
}

pub(super) fn background_dir(
    account_id: &str,
    agent_id: &str,
    background_asset_id: &str,
) -> Result<PathBuf, String> {
    Ok(agent_center_dir(account_id, agent_id)?
        .join("modules")
        .join("appearance")
        .join("backgrounds")
        .join(background_asset_id))
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
) -> Result<PathBuf, AgentCenterValidationIssue> {
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

pub(super) fn is_semver(value: &str) -> bool {
    let mut parts = value.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && [major, minor, patch]
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

pub(super) fn validate_display_text(
    value: &str,
    field_name: &str,
    max_chars: usize,
) -> Result<(), AgentCenterValidationIssue> {
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

pub(super) fn is_prefixed_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(is_digest)
}

pub(super) fn extension_for(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

pub(super) fn sha256_file(path: &Path) -> Result<(u64, String), AgentCenterValidationIssue> {
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

pub(super) fn mime_for(path: &str) -> String {
    match extension_for(path).as_str() {
        "json" => "application/json",
        "moc3" => "application/octet-stream",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "vrm" => "model/vrm",
        _ => "application/octet-stream",
    }
    .to_string()
}

pub(super) fn relative_path_to_string(path: &Path) -> Result<String, String> {
    let value = path
        .to_str()
        .ok_or_else(|| "source path must be valid UTF-8".to_string())?
        .replace('\\', "/");
    if !is_safe_relative_path(&value) {
        return Err(format!("source file path is not package-safe: {value}"));
    }
    Ok(value)
}

pub(super) fn collect_files_recursive(
    source_root: &Path,
    current: &Path,
    files: &mut Vec<(PathBuf, String)>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(current).map_err(|error| {
        format!(
            "failed to read source metadata ({}): {error}",
            current.display()
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "source package must not contain symlinks: {}",
            current.display()
        ));
    }
    if metadata.is_dir() {
        let mut entries = fs::read_dir(current)
            .map_err(|error| {
                format!(
                    "failed to read source directory ({}): {error}",
                    current.display()
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read source directory entry: {error}"))?;
        entries.sort_by_key(|entry| entry.path());
        for entry in entries {
            collect_files_recursive(source_root, &entry.path(), files)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(format!(
            "source package contains unsupported filesystem entry: {}",
            current.display()
        ));
    }
    let relative = current.strip_prefix(source_root).map_err(|error| {
        format!(
            "source file does not stay under source root ({}): {error}",
            current.display()
        )
    })?;
    let relative = relative_path_to_string(relative)?;
    files.push((current.to_path_buf(), relative));
    Ok(())
}

pub(super) fn aggregate_content_digest(files: &[AvatarPackageManifestFile]) -> String {
    let mut hasher = Sha256::new();
    let mut ordered = files.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.path.cmp(&right.path));
    for file in ordered {
        hasher.update(file.path.as_bytes());
        hasher.update([0]);
        hasher.update(file.bytes.to_string().as_bytes());
        hasher.update([0]);
        hasher.update(file.sha256.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

pub(super) fn package_id_for(kind: AgentCenterAvatarPackageKind, content_digest: &str) -> String {
    let prefix = match kind {
        AgentCenterAvatarPackageKind::Live2d => "live2d_",
        AgentCenterAvatarPackageKind::Vrm => "vrm_",
    };
    format!("{prefix}{}", &content_digest[..12])
}

pub(super) fn safe_display_name(
    input: Option<String>,
    fallback_path: &Path,
) -> Result<String, String> {
    let name = input
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| source_label_for(fallback_path));
    validate_display_text(&name, "displayName", 80).map_err(|issue| issue.message)?;
    Ok(name)
}

pub(super) fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize JSON ({}): {error}", path.display()))?;
    fs::write(path, raw)
        .map_err(|error| format!("failed to write JSON ({}): {error}", path.display()))
}

pub(super) fn file_url_from_path(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map_err(|_| {
            format!(
                "failed to convert local resource path to file url: {}",
                path.display()
            )
        })
        .map(|url| url.to_string())
}

pub(super) fn remove_dir_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}

pub(super) fn status_for_errors(
    errors: &[AgentCenterValidationIssue],
) -> AgentCenterAvatarPackageValidationStatus {
    if errors.iter().any(|entry| entry.code == "package_missing") {
        return AgentCenterAvatarPackageValidationStatus::PackageMissing;
    }
    if errors.iter().any(|entry| entry.code == "path_rejected") {
        return AgentCenterAvatarPackageValidationStatus::PathRejected;
    }
    if errors.iter().any(|entry| entry.code == "permission_denied") {
        return AgentCenterAvatarPackageValidationStatus::PermissionDenied;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "missing_required_file")
    {
        return AgentCenterAvatarPackageValidationStatus::MissingFiles;
    }
    if errors.iter().any(|entry| entry.code == "unsupported_kind") {
        return AgentCenterAvatarPackageValidationStatus::UnsupportedKind;
    }
    AgentCenterAvatarPackageValidationStatus::InvalidManifest
}

pub(super) fn background_validation_result(
    background_asset_id: &str,
    status: AgentCenterBackgroundValidationStatus,
    errors: Vec<AgentCenterValidationIssue>,
    warnings: Vec<AgentCenterValidationIssue>,
) -> AgentCenterBackgroundValidationResult {
    AgentCenterBackgroundValidationResult {
        schema_version: VALIDATION_SCHEMA_VERSION,
        background_asset_id: background_asset_id.to_string(),
        checked_at: checked_at(),
        status,
        errors,
        warnings,
    }
}

pub(super) fn status_for_background_errors(
    errors: &[AgentCenterValidationIssue],
) -> AgentCenterBackgroundValidationStatus {
    if errors
        .iter()
        .any(|entry| entry.code == "background_missing")
    {
        return AgentCenterBackgroundValidationStatus::AssetMissing;
    }
    if errors.iter().any(|entry| entry.code == "path_rejected") {
        return AgentCenterBackgroundValidationStatus::PathRejected;
    }
    if errors.iter().any(|entry| entry.code == "permission_denied") {
        return AgentCenterBackgroundValidationStatus::PermissionDenied;
    }
    if errors.iter().any(|entry| entry.code == "unsupported_mime") {
        return AgentCenterBackgroundValidationStatus::UnsupportedMime;
    }
    if errors.iter().any(|entry| entry.code == "missing_image") {
        return AgentCenterBackgroundValidationStatus::MissingImage;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "content_digest_mismatch")
    {
        return AgentCenterBackgroundValidationStatus::DigestMismatch;
    }
    AgentCenterBackgroundValidationStatus::InvalidManifest
}

pub(super) fn allowed_background_mime(value: &str) -> bool {
    matches!(value, "image/png" | "image/jpeg" | "image/webp")
}

pub(super) fn background_mime_for_path(path: &Path) -> Result<String, String> {
    match extension_for(&path.to_string_lossy()).as_str() {
        "png" => Ok("image/png".to_string()),
        "jpg" | "jpeg" => Ok("image/jpeg".to_string()),
        "webp" => Ok("image/webp".to_string()),
        "svg" => Err("SVG backgrounds are not admitted.".to_string()),
        _ => Err("Background source must be a png, jpeg, or webp image.".to_string()),
    }
}

pub(super) fn read_u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

pub(super) fn parse_png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]),
        u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]),
    ))
}

pub(super) fn parse_jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut index = 2_usize;
    while index + 9 < bytes.len() {
        while index < bytes.len() && bytes[index] != 0xff {
            index += 1;
        }
        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        let marker = bytes[index];
        index += 1;
        if marker == 0xd8 || marker == 0xd9 {
            continue;
        }
        if index + 2 > bytes.len() {
            return None;
        }
        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 || index + length > bytes.len() {
            return None;
        }
        let is_sof = matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        );
        if is_sof && length >= 7 {
            let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            return Some((width, height));
        }
        index += length;
    }
    None
}

pub(super) fn parse_webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let chunk = &bytes[12..16];
    if chunk == b"VP8X" && bytes.len() >= 30 {
        return Some((
            read_u24_le(&bytes[24..27]) + 1,
            read_u24_le(&bytes[27..30]) + 1,
        ));
    }
    if chunk == b"VP8L" && bytes.len() >= 25 {
        let b0 = u32::from(bytes[21]);
        let b1 = u32::from(bytes[22]);
        let b2 = u32::from(bytes[23]);
        let b3 = u32::from(bytes[24]);
        let width = 1 + b0 + ((b1 & 0x3f) << 8);
        let height = 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10);
        return Some((width, height));
    }
    if chunk == b"VP8 " && bytes.len() >= 30 && &bytes[23..26] == b"\x9d\x01\x2a" {
        let width = u16::from_le_bytes([bytes[26], bytes[27]]) as u32 & 0x3fff;
        let height = u16::from_le_bytes([bytes[28], bytes[29]]) as u32 & 0x3fff;
        return Some((width, height));
    }
    None
}

pub(super) fn background_dimensions(bytes: &[u8], mime: &str) -> Result<(u32, u32), String> {
    let dimensions = match mime {
        "image/png" => parse_png_dimensions(bytes),
        "image/jpeg" => parse_jpeg_dimensions(bytes),
        "image/webp" => parse_webp_dimensions(bytes),
        _ => None,
    }
    .ok_or_else(|| "Background image dimensions could not be read.".to_string())?;
    if dimensions.0 == 0
        || dimensions.1 == 0
        || dimensions.0 > MAX_BACKGROUND_PIXELS
        || dimensions.1 > MAX_BACKGROUND_PIXELS
    {
        return Err("Background image dimensions are outside the fixed pixel cap.".to_string());
    }
    Ok(dimensions)
}
