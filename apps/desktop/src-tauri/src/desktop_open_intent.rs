use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tokio::{net::TcpListener, sync::oneshot};

#[path = "desktop_open_intent_parser.rs"]
mod parser;
#[path = "desktop_open_intent_presence.rs"]
mod presence;

#[cfg(test)]
#[path = "desktop_open_intent_presence_tests.rs"]
mod presence_descriptor_tests;

pub(crate) use parser::parse_desktop_open_intent_envelope;
use presence::{
    now_iso8601, presence_descriptor_path, random_base64_url, write_presence_descriptor,
};

pub(crate) const DESKTOP_OPEN_INTENT_EVENT: &str = "desktop-open://open-intent";
const DESKTOP_OPEN_INTENT_PATH: &str = "/v1/open-intent";
const PRESENCE_RELATIVE_PATH: &[&str] = &["run", "desktop", "open-intent", "presence.v1.json"];
const PRESENCE_HEARTBEAT_INTERVAL_MS: u64 = 3_000;
const RENDERER_READY_HEARTBEAT_TTL_MS: u64 = 10_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopOpenIntentEnvelope {
    schema_version: u8,
    source_app: String,
    source_host: String,
    request_id: String,
    pub(crate) intent: DesktopOpenIntentTarget,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopOpenIntentTarget {
    pub(crate) kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) section: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    product_intent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) page: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    view: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    app_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DesktopOpenIntentError {
    pub(crate) reason_code: String,
    field: Option<String>,
    message: String,
}

impl std::fmt::Display for DesktopOpenIntentError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for DesktopOpenIntentError {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopOpenBridgeResponse {
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    confirmation: Option<String>,
    bridge_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) applied_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopOpenPresenceDescriptor {
    schema_version: u8,
    desktop_app_id: String,
    bridge_id: String,
    pid: u32,
    endpoint: String,
    token: String,
    started_at: String,
    last_heartbeat_at: String,
}

#[derive(Clone)]
pub(crate) struct DesktopOpenIntentRuntime {
    inner: Arc<DesktopOpenIntentRuntimeInner>,
}

struct DesktopOpenIntentRuntimeInner {
    ready: Arc<AtomicBool>,
    last_ready_heartbeat: Arc<Mutex<Option<Instant>>>,
    descriptor_path: PathBuf,
    shutdown: Mutex<Vec<oneshot::Sender<()>>>,
}

#[derive(Clone)]
struct DesktopOpenIntentServerState {
    app: AppHandle,
    ready: Arc<AtomicBool>,
    last_ready_heartbeat: Arc<Mutex<Option<Instant>>>,
    bridge_id: String,
    token: String,
}

impl DesktopOpenIntentRuntime {
    pub(crate) fn set_ready(&self, ready: bool) {
        set_desktop_open_ready(&self.inner.ready, &self.inner.last_ready_heartbeat, ready);
    }

