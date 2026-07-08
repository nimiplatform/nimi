use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tokio::{net::TcpListener, sync::oneshot};

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

pub(crate) fn parse_desktop_open_intent_envelope(
    value: Value,
) -> Result<DesktopOpenIntentEnvelope, DesktopOpenIntentError> {
    let record = object(value, "DesktopOpenIntent envelope")?;
    assert_fields(
        &record,
        &[
            "schemaVersion",
            "sourceApp",
            "sourceHost",
            "requestId",
            "intent",
        ],
        "DesktopOpenIntent envelope",
    )?;
    if record.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(invalid(
            "schemaVersion",
            "DesktopOpenIntent envelope schemaVersion must be 1",
        ));
    }
    let source_app = parse_app_id(record.get("sourceApp"), "sourceApp")?;
    let source_host = required_string(record.get("sourceHost"), "sourceHost")?;
    if !matches!(
        source_host.as_str(),
        "electron-standard-shell"
            | "tauri-standard-shell"
            | "desktop-electron-installed-app-host"
            | "dev-fixture"
    ) {
        return Err(invalid(
            "sourceHost",
            "DesktopOpenIntent sourceHost is not admitted",
        ));
    }
    let request_id = parse_request_id(record.get("requestId"), "requestId")?;
    let intent = parse_desktop_open_intent_target(
        record
            .get("intent")
            .cloned()
            .ok_or_else(|| invalid("intent", "DesktopOpenIntent intent is required"))?,
    )?;
    Ok(DesktopOpenIntentEnvelope {
        schema_version: 1,
        source_app,
        source_host,
        request_id,
        intent,
    })
}

fn parse_desktop_open_intent_target(
    value: Value,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    let record = object(value, "DesktopOpenIntent intent")?;
    let kind = required_string(record.get("kind"), "intent.kind")?;
    match kind.as_str() {
        "open-explore" => parse_explore_target(record),
        "open-runtime-config" => parse_runtime_config_target(record),
        "open-agents" => parse_agents_target(record),
        "open-apps" => parse_apps_target(record),
        "open-settings" => parse_settings_target(record),
        "open-url" => Err(invalid(
            "intent.kind",
            "DesktopOpenIntent does not admit raw URL payloads",
        )),
        _ => Err(unsupported(
            "intent.kind",
            "DesktopOpenIntent target is not admitted",
        )),
    }
}

fn parse_explore_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "section", "productIntent", "query"],
        "DesktopOpenIntent explore intent",
    )?;
    let section = required_string(record.get("section"), "intent.section")?;
    if !matches!(section.as_str(), "worlds" | "personas" | "activity") {
        return Err(unsupported(
            "intent.section",
            "DesktopOpenIntent explore section is not admitted",
        ));
    }
    let product_intent = optional_string(record.get("productIntent"), "intent.productIntent")?;
    if let Some(product_intent_value) = &product_intent {
        let admitted = match section.as_str() {
            "worlds" => product_intent_value == "discover-worlds",
            "personas" => {
                product_intent_value == "discover-personas"
                    || product_intent_value == "select-partner"
            }
            "activity" => product_intent_value == "view-activity",
            _ => false,
        };
        if !admitted {
            return Err(unsupported(
                "intent.productIntent",
                "DesktopOpenIntent explore productIntent is not admitted for section",
            ));
        }
    }
    let query = optional_string(record.get("query"), "intent.query")?;
    if query
        .as_ref()
        .is_some_and(|value| value.chars().count() > 160)
    {
        return Err(invalid(
            "intent.query",
            "DesktopOpenIntent query must be 160 characters or fewer",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-explore".to_string(),
        section: Some(section),
        product_intent,
        query,
        page: None,
        action: None,
        view: None,
        app_id: None,
    })
}

fn parse_runtime_config_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "page", "action"],
        "DesktopOpenIntent runtime config intent",
    )?;
    let page = required_string(record.get("page"), "intent.page")?;
    let action = required_string(record.get("action"), "intent.action")?;
    let admitted = (page == "cloud" && action == "add-connector")
        || (page == "models" && action == "install-model");
    if !admitted {
        return Err(unsupported(
            "intent.action",
            "DesktopOpenIntent runtime config target is not admitted",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-runtime-config".to_string(),
        section: None,
        product_intent: None,
        query: None,
        page: Some(page),
        action: Some(action),
        view: None,
        app_id: None,
    })
}

