#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod avatar_evidence_projection;
mod avatar_instance_projection;
mod avatar_instance_registry;
mod avatar_launch_context;

use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use avatar_evidence_projection::AvatarEvidenceRecordInput;
use avatar_instance_projection::{persist_projection, AvatarInstanceProjectionRecord};
use avatar_instance_registry::AvatarInstanceRegistry;
use avatar_launch_context::{
    parse_avatar_deep_link_request, resolve_initial_avatar_request, AvatarCloseRequest,
    AvatarDeepLinkRequest, AvatarLaunchContext, AVATAR_LAUNCH_SCHEME,
};
use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[derive(Clone, Serialize)]
struct ReadyPayload {
    label: String,
    width: u32,
    height: u32,
}

const AVATAR_WINDOW_LABEL: &str = "avatar";
const AVATAR_WINDOW_LABEL_PREFIX: &str = "avatar-instance";
const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";

#[derive(Debug, Serialize)]
struct ModelManifest {
    runtime_dir: String,
    model_id: String,
    model3_json_path: String,
    nimi_dir: Option<String>,
    adapter_manifest_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentCenterAvatarPackageResolvePayload {
    agent_center_account_id: String,
    agent_id: String,
    avatar_package_kind: String,
    avatar_package_id: String,
    avatar_package_schema_version: u8,
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

#[derive(Default)]
struct NasWatcherRegistry {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Clone, Serialize)]
struct NasHandlersChangedPayload {
    watcher_id: String,
    nimi_dir: String,
    changed_files: Vec<String>,
    reload_mode: String,
}

const NAS_HANDLERS_CHANGED_EVENT: &str = "avatar://nas-handlers-changed";

fn sanitize_window_label_component(input: &str) -> String {
    let mut sanitized = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_') {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    let trimmed = sanitized.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "instance".to_string()
    } else {
        trimmed
    }
}

fn avatar_window_label_for_instance(avatar_instance_id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    avatar_instance_id.hash(&mut hasher);
    let digest = hasher.finish();
    let sanitized = sanitize_window_label_component(avatar_instance_id);
    let prefix = sanitized.chars().take(24).collect::<String>();
    format!("{AVATAR_WINDOW_LABEL_PREFIX}-{prefix}-{digest:016x}")
}

fn is_avatar_window_label(label: &str) -> bool {
    label == AVATAR_WINDOW_LABEL || label.starts_with(&format!("{AVATAR_WINDOW_LABEL_PREFIX}-"))
}

fn emit_avatar_shell_ready_for_webview(webview: &tauri::Webview) {
    let size = webview.window().inner_size().ok();
    let payload = ReadyPayload {
        label: webview.label().to_string(),
        width: size.as_ref().map(|s| s.width).unwrap_or(0),
        height: size.as_ref().map(|s| s.height).unwrap_or(0),
    };
    let _ = webview.emit("avatar://shell-ready", payload);
}

fn sync_avatar_window_to_launch_context(
    window: &WebviewWindow,
    context: &AvatarLaunchContext,
    emit_update_event: bool,
) {
    let _ = window.set_title(&format!("Nimi Avatar · {}", context.avatar_instance_id));
    let _ = window.show();
    let _ = window.set_focus();
    if emit_update_event {
        let _ = window.emit(AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT, context);
    }
}

fn attach_avatar_window_lifecycle(window: &WebviewWindow, app: &tauri::AppHandle) {
    let app_handle = app.clone();
    let window_label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let registry = app_handle.state::<AvatarInstanceRegistry>();
            let _ = registry.remove_window(&window_label);
            sync_avatar_instance_projection(&registry);
        }
    });
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn sync_avatar_instance_projection(registry: &AvatarInstanceRegistry) {
    let published_at_ms = now_ms();
    let snapshot = match registry.snapshot() {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("[avatar-instance-projection] snapshot failed: {error}");
            return;
        }
    };
    let projection = snapshot
        .into_iter()
        .map(|entry| AvatarInstanceProjectionRecord {
            avatar_instance_id: entry.context.avatar_instance_id,
            agent_id: entry.context.agent_id,
            conversation_anchor_id: entry.context.conversation_anchor_id,
            anchor_mode: entry.context.anchor_mode,
            launched_by: entry.context.launched_by,
            source_surface: entry.context.source_surface,
        })
        .collect::<Vec<_>>();
    if let Err(error) = persist_projection(std::process::id(), published_at_ms, projection) {
        eprintln!("[avatar-instance-projection] persist failed: {error}");
    }
}

