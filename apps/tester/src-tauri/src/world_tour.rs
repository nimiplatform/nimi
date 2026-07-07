use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use nimi_shell_tauri::capabilities::data::{
    require_bound_standard_storage_roots, StandardAppStorageRootSlot,
};
use nimi_shell_tauri::capabilities::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use url::form_urlencoded::Serializer;

const DEFAULT_WORLD_TOUR_MANIFEST_REL: &str = "latest/fixture-manifest.json";
const VIEWER_PRESET_FILE_NAME: &str = "viewer-preset.json";
const WORLD_TOUR_WINDOW_LABEL_PREFIX: &str = "world-tour";
const WORLD_TOUR_LAUNCH_TOKEN_PREFIX: &str = "world-tour-viewer-launch";

fn canonical_storage_root(root: &str, label: &str) -> Result<PathBuf, String> {
    storage::canonical_storage_root(root, label)
}

fn scoped_storage_child(root: &str, label: &str, child: &str) -> Result<PathBuf, String> {
    storage::scoped_storage_child(root, label, child)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ResolveWorldTourFixturePayload {
    manifest_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ClaimWorldTourViewerLaunchPayload {
    manifest_path: String,
    launch_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SaveWorldTourViewerPresetPayload {
    manifest_path: String,
    preset_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct OpenWorldTourWindowPayload {
    manifest_path: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWorldTourFixture {
    manifest_path: String,
    world_marble_url: Option<String>,
    collider_mesh_url: Option<String>,
    viewer_preset_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWorldTourWindowResponse {
    window_label: String,
    manifest_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldTourViewerPresetResponse {
    manifest_path: String,
    preset_path: String,
}

/// Resolves the tester cache root from the Runtime-attested managed storage
/// slot. World Tour caches fixtures/manifests under `<cache_root>/world-tour`.
fn slot_cache_root(slot: &StandardAppStorageRootSlot, command: &str) -> Result<String, String> {
    let roots = require_bound_standard_storage_roots(slot, command)?;
    let cache_root = roots.cache_root().ok_or_else(|| {
        nimi_shell_tauri::capabilities::standard_shell_error(
            "capability-unavailable",
            "tauri-standard-storage-cache-root-missing",
            "bind_runtime_projected_cache_root_for_world_tour",
            "tauri",
            None,
        )
    })?;
    Ok(cache_root.to_string_lossy().to_string())
}

/// Resolves the tester temp root from the Runtime-attested managed storage
/// slot. World Tour launch tokens live under `<temp_root>/world-tour`.
fn slot_temp_root(slot: &StandardAppStorageRootSlot, command: &str) -> Result<String, String> {
    let roots = require_bound_standard_storage_roots(slot, command)?;
    let temp_root = roots.temp_root().ok_or_else(|| {
        nimi_shell_tauri::capabilities::standard_shell_error(
            "capability-unavailable",
            "tauri-standard-storage-temp-root-missing",
            "bind_runtime_projected_temp_root_for_world_tour",
            "tauri",
            None,
        )
    })?;
    Ok(temp_root.to_string_lossy().to_string())
}

fn fixture_manifest_path(input: Option<&str>) -> String {
    input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_WORLD_TOUR_MANIFEST_REL)
        .to_string()
}

fn world_tour_cache_root(cache_root: &str) -> Result<PathBuf, String> {
    let root = canonical_storage_root(cache_root, "tester cache root")?.join("world-tour");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "create world-tour cache root failed ({}): {error}",
            root.display()
        )
    })?;
    root.canonicalize()
        .map_err(|error| format!("resolve world-tour cache root failed: {error}"))
}

fn resolve_manifest_path(cache_root: &str, input: &str) -> Result<PathBuf, String> {
    let root = world_tour_cache_root(cache_root)?;
    let candidate = if PathBuf::from(input).is_absolute() {
        PathBuf::from(input)
    } else {
        root.join(input)
    };
    let canonical = candidate.canonicalize().map_err(|error| {
        format!(
            "resolve world-tour manifest failed ({}): {error}",
            candidate.display()
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "world-tour manifest escapes tester cache: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn read_optional_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn resolve_fixture_from_manifest(
    cache_root: &str,
    manifest_path: &str,
) -> Result<ResolvedWorldTourFixture, String> {
    let canonical = resolve_manifest_path(cache_root, manifest_path)?;
    let raw = fs::read_to_string(&canonical).map_err(|error| {
        format!(
            "read world-tour manifest failed ({}): {error}",
            canonical.display()
        )
    })?;
    let manifest: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("world-tour manifest JSON invalid: {error}"))?;
    let parent = canonical
        .parent()
        .ok_or_else(|| "world-tour manifest has no parent directory".to_string())?;
    let world_marble_url = read_optional_string(&manifest, "worldMarblePath")
        .or_else(|| read_optional_string(&manifest, "world_marble_path"))
        .map(|path| parent.join(path).to_string_lossy().to_string());
    let collider_mesh_url = read_optional_string(&manifest, "colliderMeshPath")
        .or_else(|| read_optional_string(&manifest, "collider_mesh_path"))
        .map(|path| parent.join(path).to_string_lossy().to_string());
    let preset = parent.join(VIEWER_PRESET_FILE_NAME);
    Ok(ResolvedWorldTourFixture {
        manifest_path: canonical.to_string_lossy().to_string(),
        world_marble_url,
        collider_mesh_url,
        viewer_preset_path: preset
            .exists()
            .then(|| preset.to_string_lossy().to_string()),
    })
}

fn launch_token_path(temp_root: &str) -> Result<PathBuf, String> {
    scoped_storage_child(
        temp_root,
        "tester temp root",
        &format!("world-tour/{WORLD_TOUR_LAUNCH_TOKEN_PREFIX}.json"),
    )
}

fn write_launch_token(temp_root: &str, manifest_path: &str) -> Result<String, String> {
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string();
    let payload = serde_json::json!({
        "manifestPath": manifest_path,
        "launchToken": token,
    });
    let path = launch_token_path(temp_root)?;
    fs::write(
        &path,
        serde_json::to_string_pretty(&payload).unwrap_or_default(),
    )
    .map_err(|error| {
        format!(
            "write world-tour launch token failed ({}): {error}",
            path.display()
        )
    })?;
    Ok(token)
}

fn route_for_viewer(manifest_path: &str, launch_token: &str) -> String {
    let mut serializer = Serializer::new(String::new());
    serializer.append_pair("manifestPath", manifest_path);
    serializer.append_pair("launchToken", launch_token);
    format!("/#/world-tour-viewer?{}", serializer.finish())
}

#[tauri::command]
pub fn resolve_world_tour_fixture(
    slot: State<'_, StandardAppStorageRootSlot>,
    payload: ResolveWorldTourFixturePayload,
) -> Result<ResolvedWorldTourFixture, String> {
    let cache_root = slot_cache_root(&slot, "resolve_world_tour_fixture")?;
    let manifest = fixture_manifest_path(payload.manifest_path.as_deref());
    resolve_fixture_from_manifest(&cache_root, &manifest)
}

#[tauri::command]
pub fn claim_world_tour_viewer_launch(
    slot: State<'_, StandardAppStorageRootSlot>,
    payload: ClaimWorldTourViewerLaunchPayload,
) -> Result<ResolvedWorldTourFixture, String> {
    let cache_root = slot_cache_root(&slot, "claim_world_tour_viewer_launch")?;
    let temp_root = slot_temp_root(&slot, "claim_world_tour_viewer_launch")?;
    let raw = fs::read_to_string(launch_token_path(&temp_root)?)
        .map_err(|error| format!("read world-tour launch token failed: {error}"))?;
    let token_payload: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("world-tour launch token JSON invalid: {error}"))?;
    let expected_manifest = token_payload
        .get("manifestPath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let expected_token = token_payload
        .get("launchToken")
        .and_then(Value::as_str)
        .unwrap_or("");
    let canonical = resolve_manifest_path(&cache_root, &payload.manifest_path)?;
    if expected_manifest != canonical.to_string_lossy() || expected_token != payload.launch_token {
        return Err("world-tour launch token rejected".to_string());
    }
    resolve_fixture_from_manifest(&cache_root, &payload.manifest_path)
}

#[tauri::command]
pub fn save_world_tour_viewer_preset(
    slot: State<'_, StandardAppStorageRootSlot>,
    payload: SaveWorldTourViewerPresetPayload,
) -> Result<SaveWorldTourViewerPresetResponse, String> {
    let cache_root = slot_cache_root(&slot, "save_world_tour_viewer_preset")?;
    let manifest = resolve_manifest_path(&cache_root, &payload.manifest_path)?;
    let parsed: Value = serde_json::from_str(&payload.preset_json)
        .map_err(|error| format!("world-tour viewer preset JSON invalid: {error}"))?;
    let preset_path = manifest
        .parent()
        .ok_or_else(|| "world-tour manifest has no parent directory".to_string())?
        .join(VIEWER_PRESET_FILE_NAME);
    fs::write(
        &preset_path,
        serde_json::to_string_pretty(&parsed).unwrap_or(payload.preset_json),
    )
    .map_err(|error| {
        format!(
            "write world-tour viewer preset failed ({}): {error}",
            preset_path.display()
        )
    })?;
    Ok(SaveWorldTourViewerPresetResponse {
        manifest_path: manifest.to_string_lossy().to_string(),
        preset_path: preset_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn open_world_tour_window(
    app: tauri::AppHandle,
    payload: OpenWorldTourWindowPayload,
) -> Result<OpenWorldTourWindowResponse, String> {
    let (cache_root, temp_root) = {
        let slot = app.state::<StandardAppStorageRootSlot>();
        (
            slot_cache_root(&slot, "open_world_tour_window")?,
            slot_temp_root(&slot, "open_world_tour_window")?,
        )
    };
    let fixture = resolve_fixture_from_manifest(&cache_root, &payload.manifest_path)?;
    let launch_token = write_launch_token(&temp_root, &fixture.manifest_path)?;
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
    let route = route_for_viewer(&fixture.manifest_path, &launch_token);
    WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App(route.into()))
        .title("World Tour")
        .inner_size(1280.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .center()
        .focused(true)
        .build()
        .map_err(|error| format!("create world-tour viewer window failed: {error}"))?;
    Ok(OpenWorldTourWindowResponse {
        window_label,
        manifest_path: fixture.manifest_path,
    })
}