fn parse_agents_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "view"],
        "DesktopOpenIntent agents intent",
    )?;
    let view = required_string(record.get("view"), "intent.view")?;
    if view != "inventory" {
        return Err(unsupported(
            "intent.view",
            "DesktopOpenIntent agents view is not admitted",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-agents".to_string(),
        section: None,
        product_intent: None,
        query: None,
        page: None,
        action: None,
        view: Some(view),
        app_id: None,
    })
}

fn parse_apps_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(&record, &["kind", "appId"], "DesktopOpenIntent apps intent")?;
    let app_id = match record.get("appId") {
        Some(value) => Some(parse_app_id(Some(value), "intent.appId")?),
        None => None,
    };
    Ok(DesktopOpenIntentTarget {
        kind: "open-apps".to_string(),
        section: None,
        product_intent: None,
        query: None,
        page: None,
        action: None,
        view: None,
        app_id,
    })
}

fn parse_settings_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "section"],
        "DesktopOpenIntent settings intent",
    )?;
    let section = required_string(record.get("section"), "intent.section")?;
    if section != "profile" {
        return Err(unsupported(
            "intent.section",
            "DesktopOpenIntent settings section is not admitted",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-settings".to_string(),
        section: Some(section),
        product_intent: None,
        query: None,
        page: None,
        action: None,
        view: None,
        app_id: None,
    })
}

fn object(value: Value, label: &str) -> Result<Map<String, Value>, DesktopOpenIntentError> {
    match value {
        Value::Object(record) => Ok(record),
        _ => Err(invalid("", &format!("{label} must be an object"))),
    }
}

fn assert_fields(
    record: &Map<String, Value>,
    fields: &[&str],
    label: &str,
) -> Result<(), DesktopOpenIntentError> {
    let allowed: BTreeSet<&str> = fields.iter().copied().collect();
    for field in record.keys() {
        if !allowed.contains(field.as_str()) {
            return Err(invalid(
                field,
                &format!("{label} contains unsupported field"),
            ));
        }
    }
    Ok(())
}

fn optional_string(
    value: Option<&Value>,
    field: &str,
) -> Result<Option<String>, DesktopOpenIntentError> {
    value
        .map(|inner| required_string(Some(inner), field))
        .transpose()
}

fn required_string(value: Option<&Value>, field: &str) -> Result<String, DesktopOpenIntentError> {
    let Some(Value::String(value)) = value else {
        return Err(invalid(field, "DesktopOpenIntent field must be a string"));
    };
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(invalid(field, "DesktopOpenIntent field is required"));
    }
    Ok(normalized.to_string())
}

fn parse_app_id(value: Option<&Value>, field: &str) -> Result<String, DesktopOpenIntentError> {
    let app_id = required_string(value, field)?;
    if app_id.len() > 96 || !is_valid_app_id(&app_id) {
        return Err(invalid(field, "DesktopOpenIntent app id is invalid"));
    }
    Ok(app_id)
}

fn is_valid_app_id(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment.chars().all(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
                })
                && segment.chars().next().is_some_and(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit()
                })
                && segment.chars().last().is_some_and(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit()
                })
        })
}

fn parse_request_id(value: Option<&Value>, field: &str) -> Result<String, DesktopOpenIntentError> {
    let request_id = required_string(value, field)?;
    let suffix = request_id.strip_prefix("desktop-open-").unwrap_or("");
    if request_id.len() > 128
        || !matches!(suffix.chars().next(), Some(character) if character.is_ascii_alphanumeric())
        || !suffix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
    {
        return Err(invalid(field, "DesktopOpenIntent requestId is invalid"));
    }
    Ok(request_id)
}

fn invalid(field: &str, message: &str) -> DesktopOpenIntentError {
    DesktopOpenIntentError {
        reason_code: "desktop-open-intent-invalid".to_string(),
        field: (!field.is_empty()).then(|| field.to_string()),
        message: message.to_string(),
    }
}

