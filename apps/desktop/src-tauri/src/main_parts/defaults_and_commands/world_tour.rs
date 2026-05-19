use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::form_urlencoded::Serializer;

use super::tester_storage::{
    resolve_tester_fixture_path, tester_app_tmp_root, tester_world_tour_cache_root,
};

const DEFAULT_WORLD_TOUR_MANIFEST_REL: &str = "latest/fixture-manifest.json";
const VIEWER_PRESET_FILE_NAME: &str = "viewer-preset.json";
const WORLD_TOUR_WINDOW_LABEL_PREFIX: &str = "world-tour";
const WORLD_TOUR_LAUNCH_TOKEN_PREFIX: &str = "world-tour-viewer-launch";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorldTourFixturePayload {
    pub manifest_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWorldTourWindowPayload {
    pub manifest_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimWorldTourViewerLaunchPayload {
    pub manifest_path: String,
    pub launch_token: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldTourViewerPresetPayload {
    pub manifest_path: String,
    pub camera: SaveWorldTourViewerPresetCameraPayload,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldTourViewerPresetCameraPayload {
    pub position: ViewerPresetVector,
    pub target: ViewerPresetVector,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewerPresetVector {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorldTourViewerPresetCamera {
    pub position: ViewerPresetVector,
    pub target: ViewerPresetVector,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorldTourViewerPreset {
    pub version: u32,
    pub mode: String,
    pub source: String,
    pub camera: WorldTourViewerPresetCamera,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldTourAssetIntegrityEvidence {
    pub sha256: String,
    pub provenance_ref: String,
    pub verification_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorldTourFixtureIntegrity {
    pub spz_local_path: Option<WorldTourAssetIntegrityEvidence>,
    pub thumbnail_local_path: Option<WorldTourAssetIntegrityEvidence>,
    pub pano_local_path: Option<WorldTourAssetIntegrityEvidence>,
    pub collider_mesh_local_path: Option<WorldTourAssetIntegrityEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWorldTourFixture {
    pub manifest_path: String,
    pub fixture_root: String,
    pub world_id: Option<String>,
    pub model: Option<String>,
    pub caption: Option<String>,
    pub world_marble_url: Option<String>,
    pub spz_remote_url: Option<String>,
    pub thumbnail_remote_url: Option<String>,
    pub pano_remote_url: Option<String>,
    pub collider_mesh_remote_url: Option<String>,
    pub spz_local_path: Option<String>,
    pub thumbnail_local_path: Option<String>,
    pub pano_local_path: Option<String>,
    pub collider_mesh_local_path: Option<String>,
    pub asset_integrity: WorldTourFixtureIntegrity,
    pub semantics_metadata: Option<Value>,
    pub viewer_preset: Option<WorldTourViewerPreset>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWorldTourWindowResponse {
    pub window_label: String,
    pub manifest_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldTourViewerPresetResponse {
    pub manifest_path: String,
    pub preset_path: String,
    pub viewer_preset: WorldTourViewerPreset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldTourRenderAcceptance {
    pub manifest_path: String,
    pub status: String,
    pub accepted_at: String,
    pub renderer: String,
    pub world_id: Option<String>,
    pub spz_asset_ref: Option<String>,
    pub reason: Option<String>,
}

fn fixture_manifest_path(input: Option<&str>) -> String {
    let candidate = input.unwrap_or(DEFAULT_WORLD_TOUR_MANIFEST_REL).trim();
    if candidate.is_empty() {
        DEFAULT_WORLD_TOUR_MANIFEST_REL.to_string()
    } else {
        candidate.to_string()
    }
}

fn json_optional_string(record: &Value, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn validate_vector(input: &ViewerPresetVector) -> Result<(), String> {
    if !input.x.is_finite() || !input.y.is_finite() || !input.z.is_finite() {
        return Err("viewer preset camera 坐标必须是有限数值".to_string());
    }
    Ok(())
}

fn validate_viewer_preset(input: WorldTourViewerPreset) -> Result<WorldTourViewerPreset, String> {
    if input.version == 0 {
        return Err("viewer preset version 必须大于 0".to_string());
    }
    if input.mode.trim() != "inspect" {
        return Err("viewer preset mode 必须是 inspect".to_string());
    }
    match input.source.trim() {
        "manual" | "auto-collider" | "auto-splat" => {}
        _ => {
            return Err(
                "viewer preset source 必须是 manual / auto-collider / auto-splat".to_string(),
            );
        }
    }
    validate_vector(&input.camera.position)?;
    validate_vector(&input.camera.target)?;
    Ok(input)
}

fn normalize_sha256(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .trim_start_matches("sha256:")
        .to_ascii_lowercase();
    if normalized.len() != 64 || !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("sha256 digest 必须是 64 位 hex".to_string());
    }
    Ok(normalized)
}

fn sha256_file_hex(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "读取 world-tour fixture 资产失败 ({}): {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!(
                "计算 world-tour fixture digest 失败 ({}): {error}",
                path.display()
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn manifest_asset_integrity(
    manifest: &Value,
    field: &str,
) -> Result<WorldTourAssetIntegrityEvidence, String> {
    let integrity_root = manifest
        .get("asset_integrity")
        .and_then(Value::as_object)
        .ok_or_else(|| "world-tour fixture manifest 缺少 asset_integrity".to_string())?;
    let record = integrity_root
        .get(field)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("world-tour fixture asset_integrity 缺少 {field}"))?;
    let sha256 = record
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("world-tour fixture {field} 缺少 sha256"))?;
    let provenance_ref = record
        .get("provenance_ref")
        .or_else(|| record.get("provenanceRef"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("world-tour fixture {field} 缺少 provenance_ref"))?;
    Ok(WorldTourAssetIntegrityEvidence {
        sha256: normalize_sha256(sha256)?,
        provenance_ref: provenance_ref.to_string(),
        verification_state: "digest-verified".to_string(),
    })
}

fn verify_manifest_asset_integrity(
    manifest: &Value,
    field: &str,
    path: &Path,
) -> Result<WorldTourAssetIntegrityEvidence, String> {
    let evidence = manifest_asset_integrity(manifest, field)?;
    let actual_sha256 = sha256_file_hex(path)?;
    if actual_sha256 != evidence.sha256 {
        return Err(format!(
            "world-tour fixture {field} digest mismatch: expected {}, got {actual_sha256}",
            evidence.sha256
        ));
    }
    if evidence.provenance_ref == "local-unverified" || evidence.provenance_ref == "unknown" {
        return Err(format!(
            "world-tour fixture {field} provenance_ref 不可为 {}",
            evidence.provenance_ref
        ));
    }
    Ok(evidence)
}

fn manifest_local_asset_to_canonical(
    fixture_root: &Path,
    manifest_dir: &Path,
    manifest: &Value,
    field: &str,
    value: Option<String>,
) -> Result<Option<(String, WorldTourAssetIntegrityEvidence)>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let path = PathBuf::from(raw.as_str());
    let canonical = if path.is_absolute() {
        path.canonicalize().map_err(|error| {
            format!(
                "解析 world-tour fixture 资产路径失败 ({}): {error}",
                path.display()
            )
        })?
    } else {
        manifest_dir.join(path).canonicalize().map_err(|error| {
            format!(
                "解析 world-tour fixture 资产路径失败 ({}): {error}",
                manifest_dir.join(raw.as_str()).display()
            )
        })?
    };
    if !canonical.starts_with(fixture_root) {
        return Err(format!(
            "world-tour fixture {field} 超出 Tester App fixture 根目录: {}",
            canonical.display()
        ));
    }
    let evidence = verify_manifest_asset_integrity(manifest, field, &canonical)?;
    Ok(Some((canonical.to_string_lossy().to_string(), evidence)))
}

fn resolve_world_tour_manifest_path(manifest_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = tester_world_tour_cache_root()?;
    let canonical_manifest = resolve_tester_fixture_path(manifest_path)?;
    if !canonical_manifest.starts_with(&root) {
        return Err(format!(
            "world-tour fixture manifest 超出允许目录: {}",
            canonical_manifest.display()
        ));
    }
    Ok((root, canonical_manifest))
}

fn viewer_preset_path_for_manifest(manifest_path: &Path) -> Result<PathBuf, String> {
    let parent = manifest_path
        .parent()
        .ok_or_else(|| "world-tour fixture manifest 缺少父目录".to_string())?;
    Ok(parent.join(VIEWER_PRESET_FILE_NAME))
}

fn read_viewer_preset_from_manifest(
    manifest_path: &Path,
) -> Result<Option<WorldTourViewerPreset>, String> {
    let preset_path = viewer_preset_path_for_manifest(manifest_path)?;
    if !preset_path.exists() {
        return Ok(None);
    }
    let preset_text = fs::read_to_string(&preset_path).map_err(|error| {
        format!(
            "读取 world-tour viewer preset 失败 ({}): {error}",
            preset_path.display()
        )
    })?;
    let preset = serde_json::from_str::<WorldTourViewerPreset>(&preset_text)
        .map_err(|error| format!("world-tour viewer preset JSON 无效: {error}"))?;
    Ok(Some(validate_viewer_preset(preset)?))
}

fn generate_launch_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("生成 world-tour viewer launch token 失败: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn launch_token_path(token: &str) -> Result<PathBuf, String> {
    let normalized = token.trim();
    if normalized.len() != 64 || !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("world-tour viewer launch token 无效".to_string());
    }
    Ok(tester_app_tmp_root()?.join(format!(
        "{WORLD_TOUR_LAUNCH_TOKEN_PREFIX}-{normalized}.json"
    )))
}

fn write_launch_token(manifest_path: &Path) -> Result<String, String> {
    let token = generate_launch_token()?;
    let path = launch_token_path(&token)?;
    let temp_path = path.with_extension("json.tmp");
    let payload = serde_json::json!({
        "manifestPath": manifest_path.to_string_lossy(),
        "launchToken": token,
    });
    let bytes = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("序列化 world-tour viewer launch token 失败: {error}"))?;
    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("创建 viewer launch token 临时文件失败: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("写入 viewer launch token 失败: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("写入 viewer launch token 换行失败: {error}"))?;
        file.flush()
            .map_err(|error| format!("刷新 viewer launch token 失败: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步 viewer launch token 失败: {error}"))?;
        drop(file);
        fs::rename(&temp_path, &path)
            .map_err(|error| format!("提交 viewer launch token 失败: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }
        return Err(error);
    }
    Ok(token)
}

fn claim_launch_token(manifest_path: &Path, token: &str) -> Result<(), String> {
    let path = launch_token_path(token)?;
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 world-tour viewer launch token 失败 ({}): {error}",
            path.display()
        )
    })?;
    let _ = fs::remove_file(&path);
    let record = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("world-tour viewer launch token JSON 无效: {error}"))?;
    let stored_manifest = json_optional_string(&record, "manifestPath")
        .ok_or_else(|| "world-tour viewer launch token 缺少 manifestPath".to_string())?;
    let stored_token = json_optional_string(&record, "launchToken")
        .ok_or_else(|| "world-tour viewer launch token 缺少 launchToken".to_string())?;
    if stored_token != token.trim() {
        return Err("world-tour viewer launch token 不匹配".to_string());
    }
    if stored_manifest != manifest_path.to_string_lossy() {
        return Err("world-tour viewer launch token manifest 不匹配".to_string());
    }
    Ok(())
}

fn persist_viewer_preset_to_manifest(
    manifest_path: &Path,
    preset: &WorldTourViewerPreset,
) -> Result<PathBuf, String> {
    let preset_path = viewer_preset_path_for_manifest(manifest_path)?;
    let temp_path = preset_path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(preset)
        .map_err(|error| format!("序列化 world-tour viewer preset 失败: {error}"))?;
    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("创建 viewer preset 临时文件失败: {error}"))?;
        file.write_all(&payload)
            .map_err(|error| format!("写入 viewer preset 临时文件失败: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("写入 viewer preset 换行失败: {error}"))?;
        file.flush()
            .map_err(|error| format!("刷新 viewer preset 临时文件失败: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步 viewer preset 临时文件失败: {error}"))?;
        drop(file);
        fs::rename(&temp_path, &preset_path)
            .map_err(|error| format!("提交 viewer preset 文件失败: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }
        return Err(error);
    }
    Ok(preset_path)
}

fn resolve_world_tour_fixture_from_manifest_path(
    manifest_path: &str,
) -> Result<ResolvedWorldTourFixture, String> {
    let (root, canonical_manifest) = resolve_world_tour_manifest_path(manifest_path)?;

    let manifest_text = fs::read_to_string(&canonical_manifest).map_err(|error| {
        format!(
            "读取 world-tour fixture manifest 失败 ({}): {error}",
            canonical_manifest.display()
        )
    })?;
    let manifest = serde_json::from_str::<Value>(&manifest_text)
        .map_err(|error| format!("world-tour fixture manifest JSON 无效: {error}"))?;
    let manifest_dir = canonical_manifest
        .parent()
        .ok_or_else(|| "world-tour fixture manifest 缺少父目录".to_string())?;
    let viewer_preset = read_viewer_preset_from_manifest(&canonical_manifest)?;
    let spz_local_asset = manifest_local_asset_to_canonical(
        &root,
        manifest_dir,
        &manifest,
        "spz_local_path",
        json_optional_string(&manifest, "spz_local_path"),
    )?;
    if spz_local_asset.is_none() {
        return Err(
            "world-tour fixture manifest 必须提供 verified local spz_local_path".to_string(),
        );
    }
    let collider_mesh_local_asset = manifest_local_asset_to_canonical(
        &root,
        manifest_dir,
        &manifest,
        "collider_mesh_local_path",
        json_optional_string(&manifest, "collider_mesh_local_path"),
    )?;
    if collider_mesh_local_asset.is_none()
        && json_optional_string(&manifest, "collider_mesh_remote_url").is_some()
    {
        return Err("world-tour fixture collider remote-only asset is not admitted".to_string());
    }
    let thumbnail_local_asset = manifest_local_asset_to_canonical(
        &root,
        manifest_dir,
        &manifest,
        "thumbnail_local_path",
        json_optional_string(&manifest, "thumbnail_local_path"),
    )?;
    let pano_local_asset = manifest_local_asset_to_canonical(
        &root,
        manifest_dir,
        &manifest,
        "pano_local_path",
        json_optional_string(&manifest, "pano_local_path"),
    )?;
    let spz_local_path = spz_local_asset.as_ref().map(|(path, _)| path.clone());
    let collider_mesh_local_path = collider_mesh_local_asset
        .as_ref()
        .map(|(path, _)| path.clone());
    let thumbnail_local_path = thumbnail_local_asset.as_ref().map(|(path, _)| path.clone());
    let pano_local_path = pano_local_asset.as_ref().map(|(path, _)| path.clone());

    Ok(ResolvedWorldTourFixture {
        manifest_path: canonical_manifest.to_string_lossy().to_string(),
        fixture_root: root.to_string_lossy().to_string(),
        world_id: json_optional_string(&manifest, "world_id"),
        model: json_optional_string(&manifest, "model"),
        caption: json_optional_string(&manifest, "caption"),
        world_marble_url: json_optional_string(&manifest, "world_marble_url"),
        spz_remote_url: json_optional_string(&manifest, "spz_remote_url"),
        thumbnail_remote_url: json_optional_string(&manifest, "thumbnail_remote_url"),
        pano_remote_url: json_optional_string(&manifest, "pano_remote_url"),
        collider_mesh_remote_url: json_optional_string(&manifest, "collider_mesh_remote_url"),
        spz_local_path,
        thumbnail_local_path,
        pano_local_path,
        collider_mesh_local_path,
        asset_integrity: WorldTourFixtureIntegrity {
            spz_local_path: spz_local_asset.map(|(_, evidence)| evidence),
            thumbnail_local_path: thumbnail_local_asset.map(|(_, evidence)| evidence),
            pano_local_path: pano_local_asset.map(|(_, evidence)| evidence),
            collider_mesh_local_path: collider_mesh_local_asset.map(|(_, evidence)| evidence),
        },
        semantics_metadata: manifest.get("semantics_metadata").cloned(),
        viewer_preset,
    })
}

fn render_acceptance_path() -> Result<PathBuf, String> {
    Ok(tester_app_tmp_root()?.join("world-tour-render-acceptance.json"))
}

fn validate_render_acceptance(record: &WorldTourRenderAcceptance) -> Result<(), String> {
    if record.manifest_path.trim().is_empty() {
        return Err("world-tour render acceptance manifestPath is required".to_string());
    }
    if record.renderer.trim() != "spark-2.0" {
        return Err("world-tour render acceptance renderer must be spark-2.0".to_string());
    }
    if record.status != "passed" && record.status != "failed" {
        return Err("world-tour render acceptance status must be passed or failed".to_string());
    }
    if record.accepted_at.trim().is_empty() {
        return Err("world-tour render acceptance acceptedAt is required".to_string());
    }
    Ok(())
}

fn write_render_acceptance(record: &WorldTourRenderAcceptance) -> Result<PathBuf, String> {
    validate_render_acceptance(record)?;
    let path = render_acceptance_path()?;
    let temp_path = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(record)
        .map_err(|error| format!("序列化 world-tour render acceptance 失败: {error}"))?;
    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("创建 render acceptance 临时文件失败: {error}"))?;
        file.write_all(&payload)
            .map_err(|error| format!("写入 render acceptance 临时文件失败: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("写入 render acceptance 换行失败: {error}"))?;
        file.flush()
            .map_err(|error| format!("刷新 render acceptance 临时文件失败: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步 render acceptance 临时文件失败: {error}"))?;
        drop(file);
        fs::rename(&temp_path, &path)
            .map_err(|error| format!("提交 render acceptance 文件失败: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }
        return Err(error);
    }
    Ok(path)
}

fn read_render_acceptance() -> Result<Option<WorldTourRenderAcceptance>, String> {
    let path = render_acceptance_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 world-tour render acceptance 失败 ({}): {error}",
            path.display()
        )
    })?;
    let record = serde_json::from_str::<WorldTourRenderAcceptance>(&raw)
        .map_err(|error| format!("world-tour render acceptance JSON 无效: {error}"))?;
    validate_render_acceptance(&record)?;
    Ok(Some(record))
}

fn allow_world_tour_asset_paths<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    fixture: &ResolvedWorldTourFixture,
) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    scope
        .allow_file(PathBuf::from(fixture.manifest_path.as_str()))
        .map_err(|error| format!("放行 world-tour manifest 资产协议失败: {error}"))?;

    let world_dir = PathBuf::from(&fixture.manifest_path)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "world-tour manifest 缺少父目录".to_string())?;
    let preset_path = world_dir.join(VIEWER_PRESET_FILE_NAME);
    if preset_path.exists() {
        scope
            .allow_file(&preset_path)
            .map_err(|error| format!("放行 world-tour viewer preset 失败: {error}"))?;
    }

    for local_path in [
        fixture.spz_local_path.as_deref(),
        fixture.thumbnail_local_path.as_deref(),
        fixture.pano_local_path.as_deref(),
        fixture.collider_mesh_local_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        scope
            .allow_file(PathBuf::from(local_path))
            .map_err(|error| format!("放行 world-tour 资产失败 ({}): {error}", local_path))?;
    }
    Ok(())
}

#[tauri::command]
pub fn world_tour_render_acceptance_save(payload: WorldTourRenderAcceptance) -> Result<(), String> {
    write_render_acceptance(&payload)?;
    Ok(())
}

#[tauri::command]
pub fn world_tour_render_acceptance_load() -> Result<Option<WorldTourRenderAcceptance>, String> {
    read_render_acceptance()
}

fn build_world_tour_window_route(manifest_path: &str, launch_token: &str) -> String {
    let query = Serializer::new(String::new())
        .append_pair("manifestPath", manifest_path)
        .append_pair("launchToken", launch_token)
        .finish();
    format!("/#/world-tour-viewer?{query}")
}

#[tauri::command]
pub fn resolve_world_tour_fixture(
    app: tauri::AppHandle,
    payload: ResolveWorldTourFixturePayload,
) -> Result<ResolvedWorldTourFixture, String> {
    let manifest_path = fixture_manifest_path(payload.manifest_path.as_deref());
    let fixture = resolve_world_tour_fixture_from_manifest_path(&manifest_path)?;
    allow_world_tour_asset_paths(&app, &fixture)?;
    Ok(fixture)
}

#[tauri::command]
pub fn claim_world_tour_viewer_launch(
    app: tauri::AppHandle,
    payload: ClaimWorldTourViewerLaunchPayload,
) -> Result<ResolvedWorldTourFixture, String> {
    let (_, canonical_manifest) = resolve_world_tour_manifest_path(payload.manifest_path.as_str())?;
    claim_launch_token(&canonical_manifest, payload.launch_token.as_str())?;
    let fixture = resolve_world_tour_fixture_from_manifest_path(
        canonical_manifest.to_string_lossy().as_ref(),
    )?;
    allow_world_tour_asset_paths(&app, &fixture)?;
    Ok(fixture)
}

#[tauri::command]
pub fn save_world_tour_viewer_preset(
    payload: SaveWorldTourViewerPresetPayload,
) -> Result<SaveWorldTourViewerPresetResponse, String> {
    let (_, canonical_manifest) = resolve_world_tour_manifest_path(payload.manifest_path.as_str())?;
    let preset = validate_viewer_preset(WorldTourViewerPreset {
        version: 1,
        mode: "inspect".to_string(),
        source: "manual".to_string(),
        camera: WorldTourViewerPresetCamera {
            position: payload.camera.position,
            target: payload.camera.target,
        },
    })?;
    let preset_path = persist_viewer_preset_to_manifest(&canonical_manifest, &preset)?;
    Ok(SaveWorldTourViewerPresetResponse {
        manifest_path: canonical_manifest.to_string_lossy().to_string(),
        preset_path: preset_path.to_string_lossy().to_string(),
        viewer_preset: preset,
    })
}

#[tauri::command]
pub async fn open_world_tour_window(
    app: tauri::AppHandle,
    payload: OpenWorldTourWindowPayload,
) -> Result<OpenWorldTourWindowResponse, String> {
    let manifest_path = fixture_manifest_path(payload.manifest_path.as_deref());
    let fixture = resolve_world_tour_fixture_from_manifest_path(&manifest_path)?;
    allow_world_tour_asset_paths(&app, &fixture)?;
    let launch_token = write_launch_token(&PathBuf::from(fixture.manifest_path.as_str()))?;

    for (label, window) in app.webview_windows() {
        if label.starts_with(WORLD_TOUR_WINDOW_LABEL_PREFIX) {
            let _ = window.close();
        }
    }

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let window_label = format!("{WORLD_TOUR_WINDOW_LABEL_PREFIX}-{unique}");
    let route = build_world_tour_window_route(&fixture.manifest_path, &launch_token);
    let window = WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App(route.into()))
        .title("World Tour")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .center()
        .focused(true)
        .build()
        .map_err(|error| format!("创建 world-tour 窗口失败: {error}"))?;
    let _ = window.set_focus();

    Ok(OpenWorldTourWindowResponse {
        window_label,
        manifest_path: fixture.manifest_path,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        claim_launch_token, persist_viewer_preset_to_manifest, read_viewer_preset_from_manifest,
        resolve_world_tour_fixture_from_manifest_path, validate_viewer_preset, write_launch_token,
        ViewerPresetVector, WorldTourViewerPreset, WorldTourViewerPresetCamera,
        DEFAULT_WORLD_TOUR_MANIFEST_REL,
    };
    use crate::test_support::with_product_data_home;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-world-tour-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_fixture(root: &PathBuf) -> PathBuf {
        let fixture_dir = root
            .join(".nimi")
            .join("data")
            .join("apps")
            .join("nimi.tester")
            .join("cache")
            .join("worldlabs")
            .join("world-tour")
            .join("latest");
        fs::create_dir_all(&fixture_dir).expect("create fixture dir");
        let spz = fixture_dir.join("world.spz");
        let collider = fixture_dir.join("collider.glb");
        fs::write(&spz, b"spz").expect("write spz");
        fs::write(&collider, b"glb").expect("write collider");
        let spz_sha256 = super::sha256_file_hex(&spz).expect("spz sha256");
        let collider_sha256 = super::sha256_file_hex(&collider).expect("collider sha256");
        let manifest_path = fixture_dir.join("fixture-manifest.json");
        fs::write(
            &manifest_path,
            format!(
                r#"{{
  "world_id": "world-1",
  "model": "marble-1.1",
  "caption": "Fixture caption",
  "spz_local_path": "{}",
  "collider_mesh_local_path": "{}",
  "thumbnail_remote_url": "https://example.invalid/thumb.webp",
  "asset_integrity": {{
    "spz_local_path": {{
      "sha256": "{}",
      "provenance_ref": "worldlabs-job:job-1"
    }},
    "collider_mesh_local_path": {{
      "sha256": "{}",
      "provenance_ref": "worldlabs-job:job-1"
    }}
  }},
  "semantics_metadata": {{
    "ground_plane_offset": 0,
    "metric_scale_factor": 1.2
  }}
}}"#,
                spz.display(),
                collider.display(),
                spz_sha256,
                collider_sha256
            ),
        )
        .expect("write manifest");
        manifest_path
    }

    fn sample_preset(source: &str) -> WorldTourViewerPreset {
        WorldTourViewerPreset {
            version: 1,
            mode: "inspect".to_string(),
            source: source.to_string(),
            camera: WorldTourViewerPresetCamera {
                position: ViewerPresetVector {
                    x: 12.0,
                    y: 24.0,
                    z: 36.0,
                },
                target: ViewerPresetVector {
                    x: 1.0,
                    y: 2.0,
                    z: 3.0,
                },
            },
        }
    }

    #[test]
    fn fixture_resolution_returns_canonical_local_paths() {
        let home = temp_dir("resolve");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home);
            let fixture =
                resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                    .expect("resolve fixture");
            assert_eq!(
                fixture.manifest_path,
                manifest_path
                    .canonicalize()
                    .expect("canonical manifest")
                    .to_string_lossy()
            );
            assert!(fixture
                .spz_local_path
                .as_deref()
                .is_some_and(|value| value.ends_with("world.spz")));
            assert!(fixture
                .collider_mesh_local_path
                .as_deref()
                .is_some_and(|value| value.ends_with("collider.glb")));
            assert_eq!(fixture.model.as_deref(), Some("marble-1.1"));
            assert!(fixture.viewer_preset.is_none());
        });
    }

    #[test]
    fn fixture_resolution_merges_viewer_preset_when_present() {
        let home = temp_dir("merge-preset");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home);
            let preset = sample_preset("manual");
            persist_viewer_preset_to_manifest(&manifest_path, &preset).expect("persist preset");
            let fixture =
                resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                    .expect("resolve fixture");
            assert_eq!(fixture.viewer_preset, Some(preset));
        });
    }

    #[test]
    fn viewer_preset_persistence_roundtrips() {
        let home = temp_dir("persist-preset");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home);
            let preset = sample_preset("manual");
            let preset_path =
                persist_viewer_preset_to_manifest(&manifest_path, &preset).expect("persist preset");
            let loaded = read_viewer_preset_from_manifest(&manifest_path)
                .expect("read preset")
                .expect("preset exists");
            assert!(preset_path.ends_with("viewer-preset.json"));
            assert_eq!(loaded, preset);
        });
    }

    #[test]
    fn viewer_preset_validation_rejects_unknown_source() {
        let err =
            validate_viewer_preset(sample_preset("bad-source")).expect_err("preset should fail");
        assert!(err.contains("source"));
    }

    #[test]
    fn viewer_launch_token_is_one_time_and_manifest_bound() {
        let home = temp_dir("launch-token");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home)
                .canonicalize()
                .expect("canonical manifest");
            let token = write_launch_token(&manifest_path).expect("write launch token");
            claim_launch_token(&manifest_path, &token).expect("claim token");
            let err = claim_launch_token(&manifest_path, &token)
                .expect_err("claimed token should fail closed");
            assert!(err.contains("launch token"));
        });
    }

    #[test]
    fn viewer_launch_token_rejects_manifest_mismatch() {
        let home = temp_dir("launch-token-mismatch");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home)
                .canonicalize()
                .expect("canonical manifest");
            let other_manifest = manifest_path
                .parent()
                .expect("manifest dir")
                .join("other-fixture-manifest.json");
            fs::write(&other_manifest, "{}").expect("write other manifest");
            let token = write_launch_token(&manifest_path).expect("write launch token");
            let err = claim_launch_token(&other_manifest, &token)
                .expect_err("wrong manifest should fail");
            assert!(err.contains("manifest"));
        });
    }

    #[test]
    fn fixture_resolution_fails_closed_outside_cache_root() {
        let home = temp_dir("reject");
        with_product_data_home(&home, || {
            let outside_dir = home.join("outside");
            fs::create_dir_all(&outside_dir).expect("create outside dir");
            let manifest_path = outside_dir.join("fixture-manifest.json");
            fs::write(&manifest_path, "{}").expect("write outside manifest");
            let err = resolve_world_tour_fixture_from_manifest_path(
                manifest_path.to_string_lossy().as_ref(),
            )
            .expect_err("outside fixture should fail");
            assert!(err.contains("Tester App cache") || err.contains("超出允许目录"));
        });
    }

    #[test]
    fn fixture_resolution_fails_closed_without_asset_integrity() {
        let home = temp_dir("missing-integrity");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home);
            let raw = fs::read_to_string(&manifest_path).expect("read manifest");
            let stripped = raw
                .split("  \"asset_integrity\"")
                .next()
                .expect("manifest head")
                .trim_end_matches(",\n")
                .to_string()
                + "\n}";
            fs::write(&manifest_path, stripped).expect("write stripped manifest");
            let err =
                resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                    .expect_err("missing integrity should fail");
            assert!(err.contains("asset_integrity"));
        });
    }

    #[test]
    fn fixture_resolution_fails_closed_on_digest_mismatch() {
        let home = temp_dir("digest-mismatch");
        with_product_data_home(&home, || {
            let manifest_path = write_fixture(&home);
            let raw = fs::read_to_string(&manifest_path).expect("read manifest");
            fs::write(
                &manifest_path,
                raw.replace("worldlabs-job:job-1", "worldlabs-job:job-1"),
            )
            .expect("rewrite manifest");
            let spz = manifest_path
                .parent()
                .expect("manifest dir")
                .join("world.spz");
            fs::write(&spz, b"tampered").expect("tamper spz");
            let err =
                resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                    .expect_err("digest mismatch should fail");
            assert!(err.contains("digest mismatch"));
        });
    }
}
