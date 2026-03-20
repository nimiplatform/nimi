use std::time::{SystemTime, UNIX_EPOCH};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};

use crate::runtime_mod::store::{
    get_external_agent_token_record, open_db, revoke_external_agent_token_record,
    upsert_external_agent_token_record, ExternalAgentTokenRecordPayload,
};

use super::{
    secure_random_hex, ExternalAgentActionScope, ExternalAgentClaims, ExternalAgentGatewayState,
    ExternalAgentIssueTokenPayload, ExternalAgentIssueTokenResult, ExternalAgentRevokeTokenPayload,
};

fn now_unix_secs() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize
}

fn build_token_id(
    _principal_id: &str,
    _subject_account_id: &str,
    _mode: &str,
) -> Result<String, String> {
    Ok(format!("ext-{}", secure_random_hex(16)?))
}

fn is_supported_scope_op(value: &str) -> bool {
    matches!(
        value.trim(),
        "*" | "discover" | "dry-run" | "verify" | "commit" | "audit" | "events"
    )
}

pub async fn issue_token(
    state: &ExternalAgentGatewayState,
    payload: ExternalAgentIssueTokenPayload,
) -> Result<ExternalAgentIssueTokenResult, String> {
    let principal_id = payload.principal_id.trim();
    if principal_id.is_empty() {
        return Err("EXTERNAL_AGENT_PRINCIPAL_ID_REQUIRED".to_string());
    }
    let subject_account_id = payload.subject_account_id.trim();
    if subject_account_id.is_empty() {
        return Err("EXTERNAL_AGENT_SUBJECT_ACCOUNT_ID_REQUIRED".to_string());
    }
    let mode = if payload.mode.trim() == "autonomous" {
        "autonomous"
    } else {
        "delegated"
    };
    let mut scopes = payload
        .scopes
        .unwrap_or_default()
        .into_iter()
        .map(|scope| ExternalAgentActionScope {
            action_id: scope.action_id.trim().to_string(),
            ops: scope
                .ops
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| is_supported_scope_op(item.as_str()))
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>(),
        })
        .filter(|scope| !scope.action_id.is_empty())
        .collect::<Vec<_>>();

    if scopes.is_empty() {
        let actions = payload
            .actions
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        scopes = actions
            .into_iter()
            .map(|action_id| ExternalAgentActionScope {
                action_id,
                ops: vec![
                    "discover".to_string(),
                    "dry-run".to_string(),
                    "verify".to_string(),
                    "commit".to_string(),
                    "audit".to_string(),
                    "events".to_string(),
                ],
            })
            .collect::<Vec<_>>();
    }
    if scopes.is_empty() {
        return Err("EXTERNAL_AGENT_ACTION_SCOPE_REQUIRED".to_string());
    }
    if scopes.iter().any(|scope| scope.ops.is_empty()) {
        return Err("EXTERNAL_AGENT_SCOPE_OPS_REQUIRED".to_string());
    }

    let actions = scopes
        .iter()
        .map(|scope| scope.action_id.clone())
        .collect::<Vec<_>>();

    {
        let guard = state.inner.lock().await;
        for scope in &scopes {
            if scope.action_id != "*" && !guard.actions.contains_key(scope.action_id.as_str()) {
                return Err(format!(
                    "EXTERNAL_AGENT_ACTION_SCOPE_UNKNOWN:{}",
                    scope.action_id
                ));
            }
        }
    }

    let iat = now_unix_secs();
    let ttl = payload.ttl_seconds.unwrap_or(3600).clamp(60, 86_400) as usize;
    let exp = iat + ttl;
    let token_id = build_token_id(principal_id, subject_account_id, mode)?;
    let claims = ExternalAgentClaims {
        sub: subject_account_id.to_string(),
        principal_id: principal_id.to_string(),
        principal_type: "external-agent".to_string(),
        mode: mode.to_string(),
        subject_account_id: subject_account_id.to_string(),
        actions: actions.clone(),
        scopes: scopes.clone(),
        iat,
        exp,
        jti: token_id.clone(),
        iss: state.config.issuer.clone(),
    };

    let header = Header::new(Algorithm::HS256);
    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_secret(state.config.jws_secret.as_bytes()),
    )
    .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ISSUE_FAILED: {error}"))?;

    let issued_at = chrono::DateTime::<chrono::Utc>::from_timestamp(iat as i64, 0)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    let expires_at = chrono::DateTime::<chrono::Utc>::from_timestamp(exp as i64, 0)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    let conn = open_db(&state.app)?;
    upsert_external_agent_token_record(
        &conn,
        &ExternalAgentTokenRecordPayload {
            token_id: token_id.clone(),
            principal_id: principal_id.to_string(),
            mode: mode.to_string(),
            subject_account_id: subject_account_id.to_string(),
            actions: actions.clone(),
            scopes: scopes
                .iter()
                .map(
                    |scope| crate::runtime_mod::store::RuntimeExternalAgentActionScope {
                        action_id: scope.action_id.clone(),
                        ops: scope.ops.clone(),
                    },
                )
                .collect::<Vec<_>>(),
            issuer: state.config.issuer.clone(),
            issued_at: issued_at.clone(),
            expires_at: expires_at.clone(),
            revoked_at: None,
        },
    )?;

    Ok(ExternalAgentIssueTokenResult {
        token,
        token_id: token_id.clone(),
        principal_id: principal_id.to_string(),
        mode: mode.to_string(),
        subject_account_id: subject_account_id.to_string(),
        actions,
        scopes,
        issued_at,
        expires_at,
        revoked_at: None,
        issuer: state.config.issuer.clone(),
    })
}

pub async fn revoke_token(
    state: &ExternalAgentGatewayState,
    payload: ExternalAgentRevokeTokenPayload,
) -> Result<(), String> {
    let token_id = payload.token_id.trim();
    if token_id.is_empty() {
        return Err("EXTERNAL_AGENT_TOKEN_ID_REQUIRED".to_string());
    }
    let conn = open_db(&state.app)?;
    if get_external_agent_token_record(&conn, token_id)?.is_none() {
        return Err("EXTERNAL_AGENT_TOKEN_NOT_FOUND".to_string());
    }
    let revoked_at = chrono::Utc::now().to_rfc3339();
    let _ = revoke_external_agent_token_record(&conn, token_id, &revoked_at)?;
    let mut guard = state.inner.lock().await;
    guard.revoked_token_ids.insert(token_id.to_string());
    Ok(())
}
