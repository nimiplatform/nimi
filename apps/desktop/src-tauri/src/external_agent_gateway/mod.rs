use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::Digest;
use tauri::AppHandle;
use tokio::sync::{oneshot, Mutex};

use crate::runtime_mod::store::{
    get_external_agent_token_record, get_runtime_kv, list_external_agent_token_records, open_db,
    set_runtime_kv, ExternalAgentTokenRecordPayload,
};

pub mod auth;
pub mod server;
pub mod token_issuer;

pub const EXTERNAL_AGENT_ACTION_REQUEST_EVENT: &str = "external-agent://action-request";
pub const EXTERNAL_AGENT_EVENT_TTL_SECS: i64 = 15 * 60;
pub const EXTERNAL_AGENT_MAX_EVENTS_PER_EXECUTION: usize = 64;
pub const EXTERNAL_AGENT_MAX_EXECUTION_STREAMS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentActionDescriptor {
    pub action_id: String,
    pub mod_id: String,
    pub source_type: String,
    pub description: Option<String>,
    pub operation: String,
    pub social_precondition: String,
    pub execution_mode: String,
    pub risk_level: String,
    pub supports_dry_run: bool,
    pub idempotent: bool,
    pub required_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentActionScope {
    pub action_id: String,
    pub ops: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentIssueTokenPayload {
    pub principal_id: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Option<Vec<ExternalAgentActionScope>>,
    pub ttl_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentIssueTokenResult {
    pub token: String,
    pub token_id: String,
    pub principal_id: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Vec<ExternalAgentActionScope>,
    pub issued_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
    pub issuer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentTokenRecord {
    pub token_id: String,
    pub principal_id: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Vec<ExternalAgentActionScope>,
    pub issued_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
    pub issuer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentRevokeTokenPayload {
    pub token_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentVerifyExecutionContextPayload {
    pub principal_id: String,
    pub subject_account_id: String,
    pub mode: String,
    pub issuer: String,
    pub auth_token_id: String,
    pub bridge_execution_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentSyncActionPayload {
    pub descriptors: Vec<ExternalAgentActionDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentExecutionPayload {
    pub execution_id: String,
    pub action_id: String,
    pub phase: String,
    pub input: serde_json::Value,
    pub context: serde_json::Value,
    pub idempotency_key: Option<String>,
    pub verify_ticket: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentExecutionCompletionPayload {
    pub execution_id: String,
    pub ok: bool,
    pub reason_code: String,
    pub action_hint: String,
    pub trace_id: String,
    pub audit_id: Option<String>,
    pub output: Option<serde_json::Value>,
    pub execution_mode: String,
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentGatewayStatus {
    pub enabled: bool,
    pub bind_address: String,
    pub issuer: String,
    pub action_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentClaims {
    pub sub: String,
    pub principal_id: String,
    pub principal_type: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Vec<ExternalAgentActionScope>,
    pub iat: usize,
    pub exp: usize,
    pub jti: String,
    pub iss: String,
}

#[derive(Debug, Clone)]
pub struct ExternalAgentGatewayConfig {
    pub bind_address: String,
    pub issuer: String,
    pub jws_secret: String,
}

const EXTERNAL_AGENT_SECRET_KV_KEY: &str = "external-agent.gateway.jws-secret";

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn generate_local_gateway_secret(seed_prefix: &str) -> String {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let raw = format!(
        "{}:{}:{}:{}",
        seed_prefix,
        std::process::id(),
        now_nanos,
        std::thread::current().name().unwrap_or("unnamed")
    );
    let digest = sha2::Sha256::digest(raw.as_bytes());
    digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
}

fn read_or_create_gateway_secret(app: &AppHandle) -> Result<String, String> {
    let conn = open_db(app)?;
    if let Some(existing) = get_runtime_kv(&conn, EXTERNAL_AGENT_SECRET_KV_KEY)? {
        let normalized = existing.trim().to_string();
        if !normalized.is_empty() {
            return Ok(normalized);
        }
    }
    let generated = generate_local_gateway_secret("external-agent");
    set_runtime_kv(
        &conn,
        EXTERNAL_AGENT_SECRET_KV_KEY,
        &generated,
        &now_rfc3339(),
    )?;
    Ok(generated)
}

impl ExternalAgentGatewayConfig {
    fn from_app(app: &AppHandle) -> Self {
        let bind_address = std::env::var("NIMI_EXTERNAL_AGENT_BIND")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "127.0.0.1:44777".to_string());
        let issuer = std::env::var("NIMI_EXTERNAL_AGENT_ISSUER")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "local-runtime".to_string());
        let jws_secret = std::env::var("NIMI_EXTERNAL_AGENT_JWS_SECRET")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                read_or_create_gateway_secret(app)
                    .unwrap_or_else(|_| generate_local_gateway_secret("external-agent-fallback"))
            });
        Self {
            bind_address,
            issuer,
            jws_secret,
        }
    }
}

pub struct ExternalAgentGatewayInner {
    pub actions: HashMap<String, ExternalAgentActionDescriptor>,
    pub revoked_token_ids: HashSet<String>,
    pub completion_waiters:
        HashMap<String, oneshot::Sender<ExternalAgentExecutionCompletionPayload>>,
    pub execution_owners: HashMap<String, ExternalAgentExecutionOwner>,
    pub execution_events: HashMap<String, Vec<serde_json::Value>>,
    pub pending_executions: Vec<ExternalAgentExecutionPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentExecutionOwner {
    pub execution_id: String,
    pub action_id: String,
    pub principal_id: String,
    pub auth_token_id: String,
}

impl Default for ExternalAgentGatewayInner {
    fn default() -> Self {
        Self {
            actions: HashMap::new(),
            revoked_token_ids: HashSet::new(),
            completion_waiters: HashMap::new(),
            execution_owners: HashMap::new(),
            execution_events: HashMap::new(),
            pending_executions: Vec::new(),
        }
    }
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn event_ts(value: &serde_json::Value) -> i64 {
    value
        .as_object()
        .and_then(|item| item.get("ts"))
        .and_then(|item| item.as_i64())
        .unwrap_or(0)
}

fn with_event_ts(value: serde_json::Value, now_ts: i64) -> serde_json::Value {
    if let Some(root) = value.as_object() {
        let mut map = root.clone();
        if map.get("ts").and_then(|item| item.as_i64()).is_none() {
            map.insert("ts".to_string(), serde_json::Value::Number(now_ts.into()));
        }
        return serde_json::Value::Object(map);
    }
    serde_json::json!({
        "type": "unknown",
        "value": value,
        "ts": now_ts,
    })
}

impl ExternalAgentGatewayInner {
    fn prune_execution_events(&mut self, now_ts: i64) {
        let min_ts = now_ts - EXTERNAL_AGENT_EVENT_TTL_SECS;
        self.execution_events.retain(|execution_id, events| {
            if events.is_empty() {
                self.execution_owners.remove(execution_id.as_str());
                return false;
            }
            let latest = events.iter().map(event_ts).max().unwrap_or(0);
            if latest < min_ts {
                self.execution_owners.remove(execution_id.as_str());
                return false;
            }
            true
        });

        for events in self.execution_events.values_mut() {
            if events.len() > EXTERNAL_AGENT_MAX_EVENTS_PER_EXECUTION {
                let keep_from = events.len() - EXTERNAL_AGENT_MAX_EVENTS_PER_EXECUTION;
                events.drain(0..keep_from);
            }
        }

        if self.execution_events.len() > EXTERNAL_AGENT_MAX_EXECUTION_STREAMS {
            let mut order = self
                .execution_events
                .iter()
                .map(|(execution_id, events)| {
                    (
                        execution_id.clone(),
                        events.iter().map(event_ts).max().unwrap_or(0),
                    )
                })
                .collect::<Vec<_>>();
            order.sort_by(|left, right| left.1.cmp(&right.1));
            let remove_count = self.execution_events.len() - EXTERNAL_AGENT_MAX_EXECUTION_STREAMS;
            for (execution_id, _) in order.into_iter().take(remove_count) {
                self.execution_events.remove(execution_id.as_str());
                self.execution_owners.remove(execution_id.as_str());
            }
        }
    }

    fn push_execution_event(&mut self, execution_id: &str, event: serde_json::Value) {
        let now_ts = now_unix_secs();
        self.prune_execution_events(now_ts);
        let normalized = with_event_ts(event, now_ts);
        let events = self
            .execution_events
            .entry(execution_id.to_string())
            .or_default();
        events.push(normalized);
        if events.len() > EXTERNAL_AGENT_MAX_EVENTS_PER_EXECUTION {
            let keep_from = events.len() - EXTERNAL_AGENT_MAX_EVENTS_PER_EXECUTION;
            events.drain(0..keep_from);
        }
    }
}

#[derive(Clone)]
pub struct ExternalAgentGatewayState {
    pub app: AppHandle,
    pub config: ExternalAgentGatewayConfig,
    pub inner: Arc<Mutex<ExternalAgentGatewayInner>>,
}

impl ExternalAgentGatewayState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            config: ExternalAgentGatewayConfig::from_app(&app),
            app,
            inner: Arc::new(Mutex::new(ExternalAgentGatewayInner::default())),
        }
    }
}

pub fn start_external_agent_gateway(state: ExternalAgentGatewayState) {
    let bind_address = state.config.bind_address.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = server::run_loopback_server(state.clone()).await {
            eprintln!(
                "EXTERNAL_AGENT_GATEWAY_START_FAILED: bind={}, error={}",
                bind_address, error
            );
        } else {
            eprintln!("EXTERNAL_AGENT_GATEWAY_STOPPED: bind={}", bind_address);
        }
    });
}

#[tauri::command]
pub async fn external_agent_issue_token(
    state: tauri::State<'_, ExternalAgentGatewayState>,
    payload: ExternalAgentIssueTokenPayload,
) -> Result<ExternalAgentIssueTokenResult, String> {
    token_issuer::issue_token(&state, payload).await
}

#[tauri::command]
pub async fn external_agent_revoke_token(
    state: tauri::State<'_, ExternalAgentGatewayState>,
    payload: ExternalAgentRevokeTokenPayload,
) -> Result<(), String> {
    token_issuer::revoke_token(&state, payload).await
}

#[tauri::command]
pub async fn external_agent_sync_action_descriptors(
    state: tauri::State<'_, ExternalAgentGatewayState>,
    payload: ExternalAgentSyncActionPayload,
) -> Result<Vec<ExternalAgentActionDescriptor>, String> {
    let mut guard = state.inner.lock().await;
    guard.actions.clear();
    for descriptor in payload.descriptors {
        guard
            .actions
            .insert(descriptor.action_id.clone(), descriptor);
    }
    let mut values = guard.actions.values().cloned().collect::<Vec<_>>();
    values.sort_by(|left, right| left.action_id.cmp(&right.action_id));
    Ok(values)
}

#[tauri::command]
pub async fn external_agent_complete_execution(
    state: tauri::State<'_, ExternalAgentGatewayState>,
    payload: ExternalAgentExecutionCompletionPayload,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let execution_id = payload.execution_id.clone();
    let reason_code = payload.reason_code.clone();
    let action_hint = payload.action_hint.clone();
    let trace_id = payload.trace_id.clone();
    let audit_id = payload.audit_id.clone();
    let execution_mode = payload.execution_mode.clone();
    let ok = payload.ok;
    guard.push_execution_event(
        execution_id.as_str(),
        serde_json::json!({
            "type": "completed",
            "executionId": execution_id.as_str(),
            "ok": ok,
            "reasonCode": reason_code.as_str(),
            "actionHint": action_hint.as_str(),
            "traceId": trace_id.as_str(),
            "auditId": audit_id.as_deref(),
            "executionMode": execution_mode.as_str(),
        }),
    );
    if !ok {
        guard.push_execution_event(
            execution_id.as_str(),
            serde_json::json!({
                "type": "error",
                "executionId": execution_id.as_str(),
                "reasonCode": reason_code.as_str(),
                "actionHint": action_hint.as_str(),
            }),
        );
    }
    if let Some(waiter) = guard.completion_waiters.remove(execution_id.as_str()) {
        let _ = waiter.send(payload);
        return Ok(());
    }
    Err("EXTERNAL_AGENT_EXECUTION_NOT_PENDING".to_string())
}

#[tauri::command]
pub async fn external_agent_gateway_status(
    state: tauri::State<'_, ExternalAgentGatewayState>,
) -> Result<ExternalAgentGatewayStatus, String> {
    let guard = state.inner.lock().await;
    Ok(ExternalAgentGatewayStatus {
        enabled: true,
        bind_address: state.config.bind_address.clone(),
        issuer: state.config.issuer.clone(),
        action_count: guard.actions.len(),
    })
}

fn to_external_agent_token_record(
    payload: ExternalAgentTokenRecordPayload,
) -> ExternalAgentTokenRecord {
    ExternalAgentTokenRecord {
        token_id: payload.token_id,
        principal_id: payload.principal_id,
        mode: payload.mode,
        subject_account_id: payload.subject_account_id,
        actions: payload.actions,
        scopes: payload
            .scopes
            .into_iter()
            .map(|scope| ExternalAgentActionScope {
                action_id: scope.action_id,
                ops: scope.ops,
            })
            .collect::<Vec<_>>(),
        issued_at: payload.issued_at,
        expires_at: payload.expires_at,
        revoked_at: payload.revoked_at,
        issuer: payload.issuer,
    }
}

#[tauri::command]
pub async fn external_agent_list_tokens(
    state: tauri::State<'_, ExternalAgentGatewayState>,
) -> Result<Vec<ExternalAgentTokenRecord>, String> {
    let conn = open_db(&state.app)?;
    let rows = list_external_agent_token_records(&conn, 500)?;
    Ok(rows
        .into_iter()
        .map(to_external_agent_token_record)
        .collect::<Vec<_>>())
}

#[tauri::command]
pub async fn external_agent_verify_execution_context(
    state: tauri::State<'_, ExternalAgentGatewayState>,
    payload: ExternalAgentVerifyExecutionContextPayload,
) -> Result<bool, String> {
    let execution_id = payload.bridge_execution_id.unwrap_or_default();
    if execution_id.trim().is_empty() {
        return Ok(false);
    }

    let conn = open_db(&state.app)?;
    let token = get_external_agent_token_record(&conn, payload.auth_token_id.as_str())?;
    let Some(token) = token else {
        return Ok(false);
    };
    if token.revoked_at.is_some() {
        return Ok(false);
    }
    if token.principal_id != payload.principal_id
        || token.subject_account_id != payload.subject_account_id
        || token.mode != payload.mode
        || token.issuer != payload.issuer
    {
        return Ok(false);
    }
    let expires_at = chrono::DateTime::parse_from_rfc3339(token.expires_at.as_str())
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_EXPIRES_AT_INVALID: {error}"))?
        .with_timezone(&chrono::Utc);
    if expires_at <= chrono::Utc::now() {
        return Ok(false);
    }

    let guard = state.inner.lock().await;
    if guard
        .revoked_token_ids
        .contains(payload.auth_token_id.as_str())
    {
        return Ok(false);
    }
    if !guard.completion_waiters.contains_key(execution_id.as_str()) {
        return Ok(false);
    }
    let Some(owner) = guard.execution_owners.get(execution_id.as_str()) else {
        return Ok(false);
    };
    if owner.principal_id != payload.principal_id || owner.auth_token_id != payload.auth_token_id {
        return Ok(false);
    }
    Ok(true)
}
