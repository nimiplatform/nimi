use super::store::{
    agent_center_dir, desktop_agent_center_config_get, desktop_agent_center_config_put,
    local_scope_path_segment, validate_background_id, validate_normalized_id, validate_package_id,
    validate_utc_timestamp,
};
use super::types::*;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use url::Url;

const VALIDATION_SCHEMA_VERSION: u8 = 1;
const AVATAR_PACKAGE_MANIFEST_VERSION: u8 = 1;
const MAX_MANIFEST_BYTES: u64 = 262_144;
const MAX_PACKAGE_BYTES: u64 = 524_288_000;
const MAX_FILE_BYTES: u64 = 104_857_600;
const MAX_FILE_COUNT: usize = 2_048;
const MAX_BACKGROUND_BYTES: u64 = 20_971_520;
const MAX_BACKGROUND_PIXELS: u32 = 8_192;
const VALIDATION_FILE_NAME: &str = "validation.json";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const OPERATIONS_FILE_NAME: &str = "agent-center-local-resources.jsonl";
const OPERATION_RETENTION_DAYS: i64 = 30;
const QUARANTINE_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifest {
    manifest_version: u8,
    package_version: String,
    package_id: String,
    kind: AgentCenterAvatarPackageKind,
    loader_min_version: String,
    display_name: String,
    #[serde(default)]
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AvatarPackageManifestFile>,
    limits: AvatarPackageManifestLimits,
    capabilities: serde_json::Value,
    import: AvatarPackageManifestImport,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestLimits {
    max_manifest_bytes: u64,
    max_package_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BackgroundManifest {
    manifest_version: u8,
    background_asset_id: String,
    display_name: String,
    image_file: String,
    mime: String,
    bytes: u64,
    pixel_width: u32,
    pixel_height: u32,
    limits: BackgroundManifestLimits,
    sha256: String,
    imported_at: String,
    source_label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BackgroundManifestLimits {
    max_bytes: u64,
    max_pixel_width: u32,
    max_pixel_height: u32,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterResourceOperationRecord {
    schema_version: u8,
    event_id: String,
    transaction_id: String,
    occurred_at: String,
    operation_type: String,
    resource_kind: String,
    resource_id: String,
    status: String,
    reason_code: String,
}

fn checked_at() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn operation_id(prefix: &str, seed: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.update(Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string());
    hasher.update(std::process::id().to_string());
    format!("{prefix}_{:.12}", format!("{:x}", hasher.finalize()))
}

fn operations_path(account_id: &str, agent_id: &str) -> Result<PathBuf, String> {
    Ok(agent_center_dir(account_id, agent_id)?
        .join("operations")
        .join(OPERATIONS_FILE_NAME))
}

fn account_dir(account_id: &str) -> Result<PathBuf, String> {
    Ok(crate::desktop_paths::resolve_nimi_data_dir()?
        .join("accounts")
        .join(local_scope_path_segment(account_id)))
}

fn account_operations_path(account_id: &str) -> Result<PathBuf, String> {
    Ok(account_dir(account_id)?
        .join("operations")
        .join(OPERATIONS_FILE_NAME))
}

fn should_keep_operation_line(line: &str, cutoff: chrono::DateTime<Utc>) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    let Some(occurred_at) = value.get("occurred_at").and_then(serde_json::Value::as_str) else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(occurred_at)
        .map(|timestamp| timestamp.with_timezone(&Utc) >= cutoff)
        .unwrap_or(false)
}

fn prune_operation_records(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read Agent Center operation records ({}): {error}",
            path.display()
        )
    })?;
    let cutoff = Utc::now() - Duration::days(OPERATION_RETENTION_DAYS);
    let retained = raw
        .lines()
        .filter(|line| should_keep_operation_line(line, cutoff))
        .collect::<Vec<_>>();
    let next = if retained.is_empty() {
        String::new()
    } else {
        format!("{}\n", retained.join("\n"))
    };
    fs::write(path, next).map_err(|error| {
        format!(
            "failed to prune Agent Center operation records ({}): {error}",
            path.display()
        )
    })
}

fn append_operation_record_to_path(
    path: &Path,
    record: &AgentCenterResourceOperationRecord,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Agent Center operations directory ({}): {error}",
                parent.display()
            )
        })?;
    }
    prune_operation_records(&path)?;
    let line = serde_json::to_string(record)
        .map_err(|error| format!("failed to serialize Agent Center operation record: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            format!(
                "failed to open Agent Center operation log ({}): {error}",
                path.display()
            )
        })?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| {
            format!(
                "failed to append Agent Center operation log ({}): {error}",
                path.display()
            )
        })
}

fn append_operation_record(
    account_id: &str,
    agent_id: &str,
    record: &AgentCenterResourceOperationRecord,
) -> Result<(), String> {
    let path = operations_path(account_id, agent_id)?;
    append_operation_record_to_path(&path, record)
}

