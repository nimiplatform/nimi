use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::form_urlencoded::Serializer;

use super::tester_storage::{resolve_tester_fixture_path, tester_world_tour_cache_root};

const DEFAULT_WORLD_TOUR_MANIFEST_REL: &str =
    ".nimi/cache/worldlabs/world-tour/latest/fixture-manifest.json";
const VIEWER_PRESET_FILE_NAME: &str = "viewer-preset.json";
const WORLD_TOUR_WINDOW_LABEL_PREFIX: &str = "world-tour";

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

fn manifest_relative_path_to_canonical(
    manifest_dir: &Path,
    value: Option<String>,
) -> Result<Option<String>, String> {
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
        match resolve_tester_fixture_path(raw.as_str()) {
            Ok(canonical) => canonical,
            Err(_) => manifest_dir.join(path).canonicalize().map_err(|error| {
                format!(
                    "解析 world-tour fixture 资产路径失败 ({}): {error}",
                    manifest_dir.join(raw.as_str()).display()
                )
            })?,
        }
    };
    Ok(Some(canonical.to_string_lossy().to_string()))
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
        spz_local_path: manifest_relative_path_to_canonical(
            manifest_dir,
            json_optional_string(&manifest, "spz_local_path"),
        )?,
        thumbnail_local_path: manifest_relative_path_to_canonical(
            manifest_dir,
            json_optional_string(&manifest, "thumbnail_local_path"),
        )?,
        pano_local_path: manifest_relative_path_to_canonical(
            manifest_dir,
            json_optional_string(&manifest, "pano_local_path"),
        )?,
        collider_mesh_local_path: manifest_relative_path_to_canonical(
            manifest_dir,
            json_optional_string(&manifest, "collider_mesh_local_path"),
        )?,
        semantics_metadata: manifest.get("semantics_metadata").cloned(),
        viewer_preset,
    })
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
    scope
        .allow_directory(&world_dir, true)
        .map_err(|error| format!("放行 world-tour fixture 目录失败: {error}"))?;

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

fn build_world_tour_window_route(manifest_path: &str) -> String {
    let query = Serializer::new(String::new())
        .append_pair("manifestPath", manifest_path)
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
    let route = build_world_tour_window_route(&fixture.manifest_path);
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
        persist_viewer_preset_to_manifest, read_viewer_preset_from_manifest,
        resolve_world_tour_fixture_from_manifest_path, validate_viewer_preset, ViewerPresetVector,
        WorldTourViewerPreset, WorldTourViewerPresetCamera, DEFAULT_WORLD_TOUR_MANIFEST_REL,
    };
    use crate::test_support::with_env;
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
        let workspace = root.join("workspace");
        let fixture_dir = workspace
            .join(".nimi")
            .join("cache")
            .join("worldlabs")
            .join("world-tour")
            .join("latest");
        fs::create_dir_all(&fixture_dir).expect("create fixture dir");
        let spz = fixture_dir.join("world.spz");
        let collider = fixture_dir.join("collider.glb");
        fs::write(&spz, b"spz").expect("write spz");
        fs::write(&collider, b"glb").expect("write collider");
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
  "semantics_metadata": {{
    "ground_plane_offset": 0,
    "metric_scale_factor": 1.2
  }}
}}"#,
                spz.display(),
                collider.display()
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
        let root = temp_dir("resolve");
        let manifest_path = write_fixture(&root);
        let workspace = root.join("workspace");
        let nested = workspace.join("apps").join("desktop");
        fs::create_dir_all(&nested).expect("create nested dir");
        with_env(
            &[("PWD", workspace.to_str()), ("HOME", root.to_str())],
            || {
                let previous = std::env::current_dir().expect("current dir");
                std::env::set_current_dir(&nested).expect("set current dir");
                let fixture =
                    resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                        .expect("resolve fixture");
                std::env::set_current_dir(previous).expect("restore current dir");
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
            },
        );
    }

    #[test]
    fn fixture_resolution_merges_viewer_preset_when_present() {
        let root = temp_dir("merge-preset");
        let manifest_path = write_fixture(&root);
        let preset = sample_preset("manual");
        persist_viewer_preset_to_manifest(&manifest_path, &preset).expect("persist preset");
        let workspace = root.join("workspace");
        let nested = workspace.join("apps").join("desktop");
        fs::create_dir_all(&nested).expect("create nested dir");
        with_env(
            &[("PWD", workspace.to_str()), ("HOME", root.to_str())],
            || {
                let previous = std::env::current_dir().expect("current dir");
                std::env::set_current_dir(&nested).expect("set current dir");
                let fixture =
                    resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                        .expect("resolve fixture");
                std::env::set_current_dir(previous).expect("restore current dir");
                assert_eq!(fixture.viewer_preset, Some(preset));
            },
        );
    }

    #[test]
    fn viewer_preset_persistence_roundtrips() {
        let root = temp_dir("persist-preset");
        let manifest_path = write_fixture(&root);
        let preset = sample_preset("manual");
        let preset_path =
            persist_viewer_preset_to_manifest(&manifest_path, &preset).expect("persist preset");
        let loaded = read_viewer_preset_from_manifest(&manifest_path)
            .expect("read preset")
            .expect("preset exists");
        assert!(preset_path.ends_with("viewer-preset.json"));
        assert_eq!(loaded, preset);
    }

    #[test]
    fn viewer_preset_validation_rejects_unknown_source() {
        let err =
            validate_viewer_preset(sample_preset("bad-source")).expect_err("preset should fail");
        assert!(err.contains("source"));
    }

    #[test]
    fn fixture_resolution_fails_closed_outside_cache_root() {
        let root = temp_dir("reject");
        let workspace = root.join("workspace");
        fs::create_dir_all(workspace.join("apps")).expect("create apps dir");
        let outside_dir = workspace.join("outside");
        fs::create_dir_all(&outside_dir).expect("create outside dir");
        let manifest_path = outside_dir.join("fixture-manifest.json");
        fs::write(&manifest_path, "{}").expect("write outside manifest");

        with_env(
            &[("PWD", workspace.to_str()), ("HOME", root.to_str())],
            || {
                let err = resolve_world_tour_fixture_from_manifest_path(
                    manifest_path.to_string_lossy().as_ref(),
                )
                .expect_err("outside fixture should fail");
                assert!(
                    err.contains("超出允许目录")
                        || err.contains("未找到 tester world-tour cache 根目录")
                );
            },
        );
    }
}
