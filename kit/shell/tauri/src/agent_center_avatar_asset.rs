use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

// Local Avatar asset materialization resolver. Agent Center paths are current
// Desktop storage plumbing for user-imported private skins, not package lifecycle,
// inventory, or activation authority.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live2d_calibration_ref: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCenterAvatarAssetResolvePayload {
    pub agent_handle: String,
    pub backend_kind: String,
    pub avatar_asset_ref: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCenterAvatarAssetResolveResult {
    pub manifest: ModelManifest,
    pub materialization_ref: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FormalPresentationAsset {
    asset_ref: String,
    role: String,
    backend_kind: String,
    file_name: String,
    media_type: String,
    content: Vec<u8>,
    sha256: String,
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

fn expected_materialization_ref(kind: &str, local_asset_id: &str) -> String {
    format!("avatar-materialization:{kind}:{local_asset_id}")
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
    kind: &str,
    local_asset_id: &str,
) -> Result<PathBuf, String> {
    Ok(data_root
        .join("avatar-assets")
        .join("packages")
        .join(kind)
        .join(local_asset_id))
}

fn find_agent_center_avatar_asset_dir(
    data_root: &Path,
    kind: &str,
    local_asset_id: &str,
) -> Result<PathBuf, String> {
    let candidate = resolve_agent_center_avatar_asset_dir(data_root, kind, local_asset_id)?;
    if candidate.exists() {
        return Ok(candidate);
    }
    Err("avatar asset is unavailable".to_string())
}

pub(crate) fn materialize_agent_center_avatar_asset(
    kind: &str,
    file_name: &str,
    content: &[u8],
    content_sha256: &str,
) -> Result<String, String> {
    if kind != "live2d" && kind != "vrm" {
        return Err("avatar_asset_kind must be live2d or vrm".to_string());
    }
    if content.is_empty() || content.len() as u64 > 67_108_864 {
        return Err("Avatar material is outside the bounded Runtime intake size.".to_string());
    }
    if content_sha256.len() != 64
        || !content_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("Avatar material digest is invalid.".to_string());
    }
    let local_asset_id = format!("{kind}_{}", &content_sha256[..12]);
    let data_root = resolve_admitted_data_root()?;
    let final_dir = resolve_agent_center_avatar_asset_dir(&data_root, kind, &local_asset_id)?;
    if final_dir.exists() {
        return Ok(local_asset_id);
    }
    let parent = final_dir
        .parent()
        .ok_or_else(|| "Avatar materialization parent is unavailable.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create Avatar materialization parent: {error}"))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let staging = parent.join(format!(
        ".{local_asset_id}.{}.{}.staging",
        std::process::id(),
        nonce
    ));
    fs::create_dir(&staging)
        .map_err(|error| format!("failed to create Avatar materialization staging: {error}"))?;
    let materialized = materialize_avatar_files(
        &staging,
        kind,
        file_name,
        content,
    )
    .and_then(|(entry_file, files)| {
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "asset_version": format!("sha256:{}", content_sha256),
            "local_asset_id": local_asset_id.clone(),
            "kind": kind,
            "loader_min_version": "1.0.0",
            "display_name": file_name,
            "display_name_i18n": {},
            "entry_file": entry_file,
            "required_files": files.iter().map(|file| file["path"].as_str().unwrap_or_default()).collect::<Vec<_>>(),
            "content_digest": format!("sha256:{}", content_sha256),
            "files": files,
            "limits": {
                "max_manifest_bytes": 262_144,
                "max_asset_bytes": 524_288_000,
                "max_file_bytes": 104_857_600,
                "max_file_count": 2_048
            },
            "capabilities": {},
            "import": {
                "imported_at": chrono::Utc::now().to_rfc3339(),
                "source_label": file_name,
                "source_fingerprint": format!("sha256:{}", content_sha256)
            }
        });
        let raw = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("failed to encode Avatar asset manifest: {error}"))?;
        if raw.len() > 262_144 {
            return Err("Avatar asset manifest exceeds the admitted size cap".to_string());
        }
        fs::write(staging.join("manifest.json"), raw)
            .map_err(|error| format!("failed to write Avatar asset manifest: {error}"))?;
        Ok(())
    });
    if let Err(error) = materialized {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    match fs::rename(&staging, &final_dir) {
        Ok(()) => Ok(local_asset_id),
        Err(_) if final_dir.exists() => {
            let _ = fs::remove_dir_all(&staging);
            Ok(local_asset_id)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(format!("failed to commit Avatar materialization: {error}"))
        }
    }
}