fn unsupported(field: &str, message: &str) -> DesktopOpenIntentError {
    DesktopOpenIntentError {
        reason_code: "desktop-open-target-unsupported".to_string(),
        field: (!field.is_empty()).then(|| field.to_string()),
        message: message.to_string(),
    }
}

fn is_authorized_desktop_open_request(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == format!("Bearer {token}"))
        .unwrap_or(false)
}

fn presence_descriptor_path(nimi_dir: &Path) -> PathBuf {
    PRESENCE_RELATIVE_PATH
        .iter()
        .fold(nimi_dir.to_path_buf(), |path, segment| path.join(segment))
}

fn write_presence_descriptor(
    path: &Path,
    descriptor: &DesktopOpenPresenceDescriptor,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "desktop open presence descriptor path has no parent".to_string())?;
    reject_symlink_ancestry(parent, "desktop open presence parent")?;
    reject_symlink_if_exists(path, "desktop open presence descriptor")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("desktop open presence directory create failed: {error}"))?;
    reject_symlink_ancestry(parent, "desktop open presence parent")?;
    reject_descriptor_temp_symlinks(parent, path)?;
    set_owner_only_dir(parent)?;
    let temp_path = descriptor_temp_path(path)?;
    let bytes = serde_json::to_vec_pretty(descriptor)
        .map_err(|error| format!("desktop open presence serialize failed: {error}"))?;
    write_presence_temp_file(&temp_path, &bytes)?;
    replace_presence_descriptor_atomically(&temp_path, path)?;
    set_owner_only_file(path)
}

#[cfg(not(windows))]
fn replace_presence_descriptor_atomically(temp_path: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temp_path, path)
        .map_err(|error| format!("desktop open presence atomic replace failed: {error}"))
}