    pub(crate) fn shutdown(&self) {
        let mut senders = self
            .inner
            .shutdown
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for sender in senders.drain(..) {
            let _ = sender.send(());
        }
        let _ = fs::remove_file(&self.inner.descriptor_path);
    }
}

impl DesktopOpenIntentServerState {
    fn is_ready(&self) -> bool {
        is_desktop_open_ready(&self.ready, &self.last_ready_heartbeat)
    }
}

impl Drop for DesktopOpenIntentRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[tauri::command]
pub(crate) fn desktop_open_intent_set_ready(
    runtime: tauri::State<DesktopOpenIntentRuntime>,
    ready: bool,
) {
    runtime.set_ready(ready);
}

pub(crate) fn start_desktop_open_intent_bridge(
    app: AppHandle,
) -> Result<DesktopOpenIntentRuntime, String> {
    let nimi_dir = crate::desktop_paths::resolve_nimi_dir()?;
    let descriptor_path = presence_descriptor_path(&nimi_dir);
    let bridge_id = format!("desktop-open-bridge-{}", random_base64_url(18)?);
    let token = random_base64_url(32)?;
    let started_at = now_iso8601();
    let listener = tauri::async_runtime::block_on(TcpListener::bind("127.0.0.1:0"))
        .map_err(|error| format!("desktop open intent bridge bind failed: {error}"))?;
    let endpoint = format!(
        "http://{}",
        listener
            .local_addr()
            .map_err(|error| format!("desktop open intent bridge local_addr failed: {error}"))?
    );
    let ready = Arc::new(AtomicBool::new(false));
    let last_ready_heartbeat = Arc::new(Mutex::new(None));
    let runtime = DesktopOpenIntentRuntime {
        inner: Arc::new(DesktopOpenIntentRuntimeInner {
            ready: ready.clone(),
            last_ready_heartbeat: last_ready_heartbeat.clone(),
            descriptor_path: descriptor_path.clone(),
            shutdown: Mutex::new(Vec::new()),
        }),
    };
    let descriptor = DesktopOpenPresenceDescriptor {
        schema_version: 1,
        desktop_app_id: "nimi.desktop".to_string(),
        bridge_id: bridge_id.clone(),
        pid: std::process::id(),
        endpoint: endpoint.clone(),
        token: token.clone(),
        started_at,
        last_heartbeat_at: now_iso8601(),
    };
    write_presence_descriptor(&descriptor_path, &descriptor)?;

    let (server_shutdown_tx, server_shutdown_rx) = oneshot::channel();
    let (heartbeat_shutdown_tx, mut heartbeat_shutdown_rx) = oneshot::channel();
    {
        let mut senders = runtime
            .inner
            .shutdown
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        senders.push(server_shutdown_tx);
        senders.push(heartbeat_shutdown_tx);
    }

    let server_state = DesktopOpenIntentServerState {
        app,
        ready: ready.clone(),
        last_ready_heartbeat: last_ready_heartbeat.clone(),
        bridge_id: bridge_id.clone(),
        token: token.clone(),
    };
    let router = Router::new()
        .route(DESKTOP_OPEN_INTENT_PATH, post(handle_desktop_open_intent))
        .fallback(reject_unknown_desktop_open_route)
        .with_state(server_state);
    tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = server_shutdown_rx.await;
            })
            .await;
        if let Err(error) = result {
            eprintln!("[desktop-open] bridge server failed: {error}");
        }
    });

    let heartbeat_descriptor_path = descriptor_path.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval =
            tokio::time::interval(Duration::from_millis(PRESENCE_HEARTBEAT_INTERVAL_MS));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let descriptor = DesktopOpenPresenceDescriptor {
                        schema_version: 1,
                        desktop_app_id: "nimi.desktop".to_string(),
                        bridge_id: bridge_id.clone(),
                        pid: std::process::id(),
                        endpoint: endpoint.clone(),
                        token: token.clone(),
                        started_at: descriptor.started_at.clone(),
                        last_heartbeat_at: now_iso8601(),
                    };
                    if let Err(error) = write_presence_descriptor(&heartbeat_descriptor_path, &descriptor) {
                        eprintln!("[desktop-open] presence heartbeat failed: {error}");
                    }
                }
                _ = &mut heartbeat_shutdown_rx => break,
            }
        }
    });

    // Keep one readiness flag for Tauri State and server state in sync.
    set_desktop_open_ready(&ready, &last_ready_heartbeat, false);
    Ok(runtime)
}