fn materialize_avatar_files(
    staging: &Path,
    kind: &str,
    file_name: &str,
    content: &[u8],
) -> Result<(String, Vec<serde_json::Value>), String> {
    let files_root = staging.join("files");
    fs::create_dir(&files_root)
        .map_err(|error| format!("failed to create Avatar files directory: {error}"))?;
    if kind == "vrm" {
        let safe_name = safe_material_file_name(file_name, "vrm")?;
        let relative = format!("files/{safe_name}");
        fs::write(files_root.join(&safe_name), content)
            .map_err(|error| format!("failed to write VRM material: {error}"))?;
        return Ok((
            relative.clone(),
            vec![manifest_file(&relative, content, "model/vrm")],
        ));
    }

    let mut archive = zip::ZipArchive::new(Cursor::new(content))
        .map_err(|error| format!("Live2D package is not a valid ZIP archive: {error}"))?;
    if archive.len() == 0 || archive.len() > 2_048 {
        return Err("Live2D package file count is outside the admitted cap.".to_string());
    }
    let mut total_bytes = 0_u64;
    let mut entry_file: Option<String> = None;
    let mut files = Vec::new();
    let mut paths = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("failed to read Live2D ZIP entry: {error}"))?;
        let Some(enclosed) = entry.enclosed_name() else {
            return Err("Live2D package contains an unsafe path.".to_string());
        };
        if enclosed.as_os_str().is_empty() || enclosed.to_string_lossy().contains('\\') {
            return Err("Live2D package contains an unsafe path.".to_string());
        }
        let collision_key = enclosed.to_string_lossy().to_ascii_lowercase();
        if !paths.insert(collision_key) {
            return Err("Live2D package contains a duplicate path.".to_string());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Live2D package must not contain symlinks.".to_string());
        }
        let destination = files_root.join(&enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("failed to create Live2D directory: {error}"))?;
            continue;
        }
        let declared = entry.size();
        if declared == 0 || declared > 104_857_600 {
            return Err("Live2D package file is outside the admitted byte cap.".to_string());
        }
        total_bytes = total_bytes.saturating_add(declared);
        if total_bytes > 524_288_000 {
            return Err("Live2D package exceeds the admitted expanded byte cap.".to_string());
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create Live2D directory: {error}"))?;
        }
        let mut output = fs::File::create(&destination)
            .map_err(|error| format!("failed to create Live2D file: {error}"))?;
        let mut bytes = Vec::with_capacity(usize::try_from(declared).unwrap_or_default());
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| format!("failed to extract Live2D file: {error}"))?;
        if bytes.len() as u64 != declared {
            return Err("Live2D package file size changed during extraction.".to_string());
        }
        output
            .write_all(&bytes)
            .map_err(|error| format!("failed to write Live2D file: {error}"))?;
        let relative = format!("files/{}", enclosed.to_string_lossy().replace('\\', "/"));
        if relative.ends_with(".model3.json") {
            if entry_file.replace(relative.clone()).is_some() {
                return Err("Live2D package must contain exactly one model3 entry.".to_string());
            }
        }
        files.push(manifest_file(
            &relative,
            &bytes,
            mime_for_material_path(&relative),
        ));
    }
    let entry_file = entry_file
        .ok_or_else(|| "Live2D package must contain exactly one model3 entry.".to_string())?;
    Ok((entry_file, files))
}

fn safe_material_file_name(value: &str, extension: &str) -> Result<String, String> {
    let name = Path::new(value)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if name.is_empty()
        || name != value
        || name.len() > 255
        || !name
            .to_ascii_lowercase()
            .ends_with(&format!(".{extension}"))
    {
        return Err("Avatar material file name is invalid.".to_string());
    }
    Ok(name.to_string())
}

fn mime_for_material_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "moc3" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

fn manifest_file(path: &str, content: &[u8], mime: &str) -> serde_json::Value {
    let mut hasher = Sha256::new();
    hasher.update(content);
    serde_json::json!({
        "path": path,
        "sha256": format!("{:x}", hasher.finalize()),
        "bytes": content.len(),
        "mime": mime
    })
}