fn start_avatar_instance_projection_heartbeat(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1_000));
        let registry = app_handle.state::<AvatarInstanceRegistry>();
        sync_avatar_instance_projection(&registry);
    });
}

fn now_evidence_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn record_avatar_backend_evidence(
    context: &AvatarLaunchContext,
    kind: &str,
    detail: serde_json::Value,
) {
    if let Err(error) = avatar_evidence_projection::append_evidence_record(
        context.clone(),
        AvatarEvidenceRecordInput {
            kind: kind.to_string(),
            recorded_at: now_evidence_timestamp(),
            detail,
            consume: json!({ "mode": "sdk", "authority": "runtime" }),
            model: json!({}),
        },
    ) {
        eprintln!("[avatar-carrier-evidence] backend diagnostic failed: {error}");
    }
}

fn build_avatar_window(
    app: &tauri::AppHandle,
    window_label: &str,
) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::App("/".into()))
        .title("Nimi Avatar")
        .inner_size(400.0, 600.0)
        .decorations(false)
        .resizable(true)
        .build()
        .map_err(|error| format!("failed to build avatar window: {error}"))?;
    let _ = window.set_always_on_top(true);
    Ok(window)
}

fn route_avatar_launch_context(
    app: &tauri::AppHandle,
    registry: &AvatarInstanceRegistry,
    context: AvatarLaunchContext,
    emit_update_event_for_reused_window: bool,
) -> Result<(), String> {
    if let Some(window_label) = registry.window_label_for_instance(&context.avatar_instance_id)? {
        if let Some(window) = app.get_webview_window(&window_label) {
            registry.bind_window(window.label().to_string(), context.clone())?;
            sync_avatar_window_to_launch_context(
                &window,
                &context,
                emit_update_event_for_reused_window,
            );
            sync_avatar_instance_projection(registry);
            record_avatar_backend_evidence(
                &context,
                "avatar.launch.context-bound",
                json!({
                    "source": "avatar-backend",
                    "window_label": window.label(),
                    "window_reused": true
                }),
            );
            return Ok(());
        }
    }

    if let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) {
        if !registry.is_window_bound(window.label())? {
            registry.bind_window(window.label().to_string(), context.clone())?;
            sync_avatar_window_to_launch_context(
                &window,
                &context,
                emit_update_event_for_reused_window,
            );
            sync_avatar_instance_projection(registry);
            record_avatar_backend_evidence(
                &context,
                "avatar.launch.context-bound",
                json!({
                    "source": "avatar-backend",
                    "window_label": window.label(),
                    "window_reused": true
                }),
            );
            return Ok(());
        }
    }

    let window_label = avatar_window_label_for_instance(&context.avatar_instance_id);
    let window = build_avatar_window(app, &window_label)?;
    attach_avatar_window_lifecycle(&window, app);
    registry.bind_window(window.label().to_string(), context.clone())?;
    sync_avatar_window_to_launch_context(&window, &context, false);
    sync_avatar_instance_projection(registry);
    record_avatar_backend_evidence(
        &context,
        "avatar.launch.context-bound",
        json!({
            "source": "avatar-backend",
            "window_label": window.label(),
            "window_reused": false
        }),
    );
    Ok(())
}

fn close_avatar_instance(
    app: &tauri::AppHandle,
    registry: &AvatarInstanceRegistry,
    request: &AvatarCloseRequest,
) -> Result<(), String> {
    let Some(window_label) = registry.window_label_for_instance(&request.avatar_instance_id)?
    else {
        return Err(format!(
            "avatar instance is not active: {}",
            request.avatar_instance_id
        ));
    };
    let Some(window) = app.get_webview_window(&window_label) else {
        registry.remove_window(&window_label)?;
        sync_avatar_instance_projection(registry);
        return Err(format!(
            "avatar instance window is unavailable: {}",
            request.avatar_instance_id
        ));
    };
    window
        .close()
        .map_err(|error| format!("failed to close avatar instance: {error}"))
}

