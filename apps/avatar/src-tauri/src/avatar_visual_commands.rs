use nimi_shell_tauri::agent_center_avatar_asset::ModelManifest;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, State};

#[derive(Serialize)]
pub(crate) struct NasHandlerManifest {
    activity: Vec<NasHandlerEntry>,
    event: Vec<NasHandlerEntry>,
    continuous: Vec<NasHandlerEntry>,
    config_json_path: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct NasHandlerEntry {
    pub(crate) file_stem: String,
    pub(crate) absolute_path: String,
}
#[derive(Default)]
pub(crate) struct NasWatcherRegistry {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}
#[derive(Clone, Serialize)]
pub(crate) struct NasHandlersChangedPayload {
    watcher_id: String,
    nimi_dir: String,
    changed_files: Vec<String>,
    reload_mode: String,
}
const NAS_HANDLERS_CHANGED_EVENT: &str = "avatar://nas-handlers-changed";
pub(crate) fn resolve_runtime_dir(input: &Path) -> Result<PathBuf, String> {
    let direct = input.join("runtime");
    if direct.is_dir() {
        return Ok(direct);
    }
    if input.is_dir() && input.file_name().and_then(|s| s.to_str()) == Some("runtime") {
        return Ok(input.to_path_buf());
    }
    Err(format!("no runtime/ subdirectory at {}", input.display()))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn is_agent_center_visual_package_file(path: &Path, home: &Path) -> bool {
    let account_data_root = home.join(".nimi").join("data").join("accounts");
    let Ok(relative) = path.strip_prefix(&account_data_root) else {
        return false;
    };
    let segments = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    if segments.len() < 6 {
        return false;
    }
    if segments.get(1) != Some(&"agents") {
        return false;
    }
    let package_file = segments.windows(7).any(|window| {
        window[0] == "agent-center"
            && window[1] == "modules"
            && window[2] == "avatar_asset"
            && window[3] == "packages"
            && window[6] == "files"
    });
    package_file
}

pub(crate) fn validated_avatar_visual_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("resolve {} failed: {}", path.display(), e))?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is required for avatar visual path validation".to_string())?;
    let canonical_home = home
        .canonicalize()
        .map_err(|e| format!("resolve HOME {} failed: {}", home.display(), e))?;
    let nimi_root = canonical_home.join(".nimi");
    if path_is_within(&canonical, &nimi_root)
        && !is_agent_center_visual_package_file(&canonical, &canonical_home)
    {
        return Err(format!(
            "avatar file access is limited to launch-approved visual package files: {}",
            path.display()
        ));
    }
    Ok(canonical)
}

#[tauri::command]
pub(crate) async fn nimi_avatar_resolve_model(path: String) -> Result<ModelManifest, String> {
    let root = validated_avatar_visual_path(&PathBuf::from(&path))?;
    if !root.exists() {
        return Err(format!("model path does not exist: {}", path));
    }
    if root.is_file()
        && root
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.ends_with(".vrm"))
    {
        let runtime_dir = root
            .parent()
            .ok_or_else(|| "VRM model file has no parent directory".to_string())?
            .to_path_buf();
        let model_id = root
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "failed to infer model_id from VRM file".to_string())?
            .to_string();
        let nimi_dir = {
            let candidate = runtime_dir.join("nimi");
            if candidate.is_dir() {
                Some(candidate.display().to_string())
            } else {
                None
            }
        };
        let motion_presets_dir = {
            let candidate = runtime_dir.join("vrm-motion-presets");
            if candidate.is_dir() {
                Some(candidate.display().to_string())
            } else {
                None
            }
        };
        return Ok(ModelManifest {
            kind: "vrm".to_string(),
            runtime_dir: runtime_dir.display().to_string(),
            model_id,
            model3_json_path: None,
            vrm_file_path: Some(root.display().to_string()),
            nimi_dir,
            motion_presets_dir,
            adapter_manifest_path: None,
        });
    }
    let runtime_dir = resolve_runtime_dir(&root)?;
    let mut model3_json: Option<PathBuf> = None;
    for entry in fs::read_dir(&runtime_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".model3.json") {
                model3_json = Some(entry.path());
                break;
            }
        }
    }
    let model3 = model3_json
        .ok_or_else(|| format!("no *.model3.json found in {}", runtime_dir.display()))?;
    let model_id = model3
        .file_name()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_suffix(".model3.json"))
        .ok_or_else(|| "failed to infer model_id".to_string())?
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
    Ok(ModelManifest {
        kind: "live2d".to_string(),
        runtime_dir: runtime_dir.display().to_string(),
        model_id,
        model3_json_path: Some(model3.display().to_string()),
        vrm_file_path: None,
        nimi_dir,
        motion_presets_dir: None,
        adapter_manifest_path,
    })
}