fn build_operation_record(
    seed: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> AgentCenterResourceOperationRecord {
    let event_id = operation_id("op", seed);
    let transaction_id = operation_id("tx", &event_id);
    AgentCenterResourceOperationRecord {
        schema_version: 1,
        event_id,
        transaction_id,
        occurred_at: checked_at(),
        operation_type: operation_type.to_string(),
        resource_kind: resource_kind.to_string(),
        resource_id: resource_id.to_string(),
        status: status.to_string(),
        reason_code: reason_code.to_string(),
    }
}

fn record_resource_operation(
    account_id: &str,
    agent_id: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> Result<String, String> {
    let seed = format!("{account_id}:{agent_id}:{operation_type}:{resource_kind}:{resource_id}");
    let record = build_operation_record(
        &seed,
        operation_type,
        resource_kind,
        resource_id,
        status,
        reason_code,
    );
    let event_id = record.event_id.clone();
    append_operation_record(account_id, agent_id, &record)?;
    Ok(event_id)
}

fn record_account_resource_operation(
    account_id: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> Result<String, String> {
    let seed = format!("{account_id}:{operation_type}:{resource_kind}:{resource_id}");
    let record = build_operation_record(
        &seed,
        operation_type,
        resource_kind,
        resource_id,
        status,
        reason_code,
    );
    let event_id = record.event_id.clone();
    let path = account_operations_path(account_id)?;
    append_operation_record_to_path(&path, &record)?;
    Ok(event_id)
}

fn record_resource_operation_under(
    operation_log_path: &Path,
    seed_scope: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> Result<String, String> {
    let seed = format!("{seed_scope}:{operation_type}:{resource_kind}:{resource_id}");
    let record = build_operation_record(
        &seed,
        operation_type,
        resource_kind,
        resource_id,
        status,
        reason_code,
    );
    let event_id = record.event_id.clone();
    append_operation_record_to_path(operation_log_path, &record)?;
    Ok(event_id)
}

fn quarantine_path(
    account_id: &str,
    agent_id: &str,
    resource_kind: &str,
    resource_id: &str,
) -> Result<PathBuf, String> {
    let root = agent_center_dir(account_id, agent_id)?;
    cleanup_expired_quarantine(&root)?;
    Ok(root.join("quarantine").join(resource_kind).join(format!(
        "{}_{}",
        resource_id,
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    )))
}

fn cleanup_expired_quarantine(agent_center_root: &Path) -> Result<(), String> {
    cleanup_expired_quarantine_dir(&agent_center_root.join("quarantine"))
}

fn cleanup_expired_quarantine_dir(quarantine_root: &Path) -> Result<(), String> {
    if !quarantine_root.exists() {
        return Ok(());
    }
    let cutoff = Utc::now()
        .checked_sub_signed(Duration::days(QUARANTINE_RETENTION_DAYS))
        .and_then(|timestamp| timestamp.timestamp_nanos_opt())
        .unwrap_or(i64::MIN);
    for kind_entry in fs::read_dir(&quarantine_root).map_err(|error| {
        format!(
            "failed to read Agent Center quarantine root ({}): {error}",
            quarantine_root.display()
        )
    })? {
        let kind_entry = kind_entry
            .map_err(|error| format!("failed to read Agent Center quarantine entry: {error}"))?;
        let kind_path = kind_entry.path();
        if !kind_path.is_dir() {
            continue;
        }
        for resource_entry in fs::read_dir(&kind_path).map_err(|error| {
            format!(
                "failed to read Agent Center quarantine directory ({}): {error}",
                kind_path.display()
            )
        })? {
            let resource_entry = resource_entry.map_err(|error| {
                format!("failed to read Agent Center quarantined resource entry: {error}")
            })?;
            let resource_path = resource_entry.path();
            let Some(name) = resource_path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some((_, timestamp_raw)) = name.rsplit_once('_') else {
                continue;
            };
            let Ok(timestamp_nanos) = timestamp_raw.parse::<i64>() else {
                continue;
            };
            if timestamp_nanos < cutoff {
                let metadata = fs::symlink_metadata(&resource_path).map_err(|error| {
                    format!(
                        "failed to read quarantined resource metadata ({}): {error}",
                        resource_path.display()
                    )
                })?;
                if metadata.is_dir() {
                    fs::remove_dir_all(&resource_path).map_err(|error| {
                        format!(
                            "failed to remove expired quarantined resource ({}): {error}",
                            resource_path.display()
                        )
                    })?;
                } else {
                    fs::remove_file(&resource_path).map_err(|error| {
                        format!(
                            "failed to remove expired quarantined resource ({}): {error}",
                            resource_path.display()
                        )
                    })?;
                }
            }
        }
    }
    Ok(())
}

fn account_quarantine_path(
    account_id: &str,
    resource_kind: &str,
    resource_id: &str,
) -> Result<PathBuf, String> {
    let account_root = account_dir(account_id)?;
    let quarantine_root = account_root.join("quarantine");
    cleanup_expired_quarantine_dir(&quarantine_root)?;
    Ok(quarantine_root.join(resource_kind).join(format!(
        "{}_{}",
        resource_id,
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    )))
}

fn quarantine_dir(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() {
        return Ok(false);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Agent Center quarantine directory ({}): {error}",
                parent.display()
            )
        })?;
    }
    fs::rename(source, destination).map_err(|error| {
        format!(
            "failed to quarantine Agent Center resource ({} -> {}): {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(true)
}

fn validate_removable_agent_center_tree(source: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(source) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Agent Center local resources path must not be a symlink ({})",
                    source.display()
                ));
            }
            if !metadata.is_dir() {
                return Err(format!(
                    "Agent Center local resources path must be a directory ({})",
                    source.display()
                ));
            }
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "failed to inspect Agent Center local resources path ({}): {error}",
            source.display()
        )),
    }
}

fn quarantine_agent_center_tree(
    account_id: &str,
    agent_id: &str,
    reason_code: &str,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let source = agent_center_dir(account_id, agent_id)?;
    if !validate_removable_agent_center_tree(&source)? {
        let operation_id = record_account_resource_operation(
            account_id,
            "agent_local_resources_quarantine",
            "agent_local_resources",
            agent_id,
            "completed",
            "already_missing",
        )?;
        return Ok(DesktopAgentCenterLocalResourceRemoveResult {
            resource_kind: "agent_local_resources".to_string(),
            resource_id: agent_id.to_string(),
            quarantined: false,
            operation_id,
            status: "completed".to_string(),
        });
    }
    let destination = account_quarantine_path(account_id, "agent_local_resources", agent_id)?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                account_id,
                agent_id,
                "agent_local_resources_quarantine",
                "agent_local_resources",
                agent_id,
                "failed",
                reason_code,
            );
            return Err(error);
        }
    };
    let operation_id = if quarantined {
        record_resource_operation_under(
            &destination.join("operations").join(OPERATIONS_FILE_NAME),
            &format!("{account_id}:{agent_id}:quarantined_agent_center"),
            "agent_local_resources_quarantine",
            "agent_local_resources",
            agent_id,
            "completed",
            reason_code,
        )?
    } else {
        record_account_resource_operation(
            account_id,
            "agent_local_resources_quarantine",
            "agent_local_resources",
            agent_id,
            "completed",
            "already_missing",
        )?
    };
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "agent_local_resources".to_string(),
        resource_id: agent_id.to_string(),
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}