#[tauri::command]
async fn nimi_avatar_get_launch_context(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
) -> Result<AvatarLaunchContext, String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar launch context is required; launch from desktop orchestrator".to_string()
        })?;
    record_avatar_backend_evidence(
        &context,
        "avatar.renderer.launch-context-read",
        json!({
            "source": "avatar-backend",
            "window_label": window.label()
        }),
    );
    Ok(context)
}

#[tauri::command]
async fn nimi_avatar_record_evidence(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
    payload: AvatarEvidenceRecordInput,
) -> Result<String, String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar evidence requires launch context; launch from desktop orchestrator".to_string()
        })?;
    let path = avatar_evidence_projection::append_evidence_record(context, payload)?;
    Ok(path.display().to_string())
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
async fn nimi_avatar_constrain_window_to_visible_area(
    window: WebviewWindow,
    min_visible_ratio: f64,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor is available for avatar edge constraints".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let ratio = if min_visible_ratio.is_finite() {
        min_visible_ratio.clamp(0.05, 1.0)
    } else {
        0.2
    };
    let min_visible_width = ((size.width as f64) * ratio).ceil() as i32;
    let min_visible_height = ((size.height as f64) * ratio).ceil() as i32;
    let min_x = monitor_position.x - size.width as i32 + min_visible_width;
    let max_x = monitor_position.x + monitor_size.width as i32 - min_visible_width;
    let min_y = monitor_position.y - size.height as i32 + min_visible_height;
    let max_y = monitor_position.y + monitor_size.height as i32 - min_visible_height;
    let constrained = PhysicalPosition::new(
        position.x.clamp(min_x, max_x),
        position.y.clamp(min_y, max_y),
    );
    if constrained != position {
        window
            .set_position(constrained)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
        runtime_dir: runtime_dir.display().to_string(),
        model_id,
        model3_json_path: model3.display().to_string(),
        nimi_dir,
        adapter_manifest_path,
    })
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