pub async fn nimi_avatar_resolve_agent_center_avatar_asset(
    host: &crate::runtime_bridge::RuntimeBridgeLocalAppHost,
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<AgentCenterAvatarAssetResolveResult, String> {
    resolve_agent_center_avatar_asset_with_formal_reader(
        payload,
        |agent_handle, asset_ref| async move {
            crate::standard_local_app::agent_presentation_read_asset_for_host(
                host,
                serde_json::json!({
                    "agentHandle": agent_handle,
                    "assetRef": asset_ref,
                }),
            )
            .await
        },
    )
    .await
}

pub(crate) async fn resolve_agent_center_avatar_asset_with_formal_reader<F, Fut>(
    payload: AgentCenterAvatarAssetResolvePayload,
    read_formal_asset: F,
) -> Result<AgentCenterAvatarAssetResolveResult, String>
where
    F: FnOnce(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
{
    if !valid_agent_handle(&payload.agent_handle) {
        return Err("agentHandle must be a current-session opaque Agent handle".to_string());
    }
    let kind = payload.backend_kind.trim().to_string();
    if kind != "live2d" && kind != "vrm" {
        return Err("avatar_asset_kind must be live2d or vrm".to_string());
    }
    let local_asset_id = validate_avatar_asset_id(&payload.avatar_asset_ref, kind.as_str())?;
    let formal_asset = read_formal_asset(payload.agent_handle, local_asset_id.clone()).await?;
    let formal_asset =
        validate_formal_presentation_asset(formal_asset, kind.as_str(), local_asset_id.as_str())?;
    let materialized_asset_id = materialize_agent_center_avatar_asset(
        kind.as_str(),
        formal_asset.file_name.as_str(),
        &formal_asset.content,
        formal_asset.sha256.as_str(),
    )?;
    if materialized_asset_id != local_asset_id {
        return Err("formal Avatar presentation asset identity is inconsistent".to_string());
    }
    resolve_verified_agent_center_avatar_materialization(
        kind.as_str(),
        local_asset_id.as_str(),
        formal_asset.sha256.as_str(),
    )
    .await
}

fn validate_formal_presentation_asset(
    value: serde_json::Value,
    expected_kind: &str,
    expected_asset_ref: &str,
) -> Result<FormalPresentationAsset, String> {
    let asset: FormalPresentationAsset = serde_json::from_value(value)
        .map_err(|_| "formal Avatar presentation asset projection is invalid".to_string())?;
    if asset.asset_ref != expected_asset_ref
        || asset.role != "avatar"
        || asset.backend_kind != expected_kind
    {
        return Err("formal Avatar presentation asset identity is inconsistent".to_string());
    }
    let expected_media_type = match expected_kind {
        "live2d" => {
            safe_material_file_name(asset.file_name.as_str(), "zip")?;
            "application/zip"
        }
        "vrm" => {
            safe_material_file_name(asset.file_name.as_str(), "vrm")?;
            "model/gltf-binary"
        }
        _ => return Err("avatar_asset_kind must be live2d or vrm".to_string()),
    };
    if asset.media_type != expected_media_type
        || asset.content.is_empty()
        || asset.content.len() > 64 * 1024 * 1024
        || !valid_lower_sha256(asset.sha256.as_str())
    {
        return Err("formal Avatar presentation asset material is invalid".to_string());
    }
    let mut hasher = Sha256::new();
    hasher.update(&asset.content);
    if format!("{:x}", hasher.finalize()) != asset.sha256 {
        return Err("formal Avatar presentation asset digest mismatch".to_string());
    }
    Ok(asset)
}

pub async fn resolve_verified_agent_center_avatar_materialization(
    backend_kind: &str,
    avatar_asset_ref: &str,
    content_sha256: &str,
) -> Result<AgentCenterAvatarAssetResolveResult, String> {
    let kind = backend_kind.trim().to_string();
    if kind != "live2d" && kind != "vrm" {
        return Err("avatar_asset_kind must be live2d or vrm".to_string());
    }
    let local_asset_id = validate_avatar_asset_id(avatar_asset_ref, kind.as_str())?;
    if !valid_lower_sha256(content_sha256) {
        return Err("formal Avatar presentation asset material is invalid".to_string());
    }
    let data_root = resolve_admitted_data_root()?;
    let expected_ref = expected_materialization_ref(kind.as_str(), local_asset_id.as_str());
    let asset_dir =
        find_agent_center_avatar_asset_dir(&data_root, kind.as_str(), local_asset_id.as_str())?;
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
    let expected_source_fingerprint = format!("sha256:{content_sha256}");
    if manifest.content_digest != expected_source_fingerprint
        || manifest.import.source_fingerprint != expected_source_fingerprint
    {
        return Err(
            "Avatar materialization does not match the formal presentation asset".to_string(),
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
    let manifest = ModelManifest {
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
        live2d_calibration_ref: None,
    };
    Ok(AgentCenterAvatarAssetResolveResult {
        manifest,
        materialization_ref: expected_ref,
    })
}

fn valid_agent_handle(value: &str) -> bool {
    value.len() == "agent_ref_".len() + 43
        && value.starts_with("agent_ref_")
        && value["agent_ref_".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
