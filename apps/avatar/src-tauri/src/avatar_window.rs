use super::*;
use serde::Serialize;
use serde_json::json;
use std::hash::{Hash, Hasher};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
pub(crate) struct ReadyPayload {
    pub(crate) label: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvatarCursorClientPosition {
    pub(crate) screen_x: f64,
    pub(crate) screen_y: f64,
    pub(crate) client_x: f64,
    pub(crate) client_y: f64,
    pub(crate) scale_factor: f64,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AvatarRuntimeIdentityBindingPayload {
    pub(crate) avatar_instance_id: String,
    pub(crate) owner_user_id: String,
    pub(crate) runtime_source_ref: String,
    pub(crate) local_agent_ref: String,
    pub(crate) launch_source: Option<String>,
}
pub(crate) const AVATAR_WINDOW_LABEL_PREFIX: &str = "avatar-instance";
pub(crate) const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";
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

pub(crate) fn is_avatar_window_label(label: &str) -> bool {
    label.starts_with(&format!("{AVATAR_WINDOW_LABEL_PREFIX}-"))
}

pub(crate) fn emit_avatar_shell_ready_for_webview(webview: &tauri::Webview) {
    let size = webview.window().inner_size().ok();
    let payload = ReadyPayload {
        label: webview.label().to_string(),
        width: size.as_ref().map(|s| s.width).unwrap_or(0),
        height: size.as_ref().map(|s| s.height).unwrap_or(0),
    };
    let _ = webview.emit("avatar://shell-ready", payload);
}

pub(crate) fn sync_avatar_window_to_launch_context(
    window: &WebviewWindow,
    context: &AvatarLaunchContext,
    emit_update_event: bool,
) {
    let title_instance = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or_else(|| window.label());
    let _ = window.set_title(&format!("Nimi Avatar · {}", title_instance));
    let _ = window.show();
    let _ = window.set_focus();
    if emit_update_event {
        let _ = window.emit(AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT, context);
    }
}

pub(crate) fn attach_avatar_window_lifecycle(window: &WebviewWindow, app: &tauri::AppHandle) {
    let app_handle = app.clone();
    let window_label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let registry = app_handle.state::<AvatarInstanceRegistry>();
            if let Ok(Some(context)) = registry.context_for_window(&window_label) {
                record_avatar_backend_evidence(
                    &context,
                    "avatar.window.destroyed",
                    json!({
                        "source": "avatar-backend",
                        "window_label": window_label,
                    }),
                );
            }
            let _ = registry.remove_window(&window_label);
            sync_avatar_instance_projection(&registry);
        }
    });
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn sync_avatar_instance_projection(registry: &AvatarInstanceRegistry) {
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
        .filter_map(|entry| projection_record_from_registry_entry(&entry))
        .collect::<Vec<_>>();
    if let Err(error) = persist_projection(std::process::id(), published_at_ms, projection) {
        eprintln!("[avatar-instance-projection] persist failed: {error}");
    }
}

