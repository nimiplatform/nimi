use std::fs;
use std::path::{Path, PathBuf};

// Local Avatar asset materialization resolver. Agent Center paths are current
// Desktop storage plumbing for user-imported private skins, not package lifecycle,
// inventory, or activation authority.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::runtime_local_agent_identity::project_runtime_local_agent_identity;

#[derive(Debug, Serialize)]
pub struct ModelManifest {
    pub kind: String,
    pub runtime_dir: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model3_json_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vrm_file_path: Option<String>,
    pub nimi_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_presets_dir: Option<String>,
    pub adapter_manifest_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCenterAvatarAssetResolvePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub backend_kind: String,
    pub local_avatar_asset_ref: String,
    pub backend_capability_profile_ref: String,
    pub materialization_ref: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAvatarAssetResolvePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterLocalConfigFile {
    schema_version: u8,
    config_kind: String,
    account_id: String,
    owner_user_id: String,
    realm_agent_id: String,
    local_agent_ref: String,
    modules: AgentCenterLocalConfigModules,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterLocalConfigModules {
    appearance: serde_json::Value,
    avatar_asset: AgentCenterLocalAvatarAssetSelection,
    local_history: serde_json::Value,
    ui: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterLocalAvatarAssetSelection {
    schema_version: u8,
    conversation_anchor_scope: String,
    local_avatar_asset_ref: Option<String>,
    live2d_adapter_manifest_source: String,
    live2d_adapter_manifest_ref: Option<String>,
    avatar_instance_policy: String,
    backend_kind: String,
    backend_capability_profile_ref: Option<String>,
    generated_motion_provider_policy: String,
    launch_mode: String,
    debug_profile: String,
    updated_at: String,
    provenance: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarAssetManifest {
    manifest_version: u8,
    asset_version: String,
    local_asset_id: String,
    kind: String,
    loader_min_version: String,
    display_name: String,
    #[serde(default)]
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AgentCenterAvatarAssetManifestFile>,
    limits: AgentCenterAvatarAssetManifestLimits,
    capabilities: serde_json::Value,
    import: AgentCenterAvatarAssetManifestImport,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarAssetManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarAssetManifestLimits {
    max_manifest_bytes: u64,
    max_asset_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterAvatarAssetManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
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

pub fn agent_center_path_segment(value: &str) -> String {
    if can_use_raw_agent_center_path_segment(value) {
        return value.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("id_{}", &digest[..24])
}

fn validate_avatar_asset_id(value: &str, kind: &str) -> Result<String, String> {
    let normalized = value.trim();
    let expected_prefix = format!("{kind}_");
    if !normalized.starts_with(expected_prefix.as_str()) {
        return Err("avatar_asset_id must match avatar_asset_kind".to_string());
    }
    let suffix = &normalized[expected_prefix.len()..];
    if suffix.len() != 12
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return Err(
            "avatar_asset_id must use a 12-character lowercase hex digest suffix".to_string(),
        );
    }
    Ok(normalized.to_string())
}

fn validate_handoff_ref(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.len() > 512 {
        return Err(format!("{field} is required"));
    }
    if normalized.contains('\0') || normalized.contains('\\') || normalized.contains("://") {
        return Err(format!("{field} must be an opaque Runtime-authorized ref"));
    }
    Ok(normalized.to_string())
}

fn expected_materialization_ref(
    account_id: &str,
    local_agent_ref: &str,
    kind: &str,
    local_asset_id: &str,
) -> String {
    format!(
        "agent-center-avatar-asset:{}:{}:{kind}:{local_asset_id}",
        agent_center_path_segment(account_id),
        agent_center_path_segment(local_agent_ref),
    )
}

fn read_local_avatar_asset_selection(
    data_root: &Path,
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
) -> Result<AgentCenterLocalAvatarAssetSelection, String> {
    let config_path = data_root
        .join("accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(local_agent_ref))
        .join("agent-center")
        .join("config.json");
    let raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("local Avatar asset config is unavailable: {error}"))?;
    let config: AgentCenterLocalConfigFile = serde_json::from_str(&raw)
        .map_err(|error| format!("local Avatar asset config is invalid: {error}"))?;
    if config.schema_version != 1 || config.config_kind != "agent_center_local_config" {
        return Err("local Avatar asset config kind is invalid".to_string());
    }
    if config.account_id != account_id
        || config.owner_user_id != owner_user_id
        || config.realm_agent_id != realm_agent_id
        || config.local_agent_ref != local_agent_ref
    {
        return Err("local Avatar asset config scope mismatch".to_string());
    }
    let selection = config.modules.avatar_asset;
    if selection.schema_version != 1 {
        return Err("local Avatar asset module schema_version must be 1".to_string());
    }
    let _ = (
        &config.modules.appearance,
        &config.modules.local_history,
        &config.modules.ui,
        &selection.conversation_anchor_scope,
        &selection.live2d_adapter_manifest_source,
        &selection.live2d_adapter_manifest_ref,
        &selection.avatar_instance_policy,
        &selection.generated_motion_provider_policy,
        &selection.launch_mode,
        &selection.debug_profile,
        &selection.updated_at,
        &selection.provenance,
    );
    Ok(selection)
}

fn is_safe_asset_relative_path(value: &str) -> bool {
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

fn resolve_admitted_data_root() -> Result<PathBuf, String> {
    crate::desktop_paths::resolve_nimi_data_dir()
}

fn resolve_agent_center_avatar_asset_dir(
    data_root: &Path,
    account_id: &str,
    agent_id: &str,
    kind: &str,
    local_asset_id: &str,
) -> Result<PathBuf, String> {
    Ok(data_root
        .join("accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(agent_id))
        .join("agent-center")
        .join("modules")
        .join("avatar_asset")
        .join("packages")
        .join(kind)
        .join(local_asset_id))
}

fn find_agent_center_avatar_asset_dir(
    data_root: &Path,
    account_id: &str,
    agent_id: &str,
    kind: &str,
    local_asset_id: &str,
) -> Result<PathBuf, String> {
    let candidate = resolve_agent_center_avatar_asset_dir(
        data_root,
        account_id,
        agent_id,
        kind,
        local_asset_id,
    )?;
    if candidate.exists() {
        return Ok(candidate);
    }
    Err("avatar asset is unavailable".to_string())
}

#[tauri::command]
pub async fn nimi_avatar_resolve_agent_center_avatar_asset(
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<ModelManifest, String> {
    let account_id = validate_agent_center_id(&payload.account_id, "account_id")?;
    let owner_user_id = validate_agent_center_id(&payload.owner_user_id, "owner_user_id")?;
    let realm_agent_id = validate_agent_center_id(&payload.realm_agent_id, "realm_agent_id")?;
    let local_agent_ref = validate_agent_center_id(&payload.local_agent_ref, "local_agent_ref")?;
    let kind = payload.backend_kind.trim().to_string();
    if kind != "live2d" && kind != "vrm" {
        return Err("avatar_asset_kind must be live2d or vrm".to_string());
    }
    let local_asset_id = validate_avatar_asset_id(&payload.local_avatar_asset_ref, kind.as_str())?;
    let _backend_capability_profile_ref = validate_handoff_ref(
        &payload.backend_capability_profile_ref,
        "backend_capability_profile_ref",
    )?;
    if local_agent_ref == realm_agent_id {
        return Err("local_agent_ref must not be a bare realm_agent_id".to_string());
    }
    let local_agent_ref = project_runtime_local_agent_identity(
        &owner_user_id,
        &realm_agent_id,
        Some(&local_agent_ref),
    )
    .map(|identity| identity.local_agent_ref)
    .map_err(|_| {
        "local_agent_ref must equal local-agent:${owner_user_id}:${realm_agent_id}".to_string()
    })?;
    let data_root = resolve_admitted_data_root()?;
    let materialization_ref =
        validate_handoff_ref(&payload.materialization_ref, "materialization_ref")?;
    let expected_ref = expected_materialization_ref(
        &account_id,
        &local_agent_ref,
        kind.as_str(),
        local_asset_id.as_str(),
    );
    if materialization_ref != expected_ref {
        return Err(
            "materialization_ref does not match the authorized local Avatar asset".to_string(),
        );
    }
    let asset_dir = find_agent_center_avatar_asset_dir(
        &data_root,
        &account_id,
        &local_agent_ref,
        kind.as_str(),
        local_asset_id.as_str(),
    )?;
    let canonical_data_root = data_root
        .canonicalize()
        .map_err(|error| format!("agent center data root is unavailable: {error}"))?;
    let canonical_asset_dir = asset_dir
        .canonicalize()
        .map_err(|error| format!("avatar asset is unavailable: {error}"))?;
    if !canonical_asset_dir.starts_with(&canonical_data_root) {
        return Err("avatar asset path escaped the Agent Center data root".to_string());
    }

    let manifest_path = canonical_asset_dir.join("manifest.json");
    let manifest_meta = fs::symlink_metadata(&manifest_path)
        .map_err(|error| format!("avatar asset manifest is unavailable: {error}"))?;
    if !manifest_meta.is_file() || manifest_meta.file_type().is_symlink() {
        return Err("avatar asset manifest must be a regular file".to_string());
    }
    if manifest_meta.len() > 262_144 {
        return Err("avatar asset manifest exceeds the admitted size cap".to_string());
    }
    let manifest_raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("failed to read avatar asset manifest: {error}"))?;
    let manifest: AgentCenterAvatarAssetManifest = serde_json::from_str(&manifest_raw)
        .map_err(|error| format!("invalid avatar asset manifest: {error}"))?;
    if manifest.manifest_version != 1 {
        return Err("avatar asset manifest_version must be 1".to_string());
    }
    if manifest.local_asset_id != local_asset_id || manifest.kind != kind {
        return Err(
            "avatar asset manifest identity does not match local Avatar asset selection"
                .to_string(),
        );
    }
    if manifest.loader_min_version.trim() != "1.0.0" {
        return Err("avatar asset loader_min_version is not admitted".to_string());
    }
    if !is_safe_asset_relative_path(&manifest.entry_file)
        || !manifest.entry_file.starts_with("files/")
    {
        return Err("avatar asset entry_file must point under files/".to_string());
    }
    match kind.as_str() {
        "live2d" if !manifest.entry_file.ends_with(".model3.json") => {
            return Err(
                "avatar asset entry_file must point at a Live2D model3 file under files/"
                    .to_string(),
            );
        }
        "vrm" if !manifest.entry_file.ends_with(".vrm") => {
            return Err(
                "avatar asset entry_file must point at a VRM file under files/".to_string(),
            );
        }
        _ => {}
    }
    if !manifest
        .required_files
        .iter()
        .any(|path| path == &manifest.entry_file)
    {
        return Err("avatar asset required_files must include entry_file".to_string());
    }
    if manifest.limits.max_manifest_bytes != 262_144
        || manifest.limits.max_asset_bytes != 524_288_000
        || manifest.limits.max_file_bytes != 104_857_600
        || manifest.limits.max_file_count != 2_048
    {
        return Err("avatar asset limits do not match the admitted loader caps".to_string());
    }

    let entry_file_record = manifest
        .files
        .iter()
        .find(|file| file.path == manifest.entry_file)
        .ok_or_else(|| "avatar asset files must describe entry_file".to_string())?;
    match kind.as_str() {
        "live2d" if entry_file_record.mime != "application/json" => {
            return Err("avatar asset entry_file must be application/json".to_string());
        }
        "vrm" if entry_file_record.mime != "model/vrm" => {
            return Err("avatar asset entry_file must be model/vrm".to_string());
        }
        _ => {}
    }
    if !entry_file_record
        .sha256
        .chars()
        .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
        || entry_file_record.sha256.len() != 64
    {
        return Err("avatar asset entry_file digest is invalid".to_string());
    }
    let entry_path = canonical_asset_dir.join(&manifest.entry_file);
    let entry_meta = fs::symlink_metadata(&entry_path)
        .map_err(|error| format!("avatar asset entry_file is unavailable: {error}"))?;
    if !entry_meta.is_file() || entry_meta.file_type().is_symlink() {
        return Err("avatar asset entry_file must be a regular file".to_string());
    }
    let canonical_entry_path = entry_path
        .canonicalize()
        .map_err(|error| format!("avatar asset entry_file cannot be resolved: {error}"))?;
    if !canonical_entry_path.starts_with(&canonical_asset_dir) {
        return Err("avatar asset entry_file escaped the asset root".to_string());
    }
    // Offload entry-file hashing to the blocking pool. VRM payloads can be
    // 50–500MB; doing a synchronous read+SHA256 on the Tauri command worker
    // pool serialised concurrent IPC calls (asset:// reads, runtime gRPC
    // bridge) and pushed `driver_start` past its 12s timeout. Live2D files
    // are small enough that the in-pool synchronous hash never tripped this.
    let hash_path = canonical_entry_path.clone();
    let (entry_bytes, entry_sha256) =
        tokio::task::spawn_blocking(move || sha256_file_hex(&hash_path))
            .await
            .map_err(|error| format!("avatar asset digest task failed: {error}"))??;
    if entry_bytes != entry_file_record.bytes || entry_sha256 != entry_file_record.sha256 {
        return Err("avatar asset entry_file content differs from manifest".to_string());
    }
    let runtime_dir = canonical_entry_path
        .parent()
        .ok_or_else(|| "avatar asset entry_file has no parent directory".to_string())?
        .to_path_buf();
    let model_id = match kind.as_str() {
        "live2d" => canonical_entry_path
            .file_name()
            .and_then(|value| value.to_str())
            .and_then(|value| value.strip_suffix(".model3.json"))
            .ok_or_else(|| "failed to infer model_id from asset entry_file".to_string())?
            .to_string(),
        "vrm" => canonical_entry_path
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "failed to infer model_id from asset entry_file".to_string())?
            .to_string(),
        _ => return Err("avatar_asset_kind must be live2d or vrm".to_string()),
    };
    let nimi_dir = {
        let candidate = runtime_dir.join("nimi");
        if candidate.is_dir() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    let adapter_manifest_path = if kind == "live2d" {
        let candidate = runtime_dir.join("nimi").join("live2d-adapter.json");
        if candidate.exists() {
            let metadata = fs::symlink_metadata(&candidate).map_err(|error| {
                format!("embedded Live2D adapter manifest is unavailable: {error}")
            })?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("embedded Live2D adapter manifest must be a regular file".to_string());
            }
            let canonical = candidate.canonicalize().map_err(|error| {
                format!("embedded Live2D adapter manifest cannot be resolved: {error}")
            })?;
            if !canonical.starts_with(&canonical_asset_dir) {
                return Err("embedded Live2D adapter manifest escaped the asset root".to_string());
            }
            Some(canonical.display().to_string())
        } else {
            None
        }
    } else {
        None
    };
    let motion_presets_dir = {
        let candidate = runtime_dir.join("vrm-motion-presets");
        if kind == "vrm" && candidate.is_dir() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    let _ = (
        manifest.asset_version,
        manifest.display_name,
        manifest.display_name_i18n,
        manifest.content_digest,
        manifest.capabilities,
        manifest.import.imported_at,
        manifest.import.source_label,
        manifest.import.source_fingerprint,
    );
    Ok(ModelManifest {
        kind,
        runtime_dir: runtime_dir.display().to_string(),
        model_id,
        model3_json_path: if manifest.entry_file.ends_with(".model3.json") {
            Some(canonical_entry_path.display().to_string())
        } else {
            None
        },
        vrm_file_path: if manifest.entry_file.ends_with(".vrm") {
            Some(canonical_entry_path.display().to_string())
        } else {
            None
        },
        nimi_dir,
        motion_presets_dir,
        adapter_manifest_path,
    })
}

#[tauri::command]
pub async fn nimi_avatar_resolve_local_avatar_asset(
    payload: LocalAvatarAssetResolvePayload,
) -> Result<ModelManifest, String> {
    let account_id = validate_agent_center_id(&payload.account_id, "account_id")?;
    let owner_user_id = validate_agent_center_id(&payload.owner_user_id, "owner_user_id")?;
    let realm_agent_id = validate_agent_center_id(&payload.realm_agent_id, "realm_agent_id")?;
    let local_agent_ref = validate_agent_center_id(&payload.local_agent_ref, "local_agent_ref")?;
    if account_id != owner_user_id {
        return Err("local Avatar asset account_id must equal owner_user_id".to_string());
    }
    let local_agent_ref = project_runtime_local_agent_identity(
        &owner_user_id,
        &realm_agent_id,
        Some(&local_agent_ref),
    )
    .map(|identity| identity.local_agent_ref)
    .map_err(|_| {
        "local Avatar asset local_agent_ref must equal local-agent:${owner_user_id}:${realm_agent_id}"
            .to_string()
    })?;
    let data_root = resolve_admitted_data_root()?;
    let selection = read_local_avatar_asset_selection(
        &data_root,
        &account_id,
        &owner_user_id,
        &realm_agent_id,
        &local_agent_ref,
    )?;
    let kind = selection.backend_kind.trim().to_string();
    let local_avatar_asset_ref = selection
        .local_avatar_asset_ref
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let backend_capability_profile_ref = selection
        .backend_capability_profile_ref
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if local_avatar_asset_ref.is_empty() || backend_capability_profile_ref.is_empty() {
        return Err("local Avatar asset selection is incomplete".to_string());
    }
    let materialization_ref = expected_materialization_ref(
        &account_id,
        &local_agent_ref,
        kind.as_str(),
        &local_avatar_asset_ref,
    );
    nimi_avatar_resolve_agent_center_avatar_asset(AgentCenterAvatarAssetResolvePayload {
        account_id,
        owner_user_id,
        realm_agent_id,
        local_agent_ref,
        backend_kind: kind,
        local_avatar_asset_ref,
        backend_capability_profile_ref,
        materialization_ref,
    })
    .await
}
