use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream;
use serde::Deserialize;
use tauri::Emitter;
use tokio::sync::oneshot;

use crate::runtime_mod::store::{open_db, query_runtime_audit, RuntimeAuditFilter};

use super::auth::{bearer_token, verify_external_agent_token};
use super::{
    secure_random_hex, ExternalAgentExecutionCompletionPayload, ExternalAgentExecutionOwner,
    ExternalAgentExecutionPayload, ExternalAgentGatewayState, EXTERNAL_AGENT_ACTION_REQUEST_EVENT,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteRequestBody {
    input: Option<serde_json::Value>,
    idempotency_key: Option<String>,
    verify_ticket: Option<String>,
    trace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditQuery {
    limit: Option<usize>,
    action_id: Option<String>,
    principal_id: Option<String>,
    reason_code: Option<String>,
    trace_id: Option<String>,
}

fn error_response(code: StatusCode, reason: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        code,
        Json(serde_json::json!({
            "ok": false,
            "reasonCode": reason,
        })),
    )
}

fn claims_allows_action_for_phase(
    claims: &super::ExternalAgentClaims,
    action_id: &str,
    phase: &str,
) -> bool {
    let normalized_action_id = action_id.trim();
    if normalized_action_id.is_empty() {
        return false;
    }
    let action_allowed = claims
        .actions
        .iter()
        .any(|item| item.trim() == "*" || item.trim() == normalized_action_id);
    if !action_allowed {
        return false;
    }

    claims.scopes.iter().any(|scope| {
        let scope_action = scope.action_id.trim();
        if !(scope_action == "*" || scope_action == normalized_action_id) {
            return false;
        }
        scope
            .ops
            .iter()
            .any(|op| op.trim() == "*" || op.trim() == phase)
    })
}

fn normalize_trace_id(input: Option<String>, fallback: &str) -> String {
    let normalized = input.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

async fn append_execution_event(
    state: &ExternalAgentGatewayState,
    execution_id: &str,
    event: serde_json::Value,
) {
    let mut guard = state.inner.lock().await;
    guard.push_execution_event(execution_id, event);
}

async fn list_actions(
    State(state): State<ExternalAgentGatewayState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token = match bearer_token(&headers) {
        Ok(value) => value,
        Err(reason) => {
            return error_response(StatusCode::UNAUTHORIZED, reason.as_str()).into_response();
        }
    };
    let claims = match verify_external_agent_token(&state, token.as_str()).await {
        Ok(value) => value,
        Err(reason) => {
            return error_response(StatusCode::UNAUTHORIZED, reason.as_str()).into_response();
        }
    };

    let guard = state.inner.lock().await;
    let mut actions = guard
        .actions
        .values()
        .filter(|item| claims_allows_action_for_phase(&claims, item.action_id.as_str(), "discover"))
        .cloned()
        .collect::<Vec<_>>();
    actions.sort_by(|left, right| left.action_id.cmp(&right.action_id));
    Json(actions).into_response()
}

async fn dispatch_action(
    state: &ExternalAgentGatewayState,
    headers: &HeaderMap,
    action_id: &str,
    body: ExecuteRequestBody,
    phase: &'static str,
) -> Result<ExternalAgentExecutionCompletionPayload, (StatusCode, Json<serde_json::Value>)> {
    let token = bearer_token(headers)
        .map_err(|reason| error_response(StatusCode::UNAUTHORIZED, reason.as_str()))?;
    let claims = verify_external_agent_token(state, token.as_str())
        .await
        .map_err(|reason| error_response(StatusCode::UNAUTHORIZED, reason.as_str()))?;

    if !claims_allows_action_for_phase(&claims, action_id, phase) {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "EXTERNAL_AGENT_ACTION_SCOPE_DENIED",
        ));
    }

    let action = {
        let guard = state.inner.lock().await;
        guard.actions.get(action_id).cloned()
    }
    .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "EXTERNAL_AGENT_ACTION_NOT_FOUND"))?;

    let execution_id = format!(
        "extexec:{}:{}:{}",
        action_id,
        chrono::Utc::now().timestamp_millis(),
        rand_suffix()
            .map_err(|reason| error_response(StatusCode::INTERNAL_SERVER_ERROR, reason.as_str()))?
    );
    let trace_id = normalize_trace_id(body.trace_id, execution_id.as_str());
    let principal_id = claims.principal_id.clone();
    let subject_account_id = claims.subject_account_id.clone();
    let auth_token_id = claims.jti.clone();
    let mode = claims.mode.clone();
    let user_account_id = if mode == "delegated" {
        Some(subject_account_id.clone())
    } else {
        None
    };
    let external_account_id = if mode == "autonomous" {
        Some(subject_account_id.clone())
    } else {
        None
    };
    let payload = ExternalAgentExecutionPayload {
        execution_id: execution_id.clone(),
        action_id: action.action_id.clone(),
        phase: phase.to_string(),
        input: body
            .input
            .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new())),
        context: serde_json::json!({
            "principalId": principal_id,
            "principalType": "external-agent",
            "mode": mode,
            "subjectAccountId": subject_account_id,
            "issuer": claims.iss,
            "authTokenId": auth_token_id,
            "traceId": trace_id,
            "userAccountId": user_account_id,
            "externalAccountId": external_account_id,
            "delegationChain": [],
        }),
        idempotency_key: body.idempotency_key,
        verify_ticket: body.verify_ticket,
    };

    let (tx, rx) = oneshot::channel::<ExternalAgentExecutionCompletionPayload>();
    {
        let mut guard = state.inner.lock().await;
        guard.completion_waiters.insert(execution_id.clone(), tx);
        guard.execution_owners.insert(
            execution_id.clone(),
            ExternalAgentExecutionOwner {
                execution_id: execution_id.clone(),
                action_id: action.action_id.clone(),
                principal_id: principal_id.clone(),
                auth_token_id: auth_token_id.clone(),
            },
        );
        guard.pending_executions.push(payload.clone());
        guard.push_execution_event(
            execution_id.as_str(),
            serde_json::json!({
                "type": "accepted",
                "executionId": execution_id,
                "actionId": action.action_id,
                "phase": phase,
                "principalId": principal_id,
            }),
        );
        guard.push_execution_event(
            execution_id.as_str(),
            serde_json::json!({
                "type": "preflight",
                "executionId": execution_id,
                "actionId": action.action_id,
                "executionMode": action.execution_mode,
                "riskLevel": action.risk_level,
            }),
        );
    }

    if state
        .app
        .emit(EXTERNAL_AGENT_ACTION_REQUEST_EVENT, payload)
        .is_err()
    {
        {
            let mut guard = state.inner.lock().await;
            guard.completion_waiters.remove(execution_id.as_str());
        }
        append_execution_event(
            state,
            execution_id.as_str(),
            serde_json::json!({
                "type": "error",
                "executionId": execution_id,
                "reasonCode": "EXTERNAL_AGENT_DISPATCH_FAILED",
            }),
        )
        .await;
        return Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "EXTERNAL_AGENT_DISPATCH_FAILED",
        ));
    }

    let completed = match tokio::time::timeout(Duration::from_secs(45), rx).await {
        Ok(waited) => match waited {
            Ok(value) => value,
            Err(_) => {
                {
                    let mut guard = state.inner.lock().await;
                    guard.completion_waiters.remove(execution_id.as_str());
                }
                append_execution_event(
                    state,
                    execution_id.as_str(),
                    serde_json::json!({
                        "type": "error",
                        "executionId": execution_id,
                        "reasonCode": "EXTERNAL_AGENT_EXECUTION_BRIDGE_BROKEN",
                    }),
                )
                .await;
                return Err(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "EXTERNAL_AGENT_EXECUTION_BRIDGE_BROKEN",
                ));
            }
        },
        Err(_) => {
            {
                let mut guard = state.inner.lock().await;
                guard.completion_waiters.remove(execution_id.as_str());
            }
            append_execution_event(
                state,
                execution_id.as_str(),
                serde_json::json!({
                    "type": "error",
                    "executionId": execution_id,
                    "reasonCode": "EXTERNAL_AGENT_EXECUTION_TIMEOUT",
                }),
            )
            .await;
            return Err(error_response(
                StatusCode::GATEWAY_TIMEOUT,
                "EXTERNAL_AGENT_EXECUTION_TIMEOUT",
            ));
        }
    };

    Ok(completed)
}