#[cfg(windows)]
fn replace_presence_descriptor_atomically(temp_path: &Path, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let target = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(format!(
            "desktop open presence atomic replace failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn descriptor_temp_path(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "desktop open presence descriptor path has no file name".to_string())?;
    Ok(path.with_file_name(format!("{}.{}.tmp", file_name, random_base64_url(12)?)))
}

fn write_presence_temp_file(temp_path: &Path, bytes: &[u8]) -> Result<(), String> {
    reject_symlink_if_exists(temp_path, "desktop open presence temp descriptor")?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    configure_owner_only_temp_open_options(&mut options);
    let mut file = options
        .open(temp_path)
        .map_err(|error| format!("desktop open presence temp create failed: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("desktop open presence temp write failed: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("desktop open presence temp sync failed: {error}"))?;
    set_owner_only_file(temp_path)
}

#[cfg(unix)]
fn configure_owner_only_temp_open_options(options: &mut fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
}

#[cfg(not(unix))]
fn configure_owner_only_temp_open_options(_options: &mut fs::OpenOptions) {}

fn reject_descriptor_temp_symlinks(parent: &Path, descriptor_path: &Path) -> Result<(), String> {
    let descriptor_file_name = descriptor_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "desktop open presence descriptor path has no file name".to_string())?;
    let temp_prefix = format!("{descriptor_file_name}.");
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("desktop open presence temp directory scan failed: {error}"))?
    {
        let entry = entry.map_err(|error| {
            format!("desktop open presence temp directory entry scan failed: {error}")
        })?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if !file_name.starts_with(temp_prefix.as_str()) || !file_name.ends_with(".tmp") {
            continue;
        }
        if entry
            .file_type()
            .map_err(|error| format!("desktop open presence temp metadata failed: {error}"))?
            .is_symlink()
        {
            return Err("desktop open presence temp descriptor must not be a symlink".to_string());
        }
    }
    Ok(())
}

fn reject_symlink_if_exists(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("{label} must not be a symlink"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{label} metadata check failed: {error}")),
    }
}

fn reject_symlink_ancestry(path: &Path, label: &str) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("{label} ancestry must not contain symlinks"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("{label} ancestry metadata check failed: {error}")),
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("desktop open presence chmod dir failed: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only_dir(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("desktop open presence chmod file failed: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only_file(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn random_base64_url(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("desktop open random generation failed: {error}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod presence_descriptor_tests {
    use super::{
        is_authorized_desktop_open_request, is_desktop_open_ready,
        reject_unknown_desktop_open_route, set_desktop_open_ready, write_presence_descriptor,
        DesktopOpenPresenceDescriptor, DESKTOP_OPEN_INTENT_PATH, RENDERER_READY_HEARTBEAT_TTL_MS,
    };
    use axum::{
        body::Body,
        http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode},
        routing::post,
        Router,
    };
    use std::fs;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };
    use std::time::{Duration, Instant};
    use tower::ServiceExt;

    fn test_descriptor() -> DesktopOpenPresenceDescriptor {
        DesktopOpenPresenceDescriptor {
            schema_version: 1,
            desktop_app_id: "nimi.desktop".to_string(),
            bridge_id: "desktop-open-bridge-test".to_string(),
            pid: 12345,
            endpoint: "http://127.0.0.1:49152".to_string(),
            token: "desktop-open-token-test".to_string(),
            started_at: "2026-07-08T00:00:00.000Z".to_string(),
            last_heartbeat_at: "2026-07-08T00:00:01.000Z".to_string(),
        }
    }

    #[test]
    fn desktop_open_presence_descriptor_writes_owner_only_file_and_directory() {
        let temp = tempfile::tempdir().expect("tempdir");
        let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
        let descriptor_path = temp_root
            .join("run")
            .join("desktop")
            .join("open-intent")
            .join("presence.v1.json");

        write_presence_descriptor(&descriptor_path, &test_descriptor()).expect("write descriptor");

        let parent = descriptor_path.parent().expect("descriptor parent");
        assert!(descriptor_path.is_file());
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                fs::read_to_string(&descriptor_path)
                    .expect("read descriptor")
                    .as_str()
            )
            .expect("descriptor json")["token"],
            "desktop-open-token-test",
        );
        assert_owner_only_dir(parent);
        assert_owner_only_file(&descriptor_path);
    }

    #[test]
    fn desktop_open_presence_descriptor_replaces_existing_descriptor() {
        let temp = tempfile::tempdir().expect("tempdir");
        let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
        let descriptor_path = temp_root
            .join("run")
            .join("desktop")
            .join("open-intent")
            .join("presence.v1.json");
        write_presence_descriptor(&descriptor_path, &test_descriptor()).expect("write descriptor");

        let mut heartbeat_descriptor = test_descriptor();
        heartbeat_descriptor.token = "desktop-open-token-rotated".to_string();
        heartbeat_descriptor.last_heartbeat_at = "2026-07-08T00:00:09.000Z".to_string();
        write_presence_descriptor(&descriptor_path, &heartbeat_descriptor)
            .expect("replace existing descriptor");

        let descriptor_json = serde_json::from_str::<serde_json::Value>(
            fs::read_to_string(&descriptor_path)
                .expect("read descriptor")
                .as_str(),
        )
        .expect("descriptor json");
        assert_eq!(descriptor_json["token"], "desktop-open-token-rotated");
        assert_eq!(
            descriptor_json["lastHeartbeatAt"],
            "2026-07-08T00:00:09.000Z"
        );
        assert_owner_only_file(&descriptor_path);
    }

    #[cfg(unix)]
    #[test]
    fn desktop_open_presence_descriptor_rejects_descriptor_symlink_before_token_write() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
        let parent = temp_root.join("run/desktop/open-intent");
        fs::create_dir_all(&parent).expect("create parent");
        let descriptor_path = parent.join("presence.v1.json");
        let target_path = temp_root.join("attacker-target");
        fs::write(&target_path, "before").expect("seed target");
        symlink(&target_path, &descriptor_path).expect("descriptor symlink");

        let error = write_presence_descriptor(&descriptor_path, &test_descriptor())
            .expect_err("descriptor symlink must reject");

        assert!(error.contains("symlink"), "{error}");
        assert_eq!(
            fs::read_to_string(&target_path).expect("read target"),
            "before"
        );
    }

    #[cfg(unix)]
    #[test]
    fn desktop_open_presence_descriptor_rejects_parent_symlink_before_token_write() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
        let real_parent = temp_root.join("real-open-intent");
        fs::create_dir_all(&real_parent).expect("create real parent");
        let link_parent = temp_root.join("run").join("desktop").join("open-intent");
        fs::create_dir_all(link_parent.parent().expect("link parent parent"))
            .expect("create link parent parent");
        symlink(&real_parent, &link_parent).expect("parent symlink");
        let descriptor_path = link_parent.join("presence.v1.json");

        let error = write_presence_descriptor(&descriptor_path, &test_descriptor())
            .expect_err("parent symlink must reject");

        assert!(error.contains("symlink"), "{error}");
        assert!(!real_parent.join("presence.v1.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn desktop_open_presence_descriptor_rejects_temp_symlink_before_token_write() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
        let parent = temp_root.join("run/desktop/open-intent");
        fs::create_dir_all(&parent).expect("create parent");
        let descriptor_path = parent.join("presence.v1.json");
        let temp_path = descriptor_path.with_extension("json.tmp");
        let target_path = temp_root.join("attacker-temp-target");
        fs::write(&target_path, "before").expect("seed target");
        symlink(&target_path, &temp_path).expect("temp symlink");

        let error = write_presence_descriptor(&descriptor_path, &test_descriptor())
            .expect_err("temp symlink must reject");

        assert!(
            error.contains("temp") || error.contains("symlink"),
            "{error}"
        );
        assert_eq!(
            fs::read_to_string(&target_path).expect("read target"),
            "before"
        );
        assert!(!descriptor_path.exists());
    }

    #[test]
    fn desktop_open_bridge_auth_rejects_invalid_token() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer attacker-token"),
        );

        assert!(!is_authorized_desktop_open_request(
            &headers,
            "desktop-open-token-test",
        ));

        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer desktop-open-token-test"),
        );
        assert!(is_authorized_desktop_open_request(
            &headers,
            "desktop-open-token-test",
        ));
    }

    #[tokio::test]
    async fn desktop_open_bridge_route_is_post_only_and_has_no_cors_surface() {
        let router = Router::new()
            .route(DESKTOP_OPEN_INTENT_PATH, post(|| async { StatusCode::OK }))
            .fallback(reject_unknown_desktop_open_route);

        let get_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(DESKTOP_OPEN_INTENT_PATH)
                    .body(Body::empty())
                    .expect("GET request"),
            )
            .await
            .expect("GET response");
        assert_eq!(get_response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_has_no_cors_headers(get_response.headers());

        let options_response = router
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri(DESKTOP_OPEN_INTENT_PATH)
                    .body(Body::empty())
                    .expect("OPTIONS request"),
            )
            .await
            .expect("OPTIONS response");
        assert_eq!(options_response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_has_no_cors_headers(options_response.headers());
    }

    #[test]
    fn desktop_open_ready_lifecycle_expires_stale_renderer_heartbeat() {
        let ready = AtomicBool::new(false);
        let heartbeat = Mutex::new(None);

        set_desktop_open_ready(&ready, &heartbeat, true);
        assert!(is_desktop_open_ready(&ready, &heartbeat));

        {
            let mut heartbeat = heartbeat.lock().expect("heartbeat lock");
            *heartbeat = Some(
                Instant::now() - Duration::from_millis(RENDERER_READY_HEARTBEAT_TTL_MS + 1_000),
            );
        }

        assert!(!is_desktop_open_ready(&ready, &heartbeat));
        assert!(!ready.load(Ordering::SeqCst));
    }

    #[cfg(unix)]
    fn assert_owner_only_dir(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)
            .expect("dir metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[cfg(not(unix))]
    fn assert_owner_only_dir(_path: &std::path::Path) {}

    #[cfg(unix)]
    fn assert_owner_only_file(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)
            .expect("file metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[cfg(not(unix))]
    fn assert_owner_only_file(_path: &std::path::Path) {}

    fn assert_has_no_cors_headers(headers: &HeaderMap) {
        assert!(!headers.contains_key("access-control-allow-origin"));
        assert!(!headers.contains_key("access-control-allow-methods"));
        assert!(!headers.contains_key("access-control-allow-headers"));
    }
}
