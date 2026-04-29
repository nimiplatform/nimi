use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
pub(crate) struct ModelManifest {
    pub(crate) runtime_dir: String,
    pub(crate) model_id: String,
    pub(crate) model3_json_path: String,
    pub(crate) nimi_dir: Option<String>,
    pub(crate) adapter_manifest_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentCenterAvatarPackageResolvePayload {
    pub(crate) account_id: String,
    pub(crate) agent_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarPackageManifest {
    manifest_version: u8,
    package_version: String,
    package_id: String,
    kind: String,
    loader_min_version: String,
    display_name: String,
    #[serde(default)]
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AgentCenterAvatarPackageManifestFile>,
    limits: AgentCenterAvatarPackageManifestLimits,
    capabilities: serde_json::Value,
    import: AgentCenterAvatarPackageManifestImport,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarPackageManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarPackageManifestLimits {
    max_manifest_bytes: u64,
    max_package_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarPackageManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterLocalConfig {
    schema_version: u8,
    config_kind: String,
    account_id: String,
    agent_id: String,
    modules: AgentCenterLocalConfigModules,
}

#[derive(Deserialize)]
struct AgentCenterLocalConfigModules {
    avatar_package: AgentCenterAvatarPackageModule,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarPackageModule {
    schema_version: u8,
    selected_package: Option<AgentCenterSelectedAvatarPackage>,
    last_validated_at: Option<String>,
    last_launch_package_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterSelectedAvatarPackage {
    kind: String,
    package_id: String,
}

fn validate_agent_center_id(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field} is required"));
    }
    if normalized.len() > 256 {
        return Err(format!("{field} must use normalized local id characters"));
    }
    if normalized == "." || normalized == ".." || normalized.contains("://") {
        return Err(format!("{field} must use normalized local id characters"));
    }
    if !normalized.chars().any(|ch| ch.is_ascii_alphanumeric()) {
        return Err(format!("{field} must use normalized local id characters"));
    }
    for ch in normalized.chars() {
        let allowed =
            ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '~' | ':' | '@' | '+');
        if !allowed {
            return Err(format!("{field} must use normalized local id characters"));
        }
    }
    Ok(normalized.to_string())
}

fn can_use_raw_agent_center_path_segment(value: &str) -> bool {
    let body = value.strip_prefix('~').unwrap_or(value);
    if body.is_empty() || value.len() > 128 {
        return false;
    }
    let mut chars = body.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit())
        && body
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
}

pub(crate) fn agent_center_path_segment(value: &str) -> String {
    if can_use_raw_agent_center_path_segment(value) {
        return value.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("id_{}", &digest[..24])
}

fn validate_avatar_package_id(value: &str, kind: &str) -> Result<String, String> {
    let normalized = value.trim();
    let expected_prefix = format!("{kind}_");
    if !normalized.starts_with(expected_prefix.as_str()) {
        return Err("avatar_package_id must match avatar_package_kind".to_string());
    }
    let suffix = &normalized[expected_prefix.len()..];
    if suffix.len() != 12
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return Err(
            "avatar_package_id must use a 12-character lowercase hex digest suffix".to_string(),
        );
    }
    Ok(normalized.to_string())
}

fn is_safe_package_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !value.contains('\\')
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn sha256_file_hex(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("failed to open package file {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer)
            .map_err(|error| format!("failed to read package file {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

fn resolve_home_data_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .ok_or_else(|| "home directory is unavailable".to_string())?;
    Ok(home.join(".nimi").join("data"))
}

fn resolve_agent_center_avatar_package_dir(
    data_root: &Path,
    account_id: &str,
    agent_id: &str,
    kind: &str,
    package_id: &str,
) -> Result<PathBuf, String> {
    Ok(data_root
        .join("accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(agent_id))
        .join("agent-center")
        .join("modules")
        .join("avatar_package")
        .join("packages")
        .join(kind)
        .join(package_id))
}

fn read_selected_avatar_package(
    data_root: &Path,
    account_id: &str,
    agent_id: &str,
) -> Result<(String, String), String> {
    let config_path = data_root
        .join("accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(agent_id))
        .join("agent-center")
        .join("config.json");
    let raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("agent center local config is unavailable: {error}"))?;
    if raw.len() > 262_144 {
        return Err("agent center local config exceeds the admitted size cap".to_string());
    }
    let config: AgentCenterLocalConfig = serde_json::from_str(&raw)
        .map_err(|error| format!("invalid agent center local config: {error}"))?;
    if config.schema_version != 1 || config.config_kind != "agent_center_local_config" {
        return Err("agent center local config identity is not admitted".to_string());
    }
    if validate_agent_center_id(&config.account_id, "config.account_id")? != account_id
        || validate_agent_center_id(&config.agent_id, "config.agent_id")? != agent_id
    {
        return Err(
            "agent center local config scope does not match Runtime account projection".to_string(),
        );
    }
    if config.modules.avatar_package.schema_version != 1 {
        return Err("modules.avatar_package.schema_version must be 1".to_string());
    }
    let selected = config
        .modules
        .avatar_package
        .selected_package
        .ok_or_else(|| "avatar package is not selected".to_string())?;
    let kind = selected.kind.trim().to_string();
    if kind != "live2d" {
        return Err("avatar package loader currently supports Live2D packages only".to_string());
    }
    let package_id = validate_avatar_package_id(&selected.package_id, kind.as_str())?;
    let _ = (
        config.modules.avatar_package.last_validated_at,
        config.modules.avatar_package.last_launch_package_id,
    );
    Ok((kind, package_id))
}

fn find_agent_center_avatar_package_dir(
    data_root: &Path,
    account_id: &str,
    agent_id: &str,
    kind: &str,
    package_id: &str,
) -> Result<PathBuf, String> {
    let candidate =
        resolve_agent_center_avatar_package_dir(data_root, account_id, agent_id, kind, package_id)?;
    if candidate.exists() {
        return Ok(candidate);
    }
    Err("avatar package is unavailable".to_string())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_resolve_agent_center_avatar_package(
    payload: AgentCenterAvatarPackageResolvePayload,
) -> Result<ModelManifest, String> {
    let account_id = validate_agent_center_id(&payload.account_id, "account_id")?;
    let agent_id = validate_agent_center_id(&payload.agent_id, "agent_id")?;
    let data_root = resolve_home_data_root()?;
    let (kind, package_id) = read_selected_avatar_package(&data_root, &account_id, &agent_id)?;
    let package_dir = find_agent_center_avatar_package_dir(
        &data_root,
        &account_id,
        &agent_id,
        kind.as_str(),
        package_id.as_str(),
    )?;
    let canonical_data_root = data_root
        .canonicalize()
        .map_err(|error| format!("agent center data root is unavailable: {error}"))?;
    let canonical_package_dir = package_dir
        .canonicalize()
        .map_err(|error| format!("avatar package is unavailable: {error}"))?;
    if !canonical_package_dir.starts_with(&canonical_data_root) {
        return Err("avatar package path escaped the Agent Center data root".to_string());
    }

    let manifest_path = canonical_package_dir.join("manifest.json");
    let manifest_meta = fs::symlink_metadata(&manifest_path)
        .map_err(|error| format!("avatar package manifest is unavailable: {error}"))?;
    if !manifest_meta.is_file() || manifest_meta.file_type().is_symlink() {
        return Err("avatar package manifest must be a regular file".to_string());
    }
    if manifest_meta.len() > 262_144 {
        return Err("avatar package manifest exceeds the admitted size cap".to_string());
    }
    let manifest_raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("failed to read avatar package manifest: {error}"))?;
    let manifest: AgentCenterAvatarPackageManifest = serde_json::from_str(&manifest_raw)
        .map_err(|error| format!("invalid avatar package manifest: {error}"))?;
    if manifest.manifest_version != 1 {
        return Err("avatar package manifest_version must be 1".to_string());
    }
    if manifest.package_id != package_id || manifest.kind != kind {
        return Err(
            "avatar package manifest identity does not match selected Agent Center package"
                .to_string(),
        );
    }
    if manifest.loader_min_version.trim() != "1.0.0" {
        return Err("avatar package loader_min_version is not admitted".to_string());
    }
    if !is_safe_package_relative_path(&manifest.entry_file)
        || !manifest.entry_file.starts_with("files/")
        || !manifest.entry_file.ends_with(".model3.json")
    {
        return Err(
            "avatar package entry_file must point at a Live2D model3 file under files/".to_string(),
        );
    }
    if !manifest
        .required_files
        .iter()
        .any(|path| path == &manifest.entry_file)
    {
        return Err("avatar package required_files must include entry_file".to_string());
    }
    if manifest.limits.max_manifest_bytes != 262_144
        || manifest.limits.max_package_bytes != 524_288_000
        || manifest.limits.max_file_bytes != 104_857_600
        || manifest.limits.max_file_count != 2_048
    {
        return Err("avatar package limits do not match the admitted loader caps".to_string());
    }

    let entry_file_record = manifest
        .files
        .iter()
        .find(|file| file.path == manifest.entry_file)
        .ok_or_else(|| "avatar package files must describe entry_file".to_string())?;
    if entry_file_record.mime != "application/json" {
        return Err("avatar package entry_file must be application/json".to_string());
    }
    if !entry_file_record
        .sha256
        .chars()
        .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
        || entry_file_record.sha256.len() != 64
    {
        return Err("avatar package entry_file digest is invalid".to_string());
    }
    let entry_path = canonical_package_dir.join(&manifest.entry_file);
    let entry_meta = fs::symlink_metadata(&entry_path)
        .map_err(|error| format!("avatar package entry_file is unavailable: {error}"))?;
    if !entry_meta.is_file() || entry_meta.file_type().is_symlink() {
        return Err("avatar package entry_file must be a regular file".to_string());
    }
    let canonical_entry_path = entry_path
        .canonicalize()
        .map_err(|error| format!("avatar package entry_file cannot be resolved: {error}"))?;
    if !canonical_entry_path.starts_with(&canonical_package_dir) {
        return Err("avatar package entry_file escaped the package root".to_string());
    }
    let (entry_bytes, entry_sha256) = sha256_file_hex(&canonical_entry_path)?;
    if entry_bytes != entry_file_record.bytes || entry_sha256 != entry_file_record.sha256 {
        return Err("avatar package entry_file content differs from manifest".to_string());
    }
    let runtime_dir = canonical_entry_path
        .parent()
        .ok_or_else(|| "avatar package entry_file has no parent directory".to_string())?
        .to_path_buf();
    let model_id = canonical_entry_path
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(|value| value.strip_suffix(".model3.json"))
        .ok_or_else(|| "failed to infer model_id from package entry_file".to_string())?
        .to_string();
    let nimi_dir = {
        let candidate = runtime_dir.join("nimi");
        if candidate.is_dir() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    let adapter_manifest_path = {
        let candidate = runtime_dir.join("nimi").join("live2d-adapter.json");
        if candidate.is_file() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    let _ = (
        manifest.package_version,
        manifest.display_name,
        manifest.display_name_i18n,
        manifest.content_digest,
        manifest.capabilities,
        manifest.import.imported_at,
        manifest.import.source_label,
        manifest.import.source_fingerprint,
    );
    Ok(ModelManifest {
        runtime_dir: runtime_dir.display().to_string(),
        model_id,
        model3_json_path: canonical_entry_path.display().to_string(),
        nimi_dir,
        adapter_manifest_path,
    })
}