fn rand_suffix() -> Result<String, String> {
    secure_random_hex(8)
}

async fn dry_run_action(
    State(state): State<ExternalAgentGatewayState>,
    Path(action_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ExecuteRequestBody>,
) -> impl IntoResponse {
    match dispatch_action(&state, &headers, action_id.as_str(), body, "dry-run").await {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn verify_action(
    State(state): State<ExternalAgentGatewayState>,
    Path(action_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ExecuteRequestBody>,
) -> impl IntoResponse {
    match dispatch_action(&state, &headers, action_id.as_str(), body, "verify").await {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn commit_action(
    State(state): State<ExternalAgentGatewayState>,
    Path(action_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ExecuteRequestBody>,
) -> impl IntoResponse {
    match dispatch_action(&state, &headers, action_id.as_str(), body, "commit").await {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn execution_events(
    State(state): State<ExternalAgentGatewayState>,
    Path(execution_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token = match bearer_token(&headers) {
        Ok(value) => value,
        Err(reason) => {
            return error_response(StatusCode::UNAUTHORIZED, reason.as_str()).into_response();
        }
    };
    let claims = match verify_external_agent_token(&state, token.as_str()).await {
        Ok(value) => value,
        Err(reason) => {
            return error_response(StatusCode::UNAUTHORIZED, reason.as_str()).into_response();
        }
    };

    let lookup = {
        let mut guard = state.inner.lock().await;
        guard.prune_execution_events(super::now_unix_secs());
        let owner = guard.execution_owners.get(execution_id.as_str()).cloned();
        let events = guard
            .execution_events
            .get(execution_id.as_str())
            .cloned()
            .unwrap_or_default();
        (owner, events)
    };
    let events = match lookup {
        (None, _) => {
            return error_response(StatusCode::NOT_FOUND, "EXTERNAL_AGENT_EXECUTION_NOT_FOUND")
                .into_response();
        }
        (Some(owner), _) if owner.principal_id.trim() != claims.principal_id.trim() => {
            return error_response(StatusCode::FORBIDDEN, "EXTERNAL_AGENT_EXECUTION_FORBIDDEN")
                .into_response();
        }
        (Some(owner), _)
            if !claims_allows_action_for_phase(&claims, owner.action_id.as_str(), "events")
                && !claims_allows_action_for_phase(&claims, owner.action_id.as_str(), "audit") =>
        {
            return error_response(StatusCode::FORBIDDEN, "EXTERNAL_AGENT_ACTION_SCOPE_DENIED")
                .into_response();
        }
        (Some(_), events) => events,
    };

    let stream = stream::iter(events.into_iter().map(|item| {
        let event = Event::default()
            .event("execution")
            .json_data(item)
            .unwrap_or_else(|_| {
                Event::default()
                    .event("execution")
                    .data("{\"type\":\"invalid\"}")
            });
        Ok::<Event, Infallible>(event)
    }));
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(5)))
        .into_response()
}

async fn list_audits(
    State(state): State<ExternalAgentGatewayState>,
    headers: HeaderMap,
    Query(query): Query<AuditQuery>,
) -> impl IntoResponse {
    let token = match bearer_token(&headers) {
        Ok(value) => value,
        Err(reason) => {
            return error_response(StatusCode::UNAUTHORIZED, reason.as_str()).into_response();
        }
    };
    let claims = match verify_external_agent_token(&state, token.as_str()).await {
        Ok(value) => value,
        Err(reason) => {
            return error_response(StatusCode::UNAUTHORIZED, reason.as_str()).into_response();
        }
    };
    if let Some(principal_id) = &query.principal_id {
        if principal_id.trim() != claims.principal_id.trim() {
            return error_response(
                StatusCode::FORBIDDEN,
                "EXTERNAL_AGENT_AUDIT_PRINCIPAL_FORBIDDEN",
            )
            .into_response();
        }
    }

    let conn = match open_db(&state.app) {
        Ok(value) => value,
        Err(error) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("EXTERNAL_AGENT_AUDIT_DB_FAILED:{error}").as_str(),
            )
            .into_response();
        }
    };
    let mut rows = query_runtime_audit(
        &conn,
        Some(RuntimeAuditFilter {
            mod_id: None,
            stage: Some("audit".to_string()),
            event_type: Some("hook.action.commit".to_string()),
            from: None,
            to: None,
            limit: Some(query.limit.unwrap_or(100).clamp(1, 1000)),
        }),
    );
    match &mut rows {
        Ok(value) => {
            let filtered = value
                .drain(..)
                .filter(|row| {
                    let payload = row.payload.as_ref().cloned().unwrap_or_default();
                    let payload_obj = payload.as_object().cloned().unwrap_or_default();
                    let payload_action_id = payload_obj
                        .get("actionId")
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let payload_principal_id = payload_obj
                        .get("principalId")
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let payload_trace_id = payload_obj
                        .get("traceId")
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let reason_code = row
                        .reason_codes
                        .as_ref()
                        .and_then(|items| items.first())
                        .cloned()
                        .unwrap_or_default();
                    if payload_principal_id.trim() != claims.principal_id.trim() {
                        return false;
                    }
                    if !claims_allows_action_for_phase(&claims, payload_action_id.as_str(), "audit")
                    {
                        return false;
                    }
                    if let Some(action_id) = &query.action_id {
                        if action_id.trim() != payload_action_id.trim() {
                            return false;
                        }
                    }
                    if let Some(principal_id) = &query.principal_id {
                        if principal_id.trim() != payload_principal_id.trim() {
                            return false;
                        }
                    }
                    if let Some(trace_id) = &query.trace_id {
                        if trace_id.trim() != payload_trace_id.trim() {
                            return false;
                        }
                    }
                    if let Some(reason_code_query) = &query.reason_code {
                        if reason_code_query.trim() != reason_code.trim() {
                            return false;
                        }
                    }
                    true
                })
                .collect::<Vec<_>>();
            Json(filtered).into_response()
        }
        Err(error) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("EXTERNAL_AGENT_AUDIT_QUERY_FAILED:{error}").as_str(),
        )
        .into_response(),
    }
}

fn is_loopback_bind_address(bind_address: &str) -> bool {
    let parsed = if bind_address.contains("://") {
        bind_address.to_string()
    } else {
        format!("http://{bind_address}")
    };
    if let Ok(url) = url::Url::parse(parsed.as_str()) {
        if let Some(host) = url.host_str() {
            return host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost");
        }
    }
    false
}

pub async fn run_loopback_server(state: ExternalAgentGatewayState) -> Result<(), String> {
    let bind_address = state.config.bind_address.clone();
    if !is_loopback_bind_address(bind_address.as_str()) {
        return Err(format!(
            "EXTERNAL_AGENT_BIND_ADDRESS_NOT_LOOPBACK: {}",
            bind_address
        ));
    }
    let listener = tokio::net::TcpListener::bind(bind_address.as_str())
        .await
        .map_err(|error| format!("EXTERNAL_AGENT_BIND_FAILED: {error}"))?;

    let router = Router::new()
        .route("/v1/external-agent/actions", get(list_actions))
        .route(
            "/v1/external-agent/actions/{action_id}/dry-run",
            post(dry_run_action),
        )
        .route(
            "/v1/external-agent/actions/{action_id}/verify",
            post(verify_action),
        )
        .route(
            "/v1/external-agent/actions/{action_id}/commit",
            post(commit_action),
        )
        .route(
            "/v1/external-agent/executions/{execution_id}/events",
            get(execution_events),
        )
        .route("/v1/external-agent/audits", get(list_audits))
        .with_state(state.clone());

    axum::serve(listener, router)
        .await
        .map_err(|error| format!("EXTERNAL_AGENT_SERVER_FAILED: {error}"))
}