pub(crate) fn start_avatar_instance_projection_heartbeat(app: &tauri::AppHandle) {
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

pub(crate) fn record_avatar_backend_evidence(
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

fn avatar_renderer_initialization_script() -> &'static str {
    r#"
(() => {
  const toErrorDetail = (error) => {
    if (error && typeof error === 'object') {
      return {
        name: typeof error.name === 'string' ? error.name : 'Error',
        message: typeof error.message === 'string' ? error.message : String(error),
        stack: typeof error.stack === 'string' ? error.stack : null,
      };
    }
    return { name: 'UnknownError', message: String(error), stack: null };
  };
  const record = (kind, detail) => {
    try {
      const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (typeof invoke !== 'function') return;
      void invoke('nimi_avatar_record_evidence', {
        payload: {
          kind,
          recordedAt: new Date().toISOString(),
          detail,
          consume: {},
          model: {},
        },
      }).catch(() => {});
    } catch (_) {}
  };
  record('avatar.renderer.entry-loaded', {
    source: 'avatar-renderer-init-script',
    phase: 'document-start',
  });
  window.addEventListener('error', (event) => {
    if (event && event.target && event.target !== window) {
      const target = event.target;
      record('avatar.renderer.failed', {
        source: 'avatar-renderer-init-script',
        phase: 'resource-error',
        tag_name: typeof target.tagName === 'string' ? target.tagName : null,
        source_url: typeof target.src === 'string' ? target.src : typeof target.href === 'string' ? target.href : null,
        rel: typeof target.rel === 'string' ? target.rel : null,
        type: typeof target.type === 'string' ? target.type : null,
      });
      return;
    }
    record('avatar.renderer.failed', {
      source: 'avatar-renderer-init-script',
      phase: 'window-error',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: toErrorDetail(event.error),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    record('avatar.renderer.failed', {
      source: 'avatar-renderer-init-script',
      phase: 'unhandled-rejection',
      reason: toErrorDetail(event.reason),
    });
  });
  window.setTimeout(() => {
    if (window.__NIMI_AVATAR_RENDERER_MODULE_ENTRY__ === true) return;
    const scripts = Array.from(document.scripts || []).map((script) => ({
      src: script.src || null,
      type: script.type || null,
      async: script.async === true,
      defer: script.defer === true,
    }));
    const root = document.getElementById('root');
    record('avatar.renderer.failed', {
      source: 'avatar-renderer-init-script',
      phase: 'renderer-module-entry-missing',
      location_href: String(window.location && window.location.href || ''),
      document_ready_state: document.readyState,
      scripts,
      root_child_count: root ? root.childElementCount : null,
      body_text_length: document.body && typeof document.body.innerText === 'string' ? document.body.innerText.length : null,
      has_tauri_internals: !!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke),
      has_tauri_ipc: typeof window.__TAURI_IPC__ !== 'undefined',
    });
  }, 1500);
})();
"#
}

pub(crate) fn build_avatar_window(
    app: &tauri::AppHandle,
    window_label: &str,
) -> Result<WebviewWindow, String> {
    // K-NAV-SHELL-001: transparent + decorations(false) + skip_taskbar(true) +
    // shadow(false) are required (not optional) per app-shell-contract §1.1.
    // Transparent is what lets the embodiment-stage's transparent background
    // actually show desktop underneath outside the model alpha + companion
    // surface bounds. Without it the window paints opaque dark, defeating the
    // entire "桌面悬浮 embodiment surface" product form.
    // skip_taskbar deliberately omitted: on macOS it switches the window to
    // utility-style (NSWindow.canJoinAllSpaces / stationary) which interferes
    // with `start_dragging()` and click-through semantics. The Avatar window
    // stays in the dock; we accept that until tray icon plumbing lands.
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::App("/".into()))
        .initialization_script(avatar_renderer_initialization_script())
        .title("Nimi Avatar")
        .inner_size(400.0, 600.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
        .build()
        .map_err(|error| format!("failed to build avatar window: {error}"))?;
    let _ = window.set_always_on_top(true);
    #[cfg(debug_assertions)]
    window.open_devtools();
    Ok(window)
}

pub(crate) fn normalize_avatar_launch_instance_id(
    context: &mut AvatarLaunchContext,
    fallback_instance_id: String,
) -> String {
    match context.avatar_instance_id.clone() {
        Some(instance_id) => instance_id,
        None => {
            context.avatar_instance_id = Some(fallback_instance_id.clone());
            fallback_instance_id
        }
    }
}

pub(crate) fn route_avatar_launch_context(
    app: &tauri::AppHandle,
    registry: &AvatarInstanceRegistry,
    mut context: AvatarLaunchContext,
    emit_update_event_for_reused_window: bool,
) -> Result<(), String> {
    let instance_id =
        normalize_avatar_launch_instance_id(&mut context, format!("avatar-{}", now_ms()));
    if let Some(window_label) = registry.window_label_for_instance(&instance_id)? {
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

    let window_label = avatar_window_label_for_instance(&instance_id);
    registry.bind_window(window_label.clone(), context.clone())?;
    let window = match build_avatar_window(app, &window_label) {
        Ok(window) => window,
        Err(error) => {
            let _ = registry.remove_window(&window_label);
            sync_avatar_instance_projection(registry);
            return Err(error);
        }
    };
    attach_avatar_window_lifecycle(&window, app);
    record_avatar_backend_evidence(
        &context,
        "avatar.window.created",
        json!({
            "source": "avatar-backend",
            "window_label": window.label(),
            "window_reused": false
        }),
    );
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

pub(crate) fn close_avatar_instance(
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