async fn handle_desktop_open_intent(
    State(state): State<DesktopOpenIntentServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if !is_authorized_desktop_open_request(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(rejected_response(
                &state.bridge_id,
                "desktop-open-bridge-auth-failed",
                "check_desktop_runtime_bridge",
            )),
        );
    }

    let parsed_json: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::OK,
                Json(rejected_response(
                    &state.bridge_id,
                    "desktop-open-intent-invalid",
                    "fix_desktop_open_intent",
                )),
            );
        }
    };
    let envelope = match parse_desktop_open_intent_envelope(parsed_json) {
        Ok(value) => value,
        Err(error) => {
            let reason_code = if error.reason_code == "desktop-open-target-unsupported" {
                "desktop-open-target-unsupported"
            } else {
                "desktop-open-intent-invalid"
            };
            return (
                StatusCode::OK,
                Json(rejected_response(
                    &state.bridge_id,
                    reason_code,
                    "fix_desktop_open_intent",
                )),
            );
        }
    };

    if !state.is_ready() {
        return (
            StatusCode::OK,
            Json(project_desktop_open_bridge_response(
                &state.bridge_id,
                false,
                &envelope,
            )),
        );
    }

    if focus_and_emit_desktop_open_intent(&state.app, &envelope).is_err() {
        return (
            StatusCode::OK,
            Json(rejected_response(
                &state.bridge_id,
                "desktop-open-desktop-not-ready",
                "wait_for_desktop_ready",
            )),
        );
    }

    (
        StatusCode::OK,
        Json(project_desktop_open_bridge_response(
            &state.bridge_id,
            true,
            &envelope,
        )),
    )
}

fn set_desktop_open_ready(
    ready: &AtomicBool,
    last_ready_heartbeat: &Mutex<Option<Instant>>,
    value: bool,
) {
    let mut heartbeat = last_ready_heartbeat
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if value {
        *heartbeat = Some(Instant::now());
        ready.store(true, Ordering::SeqCst);
    } else {
        ready.store(false, Ordering::SeqCst);
        *heartbeat = None;
    }
}

fn is_desktop_open_ready(
    ready: &AtomicBool,
    last_ready_heartbeat: &Mutex<Option<Instant>>,
) -> bool {
    if !ready.load(Ordering::SeqCst) {
        return false;
    }
    let mut heartbeat = last_ready_heartbeat
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(last_seen) = *heartbeat else {
        ready.store(false, Ordering::SeqCst);
        return false;
    };
    if last_seen.elapsed() > Duration::from_millis(RENDERER_READY_HEARTBEAT_TTL_MS) {
        ready.store(false, Ordering::SeqCst);
        *heartbeat = None;
        return false;
    }
    true
}

async fn reject_unknown_desktop_open_route() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "status": "rejected",
            "reasonCode": "desktop-open-intent-invalid",
            "actionHint": "fix_desktop_open_intent",
        })),
    )
}

fn focus_and_emit_desktop_open_intent(
    app: &AppHandle,
    envelope: &DesktopOpenIntentEnvelope,
) -> Result<(), String> {
    crate::menu_bar_shell::window::focus_main_window(app)?;
    crate::menu_bar_shell::set_window_visible(app, true);
    app.emit(DESKTOP_OPEN_INTENT_EVENT, envelope.clone())
        .map_err(|error| format!("desktop open intent emit failed: {error}"))
}

pub(crate) fn project_desktop_open_bridge_response(
    bridge_id: &str,
    ready: bool,
    envelope: &DesktopOpenIntentEnvelope,
) -> DesktopOpenBridgeResponse {
    if !ready {
        return rejected_response(
            bridge_id,
            "desktop-open-desktop-not-ready",
            "wait_for_desktop_ready",
        );
    }
    DesktopOpenBridgeResponse {
        status: "accepted".to_string(),
        confirmation: Some("desktop-accepted".to_string()),
        bridge_id: bridge_id.to_string(),
        request_id: Some(envelope.request_id.clone()),
        applied_target: Some(envelope.intent.kind.clone()),
        reason_code: None,
        action_hint: None,
    }
}

fn rejected_response(
    bridge_id: &str,
    reason_code: &str,
    action_hint: &str,
) -> DesktopOpenBridgeResponse {
    DesktopOpenBridgeResponse {
        status: "rejected".to_string(),
        confirmation: None,
        bridge_id: bridge_id.to_string(),
        request_id: None,
        applied_target: None,
        reason_code: Some(reason_code.to_string()),
        action_hint: Some(action_hint.to_string()),
    }
}

fn is_authorized_desktop_open_request(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == format!("Bearer {token}"))
        .unwrap_or(false)
}