fn issue(
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

fn error(code: &str, message: &str, path: Option<String>) -> AgentCenterValidationIssue {
    issue(
        code,
        message,
        path,
        AgentCenterValidationIssueSeverity::Error,
    )
}

fn validation_result(
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

fn write_validation_sidecar(
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

fn write_background_validation_sidecar(
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

fn package_kind_dir(kind: AgentCenterAvatarPackageKind) -> &'static str {
    match kind {
        AgentCenterAvatarPackageKind::Live2d => "live2d",
        AgentCenterAvatarPackageKind::Vrm => "vrm",
    }
}

fn package_dir(
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

fn background_dir(
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

fn is_safe_relative_path(value: &str) -> bool {
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

fn resolve_under_root(root: &Path, relative: &str) -> Result<PathBuf, AgentCenterValidationIssue> {
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

fn is_semver(value: &str) -> bool {
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

fn validate_display_text(
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

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
}

fn is_prefixed_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(is_digest)
}

fn extension_for(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

fn sha256_file(path: &Path) -> Result<(u64, String), AgentCenterValidationIssue> {
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

fn source_label_for(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(120).collect::<String>())
        .unwrap_or_else(|| "local import".to_string())
}

fn mime_for(path: &str) -> String {
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

fn relative_path_to_string(path: &Path) -> Result<String, String> {
    let value = path
        .to_str()
        .ok_or_else(|| "source path must be valid UTF-8".to_string())?
        .replace('\\', "/");
    if !is_safe_relative_path(&value) {
        return Err(format!("source file path is not package-safe: {value}"));
    }
    Ok(value)
}

fn collect_files_recursive(
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

fn aggregate_content_digest(files: &[AvatarPackageManifestFile]) -> String {
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

fn package_id_for(kind: AgentCenterAvatarPackageKind, content_digest: &str) -> String {
    let prefix = match kind {
        AgentCenterAvatarPackageKind::Live2d => "live2d_",
        AgentCenterAvatarPackageKind::Vrm => "vrm_",
    };
    format!("{prefix}{}", &content_digest[..12])
}

fn safe_display_name(input: Option<String>, fallback_path: &Path) -> Result<String, String> {
    let name = input
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| source_label_for(fallback_path));
    validate_display_text(&name, "displayName", 80).map_err(|issue| issue.message)?;
    Ok(name)
}

fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize JSON ({}): {error}", path.display()))?;
    fs::write(path, raw)
        .map_err(|error| format!("failed to write JSON ({}): {error}", path.display()))
}

fn file_url_from_path(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map_err(|_| {
            format!(
                "failed to convert local resource path to file url: {}",
                path.display()
            )
        })
        .map(|url| url.to_string())
}

fn remove_dir_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}

fn status_for_errors(
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

fn background_validation_result(
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

fn status_for_background_errors(
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

fn allowed_background_mime(value: &str) -> bool {
    matches!(value, "image/png" | "image/jpeg" | "image/webp")
}

fn background_mime_for_path(path: &Path) -> Result<String, String> {
    match extension_for(&path.to_string_lossy()).as_str() {
        "png" => Ok("image/png".to_string()),
        "jpg" | "jpeg" => Ok("image/jpeg".to_string()),
        "webp" => Ok("image/webp".to_string()),
        "svg" => Err("SVG backgrounds are not admitted.".to_string()),
        _ => Err("Background source must be a png, jpeg, or webp image.".to_string()),
    }
}

fn read_u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

fn parse_png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]),
        u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]),
    ))
}

fn parse_jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
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

fn parse_webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
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

fn background_dimensions(bytes: &[u8], mime: &str) -> Result<(u32, u32), String> {
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

fn validate_manifest(
    package_root: &Path,
    expected_kind: AgentCenterAvatarPackageKind,
    expected_package_id: &str,
) -> AgentCenterAvatarPackageValidationResult {
    let manifest_path = package_root.join(MANIFEST_FILE_NAME);
    let manifest_metadata = match fs::metadata(&manifest_path) {
        Ok(metadata) => metadata,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::PackageMissing,
                vec![error(
                    "manifest_not_found",
                    &format!("Package manifest is missing: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    if manifest_metadata.len() > MAX_MANIFEST_BYTES {
        return validation_result(
            expected_package_id,
            AgentCenterAvatarPackageValidationStatus::InvalidManifest,
            vec![error(
                "manifest_too_large",
                "Package manifest is over the fixed size cap.",
                Some(MANIFEST_FILE_NAME.to_string()),
            )],
            vec![],
        );
    }
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::PermissionDenied,
                vec![error(
                    "permission_denied",
                    &format!("Package manifest cannot be read: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest_value = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => value,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::InvalidManifest,
                vec![error(
                    "manifest_invalid",
                    &format!("Package manifest is malformed JSON: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    if manifest_value.get("validation").is_some() {
        return validation_result(
            expected_package_id,
            AgentCenterAvatarPackageValidationStatus::InvalidManifest,
            vec![error(
                "manifest_embeds_validation",
                "Package manifest must not embed validation status.",
                Some(MANIFEST_FILE_NAME.to_string()),
            )],
            vec![],
        );
    }
    let manifest = match serde_json::from_value::<AvatarPackageManifest>(manifest_value) {
        Ok(manifest) => manifest,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::InvalidManifest,
                vec![error(
                    "manifest_invalid",
                    &format!("Package manifest does not match schema: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    let mut errors = Vec::<AgentCenterValidationIssue>::new();
    if manifest.manifest_version != AVATAR_PACKAGE_MANIFEST_VERSION {
        errors.push(error(
            "manifest_invalid",
            "manifest_version must be 1.",
            Some("manifest_version".to_string()),
        ));
    }
    if manifest.package_id != expected_package_id {
        errors.push(error(
            "manifest_invalid",
            "package_id must match the selected package.",
            Some("package_id".to_string()),
        ));
    }
    if manifest.kind != expected_kind {
        errors.push(error(
            "unsupported_kind",
            "kind must match the selected package kind.",
            Some("kind".to_string()),
        ));
    }
    if let Err(message) = validate_package_id(&manifest.package_id, "package_id") {
        errors.push(error(
            "manifest_invalid",
            &message,
            Some("package_id".to_string()),
        ));
    }
    if !is_semver(&manifest.package_version) {
        errors.push(error(
            "manifest_invalid",
            "package_version must be semver.",
            Some("package_version".to_string()),
        ));
    }
    if !is_semver(&manifest.loader_min_version) {
        errors.push(error(
            "manifest_invalid",
            "loader_min_version must be semver.",
            Some("loader_min_version".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    for (locale, value) in &manifest.display_name_i18n {
        match value.as_str() {
            Some(text) => {
                if let Err(issue) =
                    validate_display_text(text, &format!("display_name_i18n.{locale}"), 80)
                {
                    errors.push(issue);
                }
            }
            None => errors.push(error(
                "manifest_invalid",
                "display_name_i18n values must be strings.",
                Some(format!("display_name_i18n.{locale}")),
            )),
        }
    }
    if let Err(issue) =
        validate_display_text(&manifest.import.source_label, "import.source_label", 120)
    {
        errors.push(issue);
    }
    if Path::new(&manifest.import.source_label).is_absolute() {
        errors.push(error(
            "manifest_invalid",
            "import.source_label must not store an absolute path.",
            Some("import.source_label".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.import.imported_at, "import.imported_at")
    {
        errors.push(error(
            "manifest_invalid",
            &message,
            Some("import.imported_at".to_string()),
        ));
    }
    if !is_prefixed_digest(&manifest.import.source_fingerprint) {
        errors.push(error(
            "manifest_invalid",
            "import.source_fingerprint must be a sha256 digest.",
            Some("import.source_fingerprint".to_string()),
        ));
    }
    if !is_prefixed_digest(&manifest.content_digest) {
        errors.push(error(
            "manifest_invalid",
            "content_digest must be a sha256 digest.",
            Some("content_digest".to_string()),
        ));
    }
    if manifest.limits.max_manifest_bytes != MAX_MANIFEST_BYTES
        || manifest.limits.max_package_bytes != MAX_PACKAGE_BYTES
        || manifest.limits.max_file_bytes != MAX_FILE_BYTES
        || manifest.limits.max_file_count != MAX_FILE_COUNT
    {
        errors.push(error(
            "manifest_invalid",
            "limits must match the fixed cutover caps.",
            Some("limits".to_string()),
        ));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_FILE_COUNT {
        errors.push(error(
            "manifest_invalid",
            "files must be non-empty and stay within the fixed file-count cap.",
            Some("files".to_string()),
        ));
    }
    if !is_safe_relative_path(&manifest.entry_file) {
        errors.push(error(
            "path_rejected",
            "entry_file must be package-relative.",
            Some("entry_file".to_string()),
        ));
    }
    let _ = &manifest.capabilities;

    let mut known_paths = HashSet::<String>::new();
    let mut package_bytes = 0_u64;
    for file in &manifest.files {
        if !known_paths.insert(file.path.clone()) {
            errors.push(error(
                "manifest_invalid",
                "Package manifest file paths must be unique.",
                Some(file.path.clone()),
            ));
        }
        if !is_safe_relative_path(&file.path) {
            errors.push(error(
                "path_rejected",
                "Package file path must be package-relative.",
                Some(file.path.clone()),
            ));
            continue;
        }
        if !is_digest(&file.sha256) {
            errors.push(error(
                "manifest_invalid",
                "files[].sha256 must be a lowercase sha256 digest.",
                Some(file.path.clone()),
            ));
        }
        if file.bytes == 0 || file.bytes > MAX_FILE_BYTES {
            errors.push(error(
                "file_size_rejected",
                "Package file size is outside the fixed cap.",
                Some(file.path.clone()),
            ));
        }
        if file.mime.trim().is_empty() {
            errors.push(error(
                "manifest_invalid",
                "files[].mime is required.",
                Some(file.path.clone()),
            ));
        }
        package_bytes = package_bytes.saturating_add(file.bytes);
        match resolve_under_root(package_root, &file.path).and_then(|path| sha256_file(&path)) {
            Ok((actual_bytes, actual_sha256)) => {
                if actual_bytes != file.bytes {
                    errors.push(error(
                        "file_size_mismatch",
                        "Package file size differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
                if actual_sha256 != file.sha256 {
                    errors.push(error(
                        "content_digest_mismatch",
                        "Package file digest differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
            }
            Err(issue) => errors.push(issue),
        }
    }
    if package_bytes > MAX_PACKAGE_BYTES {
        errors.push(error(
            "package_too_large",
            "Package byte total is over the fixed cap.",
            Some("files".to_string()),
        ));
    }
    if !known_paths.contains(&manifest.entry_file) {
        errors.push(error(
            "missing_required_file",
            "entry_file must appear in files.",
            Some(manifest.entry_file.clone()),
        ));
    }
    for required in &manifest.required_files {
        if !is_safe_relative_path(required) {
            errors.push(error(
                "path_rejected",
                "required_files entries must be package-relative.",
                Some(required.clone()),
            ));
            continue;
        }
        if !known_paths.contains(required) {
            errors.push(error(
                "missing_required_file",
                "required file must appear in files.",
                Some(required.clone()),
            ));
        }
    }

    if errors.is_empty() {
        validation_result(
            expected_package_id,
            AgentCenterAvatarPackageValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_errors(&errors);
        validation_result(expected_package_id, status, errors, vec![])
    }
}

fn validate_background_manifest(
    background_root: &Path,
    expected_background_asset_id: &str,
) -> AgentCenterBackgroundValidationResult {
    let manifest_path = background_root.join(MANIFEST_FILE_NAME);
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return background_validation_result(
                expected_background_asset_id,
                AgentCenterBackgroundValidationStatus::AssetMissing,
                vec![error(
                    "background_missing",
                    &format!("Background manifest is missing: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest = match serde_json::from_str::<BackgroundManifest>(&raw) {
        Ok(manifest) => manifest,
        Err(source) => {
            return background_validation_result(
                expected_background_asset_id,
                AgentCenterBackgroundValidationStatus::InvalidManifest,
                vec![error(
                    "background_manifest_invalid",
                    &format!("Background manifest is malformed: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    let mut errors = Vec::<AgentCenterValidationIssue>::new();
    if manifest.manifest_version != 1 {
        errors.push(error(
            "background_manifest_invalid",
            "manifest_version must be 1.",
            Some("manifest_version".to_string()),
        ));
    }
    if manifest.background_asset_id != expected_background_asset_id {
        errors.push(error(
            "background_manifest_invalid",
            "background_asset_id must match the selected asset.",
            Some("background_asset_id".to_string()),
        ));
    }
    if let Err(message) =
        validate_background_id(&manifest.background_asset_id, "background_asset_id")
    {
        errors.push(error(
            "background_manifest_invalid",
            &message,
            Some("background_asset_id".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    if let Err(issue) = validate_display_text(&manifest.source_label, "source_label", 120) {
        errors.push(issue);
    }
    if Path::new(&manifest.source_label).is_absolute() {
        errors.push(error(
            "background_manifest_invalid",
            "source_label must not store an absolute path.",
            Some("source_label".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.imported_at, "imported_at") {
        errors.push(error(
            "background_manifest_invalid",
            &message,
            Some("imported_at".to_string()),
        ));
    }
    if !allowed_background_mime(&manifest.mime) {
        errors.push(error(
            "unsupported_mime",
            "Background MIME must be image/png, image/jpeg, or image/webp.",
            Some("mime".to_string()),
        ));
    }
    if extension_for(&manifest.image_file) == "svg" {
        errors.push(error(
            "unsupported_mime",
            "SVG backgrounds are not admitted.",
            Some(manifest.image_file.clone()),
        ));
    }
    if !is_safe_relative_path(&manifest.image_file) {
        errors.push(error(
            "path_rejected",
            "image_file must be background-relative.",
            Some("image_file".to_string()),
        ));
    }
    if manifest.limits.max_bytes != MAX_BACKGROUND_BYTES
        || manifest.limits.max_pixel_width != MAX_BACKGROUND_PIXELS
        || manifest.limits.max_pixel_height != MAX_BACKGROUND_PIXELS
    {
        errors.push(error(
            "background_manifest_invalid",
            "limits must match the fixed background caps.",
            Some("limits".to_string()),
        ));
    }
    if manifest.bytes == 0 || manifest.bytes > MAX_BACKGROUND_BYTES {
        errors.push(error(
            "background_too_large",
            "Background image is outside the fixed byte cap.",
            Some("bytes".to_string()),
        ));
    }
    if manifest.pixel_width == 0
        || manifest.pixel_height == 0
        || manifest.pixel_width > MAX_BACKGROUND_PIXELS
        || manifest.pixel_height > MAX_BACKGROUND_PIXELS
    {
        errors.push(error(
            "background_pixels_rejected",
            "Background image dimensions are outside the fixed pixel cap.",
            Some("pixel_width".to_string()),
        ));
    }
    if !is_digest(&manifest.sha256) {
        errors.push(error(
            "background_manifest_invalid",
            "sha256 must be a lowercase sha256 digest.",
            Some("sha256".to_string()),
        ));
    }
    match resolve_under_root(background_root, &manifest.image_file)
        .and_then(|path| sha256_file(&path))
    {
        Ok((actual_bytes, actual_sha256)) => {
            if actual_bytes != manifest.bytes {
                errors.push(error(
                    "file_size_mismatch",
                    "Background image size differs from manifest.",
                    Some(manifest.image_file.clone()),
                ));
            }
            if actual_sha256 != manifest.sha256 {
                errors.push(error(
                    "content_digest_mismatch",
                    "Background image digest differs from manifest.",
                    Some(manifest.image_file.clone()),
                ));
            }
        }
        Err(mut issue) => {
            if issue.code == "missing_required_file" {
                issue.code = "missing_image".to_string();
            }
            errors.push(issue);
        }
    }

    if errors.is_empty() {
        background_validation_result(
            expected_background_asset_id,
            AgentCenterBackgroundValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_background_errors(&errors);
        background_validation_result(expected_background_asset_id, status, errors, vec![])
    }
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_package_validate(
    payload: DesktopAgentCenterAvatarPackageValidatePayload,
) -> Result<AgentCenterAvatarPackageValidationResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_package_id(&payload.package_id, "packageId")?;
    let expected_prefix = package_kind_dir(payload.kind);
    if !payload.package_id.starts_with(expected_prefix) {
        return Err("packageId must match kind".to_string());
    }
    let dir = package_dir(&account_id, &agent_id, payload.kind, &payload.package_id)?;
    if !dir.exists() {
        return Ok(validation_result(
            &payload.package_id,
            AgentCenterAvatarPackageValidationStatus::PackageMissing,
            vec![error(
                "package_missing",
                "Selected package directory is missing.",
                Some(payload.package_id.clone()),
            )],
            vec![],
        ));
    }
    let result = validate_manifest(&dir, payload.kind, &payload.package_id);
    write_validation_sidecar(&dir, &result)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_validate(
    payload: DesktopAgentCenterBackgroundValidatePayload,
) -> Result<AgentCenterBackgroundValidationResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_background_id(&payload.background_asset_id, "backgroundAssetId")?;
    let dir = background_dir(&account_id, &agent_id, &payload.background_asset_id)?;
    if !dir.exists() {
        return Ok(background_validation_result(
            &payload.background_asset_id,
            AgentCenterBackgroundValidationStatus::AssetMissing,
            vec![error(
                "background_missing",
                "Selected background directory is missing.",
                Some(payload.background_asset_id.clone()),
            )],
            vec![],
        ));
    }
    let result = validate_background_manifest(&dir, &payload.background_asset_id);
    write_background_validation_sidecar(&dir, &result)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_asset_get(
    payload: DesktopAgentCenterBackgroundValidatePayload,
) -> Result<DesktopAgentCenterBackgroundAssetResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_background_id(&payload.background_asset_id, "backgroundAssetId")?;
    let dir = background_dir(&account_id, &agent_id, &payload.background_asset_id)?;
    let validation = if dir.exists() {
        validate_background_manifest(&dir, &payload.background_asset_id)
    } else {
        background_validation_result(
            &payload.background_asset_id,
            AgentCenterBackgroundValidationStatus::AssetMissing,
            vec![error(
                "background_missing",
                "Selected background directory is missing.",
                Some(payload.background_asset_id.clone()),
            )],
            vec![],
        )
    };
    write_background_validation_sidecar(&dir, &validation)?;
    if validation.status != AgentCenterBackgroundValidationStatus::Valid {
        return Ok(DesktopAgentCenterBackgroundAssetResult {
            background_asset_id: payload.background_asset_id,
            file_url: String::new(),
            validation,
        });
    }
    let raw = fs::read_to_string(dir.join(MANIFEST_FILE_NAME))
        .map_err(|error| format!("failed to read background manifest: {error}"))?;
    let manifest = serde_json::from_str::<BackgroundManifest>(&raw)
        .map_err(|error| format!("failed to parse background manifest: {error}"))?;
    let image_path =
        resolve_under_root(&dir, &manifest.image_file).map_err(|issue| issue.message)?;
    Ok(DesktopAgentCenterBackgroundAssetResult {
        background_asset_id: payload.background_asset_id,
        file_url: file_url_from_path(&image_path)?,
        validation,
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_package_pick_source(
    payload: DesktopAgentCenterAvatarPackagePickSourcePayload,
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let dialog = rfd::FileDialog::new().set_directory(&start_dir);
    let selected = match payload.kind {
        AgentCenterAvatarPackageKind::Live2d => dialog
            .set_title("Select Live2D package folder")
            .pick_folder(),
        AgentCenterAvatarPackageKind::Vrm => dialog
            .set_title("Select VRM avatar package")
            .add_filter("VRM", &["vrm"])
            .add_filter("All Files", &["*"])
            .pick_file(),
    };
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_pick_source() -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select background image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

fn select_imported_avatar_package(
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

fn select_imported_background(
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

fn clear_selected_avatar_package(
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

fn clear_selected_background(
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

fn collect_import_source_files(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::with_env;
    use serde_json::json;

    fn temp_home(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-agent-center-resource-{prefix}-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn write_valid_live2d_package(home: &Path) -> PathBuf {
        let dir = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56");
        let files_dir = dir.join("files");
        fs::create_dir_all(&files_dir).expect("files dir");
        let model_bytes = br#"{"Version":3}"#;
        fs::write(files_dir.join("model.model3.json"), model_bytes).expect("model");
        let model_sha = sha256_hex(model_bytes);
        let manifest = json!({
            "manifest_version": 1,
            "package_version": "1.0.0",
            "package_id": "live2d_ab12cd34ef56",
            "kind": "live2d",
            "loader_min_version": "1.0.0",
            "display_name": "Lantern Room Avatar",
            "display_name_i18n": {},
            "entry_file": "files/model.model3.json",
            "required_files": ["files/model.model3.json"],
            "content_digest": format!("sha256:{model_sha}"),
            "files": [{
                "path": "files/model.model3.json",
                "sha256": model_sha,
                "bytes": model_bytes.len(),
                "mime": "application/json"
            }],
            "limits": {
                "max_manifest_bytes": 262144,
                "max_package_bytes": 524288000,
                "max_file_bytes": 104857600,
                "max_file_count": 2048
            },
            "capabilities": {
                "expressions": ["neutral"],
                "motions": ["idle"],
                "physics": false
            },
            "import": {
                "imported_at": "2026-04-27T00:00:00Z",
                "source_label": "local import",
                "source_fingerprint": format!("sha256:{model_sha}")
            }
        });
        fs::write(
            dir.join(MANIFEST_FILE_NAME),
            serde_json::to_string_pretty(&manifest).expect("manifest json"),
        )
        .expect("manifest");
        dir
    }

    fn write_valid_background(home: &Path) -> PathBuf {
        let dir = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/appearance/backgrounds/bg_ab12cd34ef56");
        fs::create_dir_all(&dir).expect("background dir");
        let image_bytes = b"webp-bytes";
        fs::write(dir.join("image.webp"), image_bytes).expect("image");
        let image_sha = sha256_hex(image_bytes);
        let manifest = json!({
            "manifest_version": 1,
            "background_asset_id": "bg_ab12cd34ef56",
            "display_name": "Quiet room",
            "image_file": "image.webp",
            "mime": "image/webp",
            "bytes": image_bytes.len(),
            "pixel_width": 1920,
            "pixel_height": 1080,
            "limits": {
                "max_bytes": 20971520,
                "max_pixel_width": 8192,
                "max_pixel_height": 8192
            },
            "sha256": image_sha,
            "imported_at": "2026-04-27T00:00:00Z",
            "source_label": "local import"
        });
        fs::write(
            dir.join(MANIFEST_FILE_NAME),
            serde_json::to_string_pretty(&manifest).expect("manifest json"),
        )
        .expect("manifest");
        dir
    }

    fn write_live2d_import_source(home: &Path) -> PathBuf {
        let dir = home.join("source-live2d");
        fs::create_dir_all(dir.join("textures")).expect("source dirs");
        fs::write(dir.join("model.model3.json"), br#"{"Version":3}"#).expect("model");
        fs::write(dir.join("textures/texture_00.png"), b"png-bytes").expect("texture");
        dir
    }

    fn write_live2d_import_source_with_third_party_extras(home: &Path) -> PathBuf {
        let dir = write_live2d_import_source(home);
        fs::write(dir.join(".DS_Store"), b"finder").expect("ds store");
        fs::write(dir.join("textures/._texture_00.png"), b"appledouble").expect("appledouble");
        fs::create_dir_all(dir.join("__MACOSX")).expect("macosx dir");
        fs::write(dir.join("__MACOSX/metadata.bin"), b"metadata").expect("macosx file");
        fs::write(dir.join("ReadMe.txt"), b"usage notes").expect("readme");
        fs::write(dir.join("LICENSE.md"), b"license").expect("license");
        fs::write(dir.join("textures/notes.txt"), b"texture notes").expect("notes");
        fs::write(dir.join("third-party-extension.bytes"), b"opaque").expect("opaque extension");
        dir
    }

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::from(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".as_slice());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    fn write_background_import_source(home: &Path) -> PathBuf {
        let path = home.join("source-background.png");
        fs::write(&path, png_bytes(1920, 1080)).expect("background source");
        path
    }

    fn operation_log_path(home: &Path) -> PathBuf {
        home.join(
            ".nimi/data/accounts/account_1/agents/agent_1/agent-center/operations/agent-center-local-resources.jsonl",
        )
    }

    fn account_operation_log_path(home: &Path) -> PathBuf {
        home.join(".nimi/data/accounts/account_1/operations/agent-center-local-resources.jsonl")
    }

    fn agent_center_marker(home: &Path, agent_id: &str) -> PathBuf {
        agent_center_marker_for_account(home, "account_1", agent_id)
    }

    fn agent_center_marker_for_account(home: &Path, account_id: &str, agent_id: &str) -> PathBuf {
        let dir = home
            .join(".nimi/data/accounts")
            .join(local_scope_path_segment(account_id))
            .join("agents")
            .join(local_scope_path_segment(agent_id))
            .join("agent-center");
        fs::create_dir_all(dir.join("modules/appearance")).expect("agent-center dir");
        fs::write(dir.join("modules/appearance/marker.txt"), b"local").expect("marker");
        dir
    }

    #[test]
    fn validates_package_and_writes_sidecar() {
        let home = temp_home("valid");
        with_env(&[("HOME", home.to_str())], || {
            let dir = write_valid_live2d_package(&home);
            let result = desktop_agent_center_avatar_package_validate(
                DesktopAgentCenterAvatarPackageValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    package_id: "live2d_ab12cd34ef56".to_string(),
                },
            )
            .expect("validate package");
            assert_eq!(
                result.status,
                AgentCenterAvatarPackageValidationStatus::Valid
            );
            assert!(dir.join(VALIDATION_FILE_NAME).exists());
        });
    }

    #[test]
    fn imports_live2d_package_transactionally_and_selects_it() {
        let home = temp_home("import-live2d");
        with_env(&[("HOME", home.to_str())], || {
            let source = write_live2d_import_source(&home);
            let result = desktop_agent_center_avatar_package_import(
                DesktopAgentCenterAvatarPackageImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    source_path: source.to_string_lossy().to_string(),
                    display_name: Some("Imported Avatar".to_string()),
                    select: Some(true),
                },
            )
            .expect("import live2d package");

            assert!(result.package_id.starts_with("live2d_"));
            assert_eq!(
                result.validation.status,
                AgentCenterAvatarPackageValidationStatus::Valid
            );
            let package_root = package_dir(
                "account_1",
                "agent_1",
                AgentCenterAvatarPackageKind::Live2d,
                &result.package_id,
            )
            .expect("package dir");
            assert!(package_root.join(MANIFEST_FILE_NAME).exists());
            assert!(package_root.join(VALIDATION_FILE_NAME).exists());
            assert!(package_root.join("files/model.model3.json").exists());
            assert!(package_root.join("files/textures/texture_00.png").exists());

            let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
            })
            .expect("config");
            assert_eq!(
                config
                    .modules
                    .avatar_package
                    .selected_package
                    .expect("selected")
                    .package_id,
                result.package_id
            );
            let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
            assert!(operations.contains("\"operation_type\":\"package_import\""));
            assert!(operations.contains("\"resource_kind\":\"avatar_package\""));
        });
    }

    #[test]
    fn imports_live2d_package_as_whole_folder_when_model3_entry_exists() {
        let home = temp_home("import-live2d-whole-folder");
        with_env(&[("HOME", home.to_str())], || {
            let source = write_live2d_import_source_with_third_party_extras(&home);
            let result = desktop_agent_center_avatar_package_import(
                DesktopAgentCenterAvatarPackageImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    source_path: source.to_string_lossy().to_string(),
                    display_name: Some("Imported Avatar".to_string()),
                    select: Some(true),
                },
            )
            .expect("import complete live2d folder");

            assert_eq!(
                result.validation.status,
                AgentCenterAvatarPackageValidationStatus::Valid
            );
            let package_root = package_dir(
                "account_1",
                "agent_1",
                AgentCenterAvatarPackageKind::Live2d,
                &result.package_id,
            )
            .expect("package dir");
            assert!(package_root.join("files/model.model3.json").exists());
            assert!(package_root.join("files/textures/texture_00.png").exists());
            assert!(package_root.join("files/.DS_Store").exists());
            assert!(package_root
                .join("files/textures/._texture_00.png")
                .exists());
            assert!(package_root.join("files/__MACOSX/metadata.bin").exists());
            assert!(package_root.join("files/ReadMe.txt").exists());
            assert!(package_root.join("files/LICENSE.md").exists());
            assert!(package_root.join("files/textures/notes.txt").exists());
            assert!(package_root
                .join("files/third-party-extension.bytes")
                .exists());
        });
    }

    #[test]
    fn imports_live2d_package_for_runtime_scoped_agent_id() {
        let home = temp_home("import-live2d-runtime-agent-id");
        with_env(&[("HOME", home.to_str())], || {
            let source = write_live2d_import_source(&home);
            let result = desktop_agent_center_avatar_package_import(
                DesktopAgentCenterAvatarPackageImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: "~agent_1_tffk".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    source_path: source.to_string_lossy().to_string(),
                    display_name: Some("Runtime Agent Avatar".to_string()),
                    select: Some(true),
                },
            )
            .expect("import live2d package for runtime scoped agent");

            assert_eq!(
                result.validation.status,
                AgentCenterAvatarPackageValidationStatus::Valid
            );
            let package_root = package_dir(
                "account_1",
                "~agent_1_tffk",
                AgentCenterAvatarPackageKind::Live2d,
                &result.package_id,
            )
            .expect("package dir");
            assert!(package_root.join(MANIFEST_FILE_NAME).exists());

            let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                agent_id: "~agent_1_tffk".to_string(),
            })
            .expect("runtime scoped config");
            assert_eq!(config.agent_id, "~agent_1_tffk");
            assert_eq!(
                config
                    .modules
                    .avatar_package
                    .selected_package
                    .expect("selected")
                    .package_id,
                result.package_id
            );
        });
    }

    #[test]
    fn imports_live2d_package_for_opaque_runtime_agent_id() {
        let home = temp_home("import-live2d-opaque-agent-id");
        with_env(&[("HOME", home.to_str())], || {
            let source = write_live2d_import_source(&home);
            let agent_id = "agent:abc.def+1";
            let result = desktop_agent_center_avatar_package_import(
                DesktopAgentCenterAvatarPackageImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: agent_id.to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    source_path: source.to_string_lossy().to_string(),
                    display_name: Some("Opaque Agent Avatar".to_string()),
                    select: Some(true),
                },
            )
            .expect("import live2d package for opaque runtime agent");

            assert_eq!(
                result.validation.status,
                AgentCenterAvatarPackageValidationStatus::Valid
            );
            let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                agent_id: agent_id.to_string(),
            })
            .expect("opaque runtime agent config");
            assert_eq!(config.agent_id, agent_id);
            assert_eq!(
                config
                    .modules
                    .avatar_package
                    .selected_package
                    .expect("selected")
                    .package_id,
                result.package_id
            );
        });
    }

    #[test]
    fn removes_selected_avatar_package_by_clearing_config_and_quarantining_directory() {
        let home = temp_home("remove-package");
        with_env(&[("HOME", home.to_str())], || {
            let package_root = write_valid_live2d_package(&home);
            select_imported_avatar_package(
                "account_1",
                "agent_1",
                AgentCenterAvatarPackageKind::Live2d,
                "live2d_ab12cd34ef56",
                "2026-04-27T00:00:00Z",
            )
            .expect("select package");
            let old_quarantine = home.join(format!(
                ".nimi/data/accounts/account_1/agents/agent_1/agent-center/quarantine/avatar_package/live2d_deadbeef0000_{}",
                (Utc::now() - Duration::days(8))
                    .timestamp_nanos_opt()
                    .unwrap_or(0)
            ));
            fs::create_dir_all(&old_quarantine).expect("old quarantine");

            let result = desktop_agent_center_avatar_package_remove(
                DesktopAgentCenterAvatarPackageRemovePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    package_id: "live2d_ab12cd34ef56".to_string(),
                },
            )
            .expect("remove package");

            assert!(result.quarantined);
            assert!(!package_root.exists());
            let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
            })
            .expect("config");
            assert!(config.modules.avatar_package.selected_package.is_none());
            assert!(home
                .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/quarantine/avatar_package")
                .read_dir()
                .expect("quarantine dir")
                .next()
                .is_some());
            assert!(!old_quarantine.exists());
            let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
            assert!(operations.contains("\"operation_type\":\"package_quarantine\""));
            assert!(operations.contains("\"reason_code\":\"user_removed\""));
        });
    }

    #[test]
    fn import_rejects_symlink_source_without_staging_residue() {
        let home = temp_home("import-symlink");
        with_env(&[("HOME", home.to_str())], || {
            let source = write_live2d_import_source(&home);
            #[cfg(unix)]
            {
                std::os::unix::fs::symlink(
                    source.join("model.model3.json"),
                    source.join("linked.model3.json"),
                )
                .expect("symlink");
                let err = desktop_agent_center_avatar_package_import(
                    DesktopAgentCenterAvatarPackageImportPayload {
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        kind: AgentCenterAvatarPackageKind::Live2d,
                        source_path: source.to_string_lossy().to_string(),
                        display_name: None,
                        select: Some(false),
                    },
                )
                .expect_err("symlink rejected");
                assert!(err.contains("symlink"));
                assert!(!home
                    .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/staging")
                    .exists());
            }
        });
    }

    #[test]
    fn imports_background_transactionally_and_selects_it() {
        let home = temp_home("import-background");
        with_env(&[("HOME", home.to_str())], || {
            let source = write_background_import_source(&home);
            let result =
                desktop_agent_center_background_import(DesktopAgentCenterBackgroundImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    source_path: source.to_string_lossy().to_string(),
                    display_name: Some("Imported Background".to_string()),
                    select: Some(true),
                })
                .expect("import background");

            assert!(result.background_asset_id.starts_with("bg_"));
            assert_eq!(
                result.validation.status,
                AgentCenterBackgroundValidationStatus::Valid
            );
            let dir = background_dir("account_1", "agent_1", &result.background_asset_id)
                .expect("background dir");
            assert!(dir.join(MANIFEST_FILE_NAME).exists());
            assert!(dir.join(VALIDATION_FILE_NAME).exists());
            assert!(dir.join("image.png").exists());
            let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
            })
            .expect("config");
            assert_eq!(
                config.modules.appearance.background_asset_id.as_deref(),
                Some(result.background_asset_id.as_str())
            );
            let asset = desktop_agent_center_background_asset_get(
                DesktopAgentCenterBackgroundValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    background_asset_id: result.background_asset_id,
                },
            )
            .expect("background asset");
            assert!(asset.file_url.starts_with("file://"));
            assert_eq!(
                asset.validation.status,
                AgentCenterBackgroundValidationStatus::Valid
            );
            let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
            assert!(operations.contains("\"operation_type\":\"background_import\""));
            assert!(operations.contains("\"resource_kind\":\"background\""));
        });
    }

    #[test]
    fn removes_selected_background_by_clearing_config_and_quarantining_directory() {
        let home = temp_home("remove-background");
        with_env(&[("HOME", home.to_str())], || {
            let background_root = write_valid_background(&home);
            select_imported_background("account_1", "agent_1", "bg_ab12cd34ef56")
                .expect("select background");

            let result =
                desktop_agent_center_background_remove(DesktopAgentCenterBackgroundRemovePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    background_asset_id: "bg_ab12cd34ef56".to_string(),
                })
                .expect("remove background");

            assert!(result.quarantined);
            assert!(!background_root.exists());
            let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
            })
            .expect("config");
            assert!(config.modules.appearance.background_asset_id.is_none());
            assert!(home
                .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/quarantine/background")
                .read_dir()
                .expect("quarantine dir")
                .next()
                .is_some());
            let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
            assert!(operations.contains("\"operation_type\":\"background_quarantine\""));
            assert!(operations.contains("\"reason_code\":\"user_removed\""));
        });
    }

    #[test]
    fn removes_agent_local_resources_by_quarantining_agent_center_tree() {
        let home = temp_home("remove-agent-tree");
        with_env(&[("HOME", home.to_str())], || {
            let agent_center = agent_center_marker(&home, "agent_1");

            let result = desktop_agent_center_agent_local_resources_remove(
                DesktopAgentCenterAgentLocalResourcesRemovePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                },
            )
            .expect("remove agent local resources");

            assert_eq!(result.resource_kind, "agent_local_resources");
            assert_eq!(result.resource_id, "agent_1");
            assert!(result.quarantined);
            assert!(!agent_center.exists());
            let quarantine_root =
                home.join(".nimi/data/accounts/account_1/quarantine/agent_local_resources");
            let quarantined = quarantine_root
                .read_dir()
                .expect("agent quarantine dir")
                .next()
                .expect("quarantined agent tree")
                .expect("quarantine entry")
                .path();
            assert!(quarantined.join("modules/appearance/marker.txt").exists());
            let operations = fs::read_to_string(
                quarantined.join("operations/agent-center-local-resources.jsonl"),
            )
            .expect("quarantined operation log");
            assert!(operations.contains("\"operation_type\":\"agent_local_resources_quarantine\""));
            assert!(operations.contains("\"reason_code\":\"agent_removed\""));
        });
    }

    #[test]
    fn removes_account_local_resources_by_quarantining_each_agent_center_tree() {
        let home = temp_home("remove-account-tree");
        with_env(&[("HOME", home.to_str())], || {
            let agent_one = agent_center_marker(&home, "agent_1");
            let agent_two = agent_center_marker(&home, "agent_2");

            let result = desktop_agent_center_account_local_resources_remove(
                DesktopAgentCenterAccountLocalResourcesRemovePayload {
                    account_id: "account_1".to_string(),
                },
            )
            .expect("remove account local resources");

            assert_eq!(result.resource_kind, "account_local_resources");
            assert_eq!(result.resource_id, "account_1");
            assert!(result.quarantined);
            assert!(!agent_one.exists());
            assert!(!agent_two.exists());
            let quarantine_root =
                home.join(".nimi/data/accounts/account_1/quarantine/agent_local_resources");
            let quarantined_count = quarantine_root
                .read_dir()
                .expect("account quarantine dir")
                .filter_map(Result::ok)
                .count();
            assert_eq!(quarantined_count, 2);
            let account_operations =
                fs::read_to_string(account_operation_log_path(&home)).expect("account log");
            assert!(account_operations
                .contains("\"operation_type\":\"account_local_resources_quarantine\""));
            assert!(account_operations.contains("\"reason_code\":\"account_removed\""));
        });
    }

    #[test]
    fn removes_account_local_resources_for_opaque_account_ids() {
        let home = temp_home("remove-opaque-account-tree");
        with_env(&[("HOME", home.to_str())], || {
            let account_id = "account:abc.def+1";
            let account_segment = local_scope_path_segment(account_id);
            let agent_center =
                agent_center_marker_for_account(&home, account_id, "agent:abc.def+1");

            let result = desktop_agent_center_account_local_resources_remove(
                DesktopAgentCenterAccountLocalResourcesRemovePayload {
                    account_id: account_id.to_string(),
                },
            )
            .expect("remove opaque account local resources");

            assert_eq!(result.resource_kind, "account_local_resources");
            assert_eq!(result.resource_id, account_id);
            assert!(result.quarantined);
            assert!(!agent_center.exists());
            let quarantine_root = home
                .join(".nimi/data/accounts")
                .join(account_segment)
                .join("quarantine/agent_local_resources");
            let quarantined_count = quarantine_root
                .read_dir()
                .expect("opaque account quarantine dir")
                .filter_map(Result::ok)
                .count();
            assert_eq!(quarantined_count, 1);
        });
    }

    #[test]
    fn import_rejects_svg_background_before_staging() {
        let home = temp_home("import-background-svg");
        with_env(&[("HOME", home.to_str())], || {
            let source = home.join("source-background.svg");
            fs::write(&source, b"<svg></svg>").expect("svg");
            let err =
                desktop_agent_center_background_import(DesktopAgentCenterBackgroundImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    source_path: source.to_string_lossy().to_string(),
                    display_name: None,
                    select: Some(true),
                })
                .expect_err("svg rejected");
            assert!(err.contains("SVG"));
            assert!(!home
                .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/appearance/staging")
                .exists());
        });
    }

    #[test]
    fn rejects_manifest_that_embeds_validation_status() {
        let home = temp_home("embedded-validation");
        with_env(&[("HOME", home.to_str())], || {
            let dir = write_valid_live2d_package(&home);
            let mut value: serde_json::Value = serde_json::from_str(
                &fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).expect("read manifest"),
            )
            .expect("manifest");
            value["validation"] = json!({"status": "valid"});
            fs::write(dir.join(MANIFEST_FILE_NAME), value.to_string()).expect("write manifest");
            let result = desktop_agent_center_avatar_package_validate(
                DesktopAgentCenterAvatarPackageValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    package_id: "live2d_ab12cd34ef56".to_string(),
                },
            )
            .expect("validate package");
            assert_eq!(
                result.status,
                AgentCenterAvatarPackageValidationStatus::InvalidManifest
            );
            assert!(result
                .errors
                .iter()
                .any(|entry| entry.code == "manifest_embeds_validation"));
        });
    }

    #[test]
    fn rejects_digest_mismatch() {
        let home = temp_home("digest");
        with_env(&[("HOME", home.to_str())], || {
            let dir = write_valid_live2d_package(&home);
            fs::write(dir.join("files/model.model3.json"), b"changed").expect("change file");
            let result = desktop_agent_center_avatar_package_validate(
                DesktopAgentCenterAvatarPackageValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    package_id: "live2d_ab12cd34ef56".to_string(),
                },
            )
            .expect("validate package");
            assert!(result
                .errors
                .iter()
                .any(|entry| entry.code == "content_digest_mismatch"));
        });
    }

    #[test]
    fn rejects_parent_traversal_path() {
        let home = temp_home("traversal");
        with_env(&[("HOME", home.to_str())], || {
            let dir = write_valid_live2d_package(&home);
            let mut value: serde_json::Value = serde_json::from_str(
                &fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).expect("read manifest"),
            )
            .expect("manifest");
            value["files"][0]["path"] = json!("../escape.json");
            fs::write(dir.join(MANIFEST_FILE_NAME), value.to_string()).expect("write manifest");
            let result = desktop_agent_center_avatar_package_validate(
                DesktopAgentCenterAvatarPackageValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    package_id: "live2d_ab12cd34ef56".to_string(),
                },
            )
            .expect("validate package");
            assert_eq!(
                result.status,
                AgentCenterAvatarPackageValidationStatus::PathRejected
            );
        });
    }

    #[test]
    fn validates_background_and_writes_sidecar() {
        let home = temp_home("background");
        with_env(&[("HOME", home.to_str())], || {
            let dir = write_valid_background(&home);
            let result = desktop_agent_center_background_validate(
                DesktopAgentCenterBackgroundValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    background_asset_id: "bg_ab12cd34ef56".to_string(),
                },
            )
            .expect("validate background");
            assert_eq!(result.status, AgentCenterBackgroundValidationStatus::Valid);
            assert!(dir.join(VALIDATION_FILE_NAME).exists());
        });
    }

    #[test]
    fn rejects_svg_background_manifest() {
        let home = temp_home("background-svg");
        with_env(&[("HOME", home.to_str())], || {
            let dir = write_valid_background(&home);
            let mut value: serde_json::Value = serde_json::from_str(
                &fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).expect("read manifest"),
            )
            .expect("manifest");
            value["image_file"] = json!("image.svg");
            value["mime"] = json!("image/svg+xml");
            fs::write(dir.join("image.svg"), b"<svg></svg>").expect("svg");
            fs::write(dir.join(MANIFEST_FILE_NAME), value.to_string()).expect("write manifest");
            let result = desktop_agent_center_background_validate(
                DesktopAgentCenterBackgroundValidatePayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    background_asset_id: "bg_ab12cd34ef56".to_string(),
                },
            )
            .expect("validate background");
            assert_eq!(
                result.status,
                AgentCenterBackgroundValidationStatus::UnsupportedMime
            );
        });
    }
}