pub(crate) fn scan_handler_dir(root: &Path) -> Vec<NasHandlerEntry> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !name.ends_with(".js") {
            continue;
        }
        if name.starts_with('_') {
            continue;
        }
        let Some(stem) = name.strip_suffix(".js") else {
            continue;
        };
        out.push(NasHandlerEntry {
            file_stem: stem.to_string(),
            absolute_path: path.display().to_string(),
        });
    }
    out.sort_by(|a, b| a.file_stem.cmp(&b.file_stem));
    out
}

#[tauri::command]
pub(crate) async fn nimi_avatar_scan_nas_handlers(
    nimi_dir: String,
) -> Result<NasHandlerManifest, String> {
    let root = validated_avatar_visual_path(&PathBuf::from(&nimi_dir))?;
    if !root.is_dir() {
        return Err(format!("nimi directory does not exist: {}", nimi_dir));
    }
    let config_json = {
        let candidate = root.join("config.json");
        if candidate.is_file() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    Ok(NasHandlerManifest {
        activity: scan_handler_dir(&root.join("activity")),
        event: scan_handler_dir(&root.join("event")),
        continuous: scan_handler_dir(&root.join("continuous")),
        config_json_path: config_json,
    })
}

#[tauri::command]
pub(crate) async fn nimi_avatar_read_text_file(path: String) -> Result<String, String> {
    let canonical = validated_avatar_visual_path(&PathBuf::from(&path))?;
    fs::read_to_string(&canonical).map_err(|e| format!("read {} failed: {}", path, e))
}

#[tauri::command]
pub(crate) async fn nimi_avatar_read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let canonical = validated_avatar_visual_path(&PathBuf::from(&path))?;
    fs::read(&canonical).map_err(|e| format!("read {} failed: {}", path, e))
}

fn nas_reload_mode_for_event(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "add",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(_) => "update",
        _ => "update",
    }
}

#[tauri::command]
pub(crate) async fn nimi_avatar_watch_nas_handlers(
    app: tauri::AppHandle,
    state: State<'_, NasWatcherRegistry>,
    nimi_dir: String,
    watcher_id: String,
) -> Result<(), String> {
    let root = validated_avatar_visual_path(&PathBuf::from(&nimi_dir))?;
    if !root.is_dir() {
        return Err(format!("nimi directory does not exist: {}", nimi_dir));
    }
    if watcher_id.trim().is_empty() {
        return Err("NAS watcher id is required".to_string());
    }

    let event_root = root.clone();
    let event_nimi_dir = nimi_dir.clone();
    let event_watcher_id = watcher_id.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            let changed_files = event
                .paths
                .iter()
                .map(|path| {
                    path.strip_prefix(&event_root)
                        .unwrap_or(path)
                        .display()
                        .to_string()
                })
                .collect::<Vec<_>>();
            if changed_files.is_empty() {
                return;
            }
            let payload = NasHandlersChangedPayload {
                watcher_id: event_watcher_id.clone(),
                nimi_dir: event_nimi_dir.clone(),
                changed_files,
                reload_mode: nas_reload_mode_for_event(&event.kind).to_string(),
            };
            let _ = app.emit(NAS_HANDLERS_CHANGED_EVENT, payload);
        },
        Config::default(),
    )
    .map_err(|e| format!("create NAS watcher failed: {e}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("watch NAS directory failed: {e}"))?;

    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "NAS watcher registry lock poisoned".to_string())?;
    watchers.insert(watcher_id, watcher);
    Ok(())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_unwatch_nas_handlers(
    state: State<'_, NasWatcherRegistry>,
    watcher_id: String,
) -> Result<(), String> {
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "NAS watcher registry lock poisoned".to_string())?;
    watchers.remove(&watcher_id);
    Ok(())
}