fn agent_center_path_segment(value: &str) -> String {
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

#[tauri::command]
async fn nimi_avatar_resolve_agent_center_avatar_package(
    payload: AgentCenterAvatarPackageResolvePayload,
) -> Result<ModelManifest, String> {
    let account_id =
        validate_agent_center_id(&payload.agent_center_account_id, "agent_center_account_id")?;
    let agent_id = validate_agent_center_id(&payload.agent_id, "agent_id")?;
    let kind = payload.avatar_package_kind.trim();
    if kind != "live2d" {
        return Err("avatar package loader currently supports Live2D packages only".to_string());
    }
    if payload.avatar_package_schema_version != 1 {
        return Err("avatar_package_schema_version must be 1".to_string());
    }
    let package_id = validate_avatar_package_id(&payload.avatar_package_id, kind)?;
    let data_root = resolve_home_data_root()?;
    let package_dir = data_root
        .join("accounts")
        .join(agent_center_path_segment(&account_id))
        .join("agents")
        .join(agent_center_path_segment(&agent_id))
        .join("agent-center")
        .join("modules")
        .join("avatar_package")
        .join("packages")
        .join(kind)
        .join(package_id.as_str());
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
        return Err("avatar package manifest identity does not match launch context".to_string());
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

fn scan_handler_dir(root: &Path) -> Vec<NasHandlerEntry> {
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
async fn nimi_avatar_scan_nas_handlers(nimi_dir: String) -> Result<NasHandlerManifest, String> {
    let root = PathBuf::from(&nimi_dir);
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
async fn nimi_avatar_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {} failed: {}", path, e))
}

#[tauri::command]
async fn nimi_avatar_read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("read {} failed: {}", path, e))
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
async fn nimi_avatar_watch_nas_handlers(
    app: tauri::AppHandle,
    state: State<'_, NasWatcherRegistry>,
    nimi_dir: String,
    watcher_id: String,
) -> Result<(), String> {
    let root = PathBuf::from(&nimi_dir);
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
async fn nimi_avatar_unwatch_nas_handlers(
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

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    let _ = dotenvy::dotenv();
    configure_runtime_bridge_env();
    let initial_avatar_request = resolve_initial_avatar_request();

    tauri::Builder::default()
        .manage(AvatarInstanceRegistry::new())
        .manage(NasWatcherRegistry::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && is_avatar_window_label(webview.label())
            {
                emit_avatar_shell_ready_for_webview(webview);
                let registry = webview.app_handle().state::<AvatarInstanceRegistry>();
                if let Ok(Some(context)) = registry.context_for_window(webview.label()) {
                    record_avatar_backend_evidence(
                        &context,
                        "avatar.window.page-loaded",
                        json!({
                            "source": "avatar-backend",
                            "window_label": webview.label()
                        }),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            defaults::runtime_defaults,
            auth_session_commands::auth_session_load,
            auth_session_commands::auth_session_save,
            auth_session_commands::auth_session_clear,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart,
            runtime_bridge::runtime_bridge_config_get,
            runtime_bridge::runtime_bridge_config_set,
            nimi_avatar_start_window_drag,
            nimi_avatar_set_window_size,
            nimi_avatar_set_ignore_cursor_events,
            nimi_avatar_constrain_window_to_visible_area,
            nimi_avatar_set_always_on_top,
            nimi_avatar_get_launch_context,
            nimi_avatar_record_evidence,
            nimi_avatar_resolve_model,
            nimi_avatar_resolve_agent_center_avatar_package,
            nimi_avatar_scan_nas_handlers,
            nimi_avatar_read_text_file,
            nimi_avatar_read_binary_file,
            nimi_avatar_watch_nas_handlers,
            nimi_avatar_unwatch_nas_handlers,
        ])
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;

            #[cfg(desktop)]
            {
                let _ = app.deep_link().register(AVATAR_LAUNCH_SCHEME);
            }
            let app_handle_for_deep_link = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let registry = app_handle_for_deep_link.state::<AvatarInstanceRegistry>();
                for raw_url in event.urls() {
                    let Ok(request) = parse_avatar_deep_link_request(raw_url.as_str()) else {
                        continue;
                    };
                    match request {
                        AvatarDeepLinkRequest::Launch(context) => {
                            let _ = route_avatar_launch_context(
                                &app_handle_for_deep_link,
                                &registry,
                                context,
                                true,
                            );
                        }
                        AvatarDeepLinkRequest::Close(request) => {
                            let _ = close_avatar_instance(
                                &app_handle_for_deep_link,
                                &registry,
                                &request,
                            );
                        }
                    }
                }
            });

            if let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) {
                attach_avatar_window_lifecycle(&window, app.handle());
            }
            {
                let registry = app.state::<AvatarInstanceRegistry>();
                sync_avatar_instance_projection(&registry);
            }
            start_avatar_instance_projection_heartbeat(app.handle());
            if let Some(request) = initial_avatar_request {
                let registry = app.state::<AvatarInstanceRegistry>();
                match request {
                    AvatarDeepLinkRequest::Launch(context) => {
                        route_avatar_launch_context(app.handle(), &registry, context, false)?;
                    }
                    AvatarDeepLinkRequest::Close(request) => {
                        let _ = close_avatar_instance(app.handle(), &registry, &request);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nimi-avatar tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
        GUARD
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::temp_dir().join(format!("nimi-avatar-{name}-{suffix}"))
    }

    #[test]
    fn scan_handler_dir_returns_only_public_js_files_sorted() {
        let root = unique_temp_dir("scan-handlers");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("zeta.js"), "export default {}").unwrap();
        fs::write(root.join("alpha.js"), "export default {}").unwrap();
        fs::write(root.join("_private.js"), "export default {}").unwrap();
        fs::write(root.join("notes.txt"), "ignore").unwrap();
        fs::create_dir_all(root.join("nested.js")).unwrap();

        let entries = scan_handler_dir(&root);

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.file_stem.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "zeta"]
        );
        assert!(entries
            .iter()
            .all(|entry| entry.absolute_path.ends_with(".js")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_runtime_dir_accepts_package_root_or_runtime_dir_only() {
        let root = unique_temp_dir("runtime-dir");
        let runtime = root.join("runtime");
        fs::create_dir_all(&runtime).unwrap();

        assert_eq!(resolve_runtime_dir(&root).unwrap(), runtime);
        assert_eq!(resolve_runtime_dir(&root.join("runtime")).unwrap(), runtime);
        assert!(resolve_runtime_dir(&root.join("missing")).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    fn write_agent_center_live2d_package_for_agent(
        home: &Path,
        agent_id: &str,
        entry_content: &str,
    ) -> PathBuf {
        write_agent_center_live2d_package_for_account_agent(
            home,
            "account_1",
            agent_id,
            entry_content,
        )
    }

    fn write_agent_center_live2d_package_for_account_agent(
        home: &Path,
        account_id: &str,
        agent_id: &str,
        entry_content: &str,
    ) -> PathBuf {
        let package_dir = home
            .join(".nimi/data/accounts")
            .join(agent_center_path_segment(account_id))
            .join("agents")
            .join(agent_center_path_segment(agent_id))
            .join("agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56");
        let files_dir = package_dir.join("files");
        fs::create_dir_all(&files_dir).unwrap();
        let entry_path = files_dir.join("ren.model3.json");
        fs::write(&entry_path, entry_content).unwrap();
        let digest = {
            let mut hasher = Sha256::new();
            hasher.update(entry_content.as_bytes());
            format!("{:x}", hasher.finalize())
        };
        let manifest = json!({
            "manifest_version": 1,
            "package_version": "1.0.0",
            "package_id": "live2d_ab12cd34ef56",
            "kind": "live2d",
            "loader_min_version": "1.0.0",
            "display_name": "Ren",
            "display_name_i18n": {},
            "entry_file": "files/ren.model3.json",
            "required_files": ["files/ren.model3.json"],
            "content_digest": format!("sha256:{digest}"),
            "files": [{
                "path": "files/ren.model3.json",
                "sha256": digest,
                "bytes": entry_content.len(),
                "mime": "application/json"
            }],
            "limits": {
                "max_manifest_bytes": 262144,
                "max_package_bytes": 524288000,
                "max_file_bytes": 104857600,
                "max_file_count": 2048
            },
            "capabilities": {},
            "import": {
                "imported_at": "2026-04-27T00:00:00Z",
                "source_label": "ren",
                "source_fingerprint": format!("sha256:{digest}")
            }
        });
        fs::write(
            package_dir.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        package_dir
    }

    fn write_agent_center_live2d_package(home: &Path, entry_content: &str) -> PathBuf {
        write_agent_center_live2d_package_for_agent(home, "agent_1", entry_content)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_agent_center_avatar_package_returns_live2d_model_manifest() {
        let _guard = env_guard();
        let home = unique_temp_dir("agent-center-package");
        fs::create_dir_all(&home).unwrap();
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);

        let manifest = nimi_avatar_resolve_agent_center_avatar_package(
            AgentCenterAvatarPackageResolvePayload {
                agent_center_account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                avatar_package_kind: "live2d".to_string(),
                avatar_package_id: "live2d_ab12cd34ef56".to_string(),
                avatar_package_schema_version: 1,
            },
        )
        .await
        .expect("resolve package manifest");

        assert_eq!(manifest.model_id, "ren");
        assert!(manifest.model3_json_path.ends_with("files/ren.model3.json"));
        assert_eq!(
            manifest.runtime_dir,
            package_dir
                .join("files")
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
        );

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_agent_center_avatar_package_accepts_runtime_scoped_agent_id() {
        let _guard = env_guard();
        let home = unique_temp_dir("agent-center-package-runtime-agent");
        fs::create_dir_all(&home).unwrap();
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        let package_dir =
            write_agent_center_live2d_package_for_agent(&home, "~agent_1_tffk", r#"{"Version":3}"#);

        let manifest = nimi_avatar_resolve_agent_center_avatar_package(
            AgentCenterAvatarPackageResolvePayload {
                agent_center_account_id: "account_1".to_string(),
                agent_id: "~agent_1_tffk".to_string(),
                avatar_package_kind: "live2d".to_string(),
                avatar_package_id: "live2d_ab12cd34ef56".to_string(),
                avatar_package_schema_version: 1,
            },
        )
        .await
        .expect("resolve runtime scoped package manifest");

        assert_eq!(
            manifest.runtime_dir,
            package_dir
                .join("files")
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
        );

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_agent_center_avatar_package_accepts_opaque_runtime_agent_id() {
        let _guard = env_guard();
        let home = unique_temp_dir("agent-center-package-opaque-agent");
        fs::create_dir_all(&home).unwrap();
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        let agent_id = "agent:abc.def+1";
        let package_dir =
            write_agent_center_live2d_package_for_agent(&home, agent_id, r#"{"Version":3}"#);

        let manifest = nimi_avatar_resolve_agent_center_avatar_package(
            AgentCenterAvatarPackageResolvePayload {
                agent_center_account_id: "account_1".to_string(),
                agent_id: agent_id.to_string(),
                avatar_package_kind: "live2d".to_string(),
                avatar_package_id: "live2d_ab12cd34ef56".to_string(),
                avatar_package_schema_version: 1,
            },
        )
        .await
        .expect("resolve opaque runtime scoped package manifest");

        assert_eq!(
            manifest.runtime_dir,
            package_dir
                .join("files")
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
        );

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_agent_center_avatar_package_accepts_opaque_account_id() {
        let _guard = env_guard();
        let home = unique_temp_dir("agent-center-package-opaque-account");
        fs::create_dir_all(&home).unwrap();
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        let account_id = "account:abc.def+1";
        let package_dir = write_agent_center_live2d_package_for_account_agent(
            &home,
            account_id,
            "agent_1",
            r#"{"Version":3}"#,
        );

        let manifest = nimi_avatar_resolve_agent_center_avatar_package(
            AgentCenterAvatarPackageResolvePayload {
                agent_center_account_id: account_id.to_string(),
                agent_id: "agent_1".to_string(),
                avatar_package_kind: "live2d".to_string(),
                avatar_package_id: "live2d_ab12cd34ef56".to_string(),
                avatar_package_schema_version: 1,
            },
        )
        .await
        .expect("resolve opaque account package manifest");

        assert_eq!(
            manifest.runtime_dir,
            package_dir
                .join("files")
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
        );

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_agent_center_avatar_package_rejects_vrm_and_digest_mismatch() {
        let _guard = env_guard();
        let home = unique_temp_dir("agent-center-package-invalid");
        fs::create_dir_all(&home).unwrap();
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        write_agent_center_live2d_package(&home, r#"{"Version":3}"#);

        let vrm_error = nimi_avatar_resolve_agent_center_avatar_package(
            AgentCenterAvatarPackageResolvePayload {
                agent_center_account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                avatar_package_kind: "vrm".to_string(),
                avatar_package_id: "vrm_ab12cd34ef56".to_string(),
                avatar_package_schema_version: 1,
            },
        )
        .await
        .expect_err("vrm loader is unavailable");
        assert!(vrm_error.contains("Live2D"));

        let entry = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56/files/ren.model3.json");
        fs::write(entry, r#"{"Version":4}"#).unwrap();
        let digest_error = nimi_avatar_resolve_agent_center_avatar_package(
            AgentCenterAvatarPackageResolvePayload {
                agent_center_account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                avatar_package_kind: "live2d".to_string(),
                avatar_package_id: "live2d_ab12cd34ef56".to_string(),
                avatar_package_schema_version: 1,
            },
        )
        .await
        .expect_err("digest mismatch should fail closed");
        assert!(digest_error.contains("differs from manifest"));

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = fs::remove_dir_all(&home);
    }
}
