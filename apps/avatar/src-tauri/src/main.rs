#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalSize, WebviewWindow};

#[derive(Clone, Serialize)]
struct ReadyPayload {
    label: String,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
struct ModelManifest {
    runtime_dir: String,
    model_id: String,
    model3_json_path: String,
    nimi_dir: Option<String>,
}

#[derive(Serialize)]
struct NasHandlerManifest {
    activity: Vec<NasHandlerEntry>,
    event: Vec<NasHandlerEntry>,
    continuous: Vec<NasHandlerEntry>,
    config_json_path: Option<String>,
}

#[derive(Serialize)]
struct NasHandlerEntry {
    file_stem: String,
    absolute_path: String,
}

#[tauri::command]
async fn nimi_avatar_start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn nimi_avatar_set_window_size(
    window: WebviewWindow,
    width: u32,
    height: u32,
) -> Result<(), String> {
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn nimi_avatar_set_ignore_cursor_events(
    window: WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn nimi_avatar_set_always_on_top(
    window: WebviewWindow,
    always_on_top: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|e| e.to_string())
}

fn resolve_runtime_dir(input: &Path) -> Result<PathBuf, String> {
    let direct = input.join("runtime");
    if direct.is_dir() {
        return Ok(direct);
    }
    if input.is_dir() && input.file_name().and_then(|s| s.to_str()) == Some("runtime") {
        return Ok(input.to_path_buf());
    }
    Err(format!("no runtime/ subdirectory at {}", input.display()))
}

#[tauri::command]
async fn nimi_avatar_resolve_model(path: String) -> Result<ModelManifest, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("model path does not exist: {}", path));
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
    let model3 = model3_json.ok_or_else(|| {
        format!("no *.model3.json found in {}", runtime_dir.display())
    })?;
    let model_id = model3
        .file_name()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_suffix(".model3.json"))
        .ok_or_else(|| "failed to infer model_id".to_string())?
        .to_string();
    let nimi_dir = {
        let candidate = runtime_dir.join("nimi");
        if candidate.is_dir() { Some(candidate.display().to_string()) } else { None }
    };
    Ok(ModelManifest {
        runtime_dir: runtime_dir.display().to_string(),
        model_id,
        model3_json_path: model3.display().to_string(),
        nimi_dir,
    })
}

fn scan_handler_dir(root: &Path) -> Vec<NasHandlerEntry> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue; };
        if !name.ends_with(".js") { continue; }
        if name.starts_with('_') { continue; }
        let Some(stem) = name.strip_suffix(".js") else { continue; };
        out.push(NasHandlerEntry {
            file_stem: stem.to_string(),
            absolute_path: path.display().to_string(),
        });
    }
    out.sort_by(|a, b| a.file_stem.cmp(&b.file_stem));
    out
}

#[tauri::command]
async fn nimi_avatar_scan_nas_handlers(nimi_dir: String) -> Result<NasHandlerManifest, String> {
    let root = PathBuf::from(&nimi_dir);
    if !root.is_dir() {
        return Err(format!("nimi directory does not exist: {}", nimi_dir));
    }
    let config_json = {
        let candidate = root.join("config.json");
        if candidate.is_file() { Some(candidate.display().to_string()) } else { None }
    };
    Ok(NasHandlerManifest {
        activity: scan_handler_dir(&root.join("activity")),
        event: scan_handler_dir(&root.join("event")),
        continuous: scan_handler_dir(&root.join("continuous")),
        config_json_path: config_json,
    })
}

#[tauri::command]
async fn nimi_avatar_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {} failed: {}", path, e))
}

fn main() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            nimi_avatar_start_window_drag,
            nimi_avatar_set_window_size,
            nimi_avatar_set_ignore_cursor_events,
            nimi_avatar_set_always_on_top,
            nimi_avatar_resolve_model,
            nimi_avatar_scan_nas_handlers,
            nimi_avatar_read_text_file,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("avatar") {
                let size = window.inner_size().ok();
                let payload = ReadyPayload {
                    label: window.label().to_string(),
                    width: size.as_ref().map(|s| s.width).unwrap_or(0),
                    height: size.as_ref().map(|s| s.height).unwrap_or(0),
                };
                let _ = window.emit("avatar://shell-ready", payload);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nimi-avatar tauri application");
}
