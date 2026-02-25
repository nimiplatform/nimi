use axum::http::{header, HeaderMap};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use std::collections::BTreeSet;

use crate::runtime_mod::store::{get_external_agent_token_record, open_db};

use super::{ExternalAgentClaims, ExternalAgentGatewayState};

pub fn bearer_token(headers: &HeaderMap) -> Result<String, String> {
    let raw = headers
        .get(header::AUTHORIZATION)
        .ok_or_else(|| "AUTHORIZATION_HEADER_MISSING".to_string())?
        .to_str()
        .map_err(|_| "AUTHORIZATION_HEADER_INVALID".to_string())?;
    let normalized = raw.trim();
    let prefix = "Bearer ";
    if !normalized.starts_with(prefix) {
        return Err("AUTHORIZATION_BEARER_REQUIRED".to_string());
    }
    let token = normalized[prefix.len()..].trim().to_string();
    if token.is_empty() {
        return Err("AUTHORIZATION_TOKEN_EMPTY".to_string());
    }
    Ok(token)
}

pub async fn verify_external_agent_token(
    state: &ExternalAgentGatewayState,
    token: &str,
) -> Result<ExternalAgentClaims, String> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let decoded = decode::<ExternalAgentClaims>(
        token,
        &DecodingKey::from_secret(state.config.jws_secret.as_bytes()),
        &validation,
    )
    .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_INVALID: {error}"))?;
    let claims = decoded.claims;
    if claims.principal_type != "external-agent" {
        return Err("EXTERNAL_AGENT_PRINCIPAL_TYPE_INVALID".to_string());
    }
    if claims.iss != state.config.issuer {
        return Err("EXTERNAL_AGENT_ISSUER_MISMATCH".to_string());
    }
    let conn = open_db(&state.app)?;
    let persisted = get_external_agent_token_record(&conn, claims.jti.as_str())?
        .ok_or_else(|| "EXTERNAL_AGENT_TOKEN_UNKNOWN".to_string())?;
    if persisted.revoked_at.is_some() {
        return Err("EXTERNAL_AGENT_TOKEN_REVOKED".to_string());
    }
    if persisted.subject_account_id != claims.subject_account_id
        || persisted.principal_id != claims.principal_id
    {
        return Err("EXTERNAL_AGENT_TOKEN_SUBJECT_MISMATCH".to_string());
    }
    if persisted.mode != claims.mode {
        return Err("EXTERNAL_AGENT_TOKEN_MODE_MISMATCH".to_string());
    }
    if persisted.issuer != claims.iss {
        return Err("EXTERNAL_AGENT_TOKEN_ISSUER_MISMATCH".to_string());
    }
    let persisted_actions = persisted
        .actions
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<BTreeSet<_>>();
    let claim_actions = claims
        .actions
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<BTreeSet<_>>();
    if persisted_actions != claim_actions {
        return Err("EXTERNAL_AGENT_TOKEN_SCOPE_MISMATCH".to_string());
    }
    let persisted_scope_ops = persisted
        .scopes
        .iter()
        .flat_map(|scope| {
            scope
                .ops
                .iter()
                .map(|op| format!("{}#{}", scope.action_id.trim(), op.trim()))
                .collect::<Vec<_>>()
        })
        .collect::<BTreeSet<_>>();
    let claim_scope_ops = claims
        .scopes
        .iter()
        .flat_map(|scope| {
            scope
                .ops
                .iter()
                .map(|op| format!("{}#{}", scope.action_id.trim(), op.trim()))
                .collect::<Vec<_>>()
        })
        .collect::<BTreeSet<_>>();
    if persisted_scope_ops != claim_scope_ops {
        return Err("EXTERNAL_AGENT_TOKEN_SCOPE_MISMATCH".to_string());
    }
    let expires_at = chrono::DateTime::parse_from_rfc3339(persisted.expires_at.as_str())
        .map_err(|_| "EXTERNAL_AGENT_TOKEN_EXPIRES_AT_INVALID".to_string())?
        .with_timezone(&chrono::Utc);
    if expires_at <= chrono::Utc::now() {
        return Err("EXTERNAL_AGENT_TOKEN_EXPIRED".to_string());
    }
    let guard = state.inner.lock().await;
    if guard.revoked_token_ids.contains(claims.jti.as_str()) {
        return Err("EXTERNAL_AGENT_TOKEN_REVOKED".to_string());
    }
    Ok(claims)
}
