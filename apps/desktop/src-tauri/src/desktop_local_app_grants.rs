use nimi_shell_tauri::capabilities::runtime::{
    self as runtime_bridge, LocalAppGrantControlDecisionRequest, LocalAppGrantControlState,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, RwLock};

pub(crate) const APPROVAL_EVENT: &str = "local-app-grant://approval-requested";
const POLL_INTERVAL: Duration = Duration::from_millis(750);

#[derive(Clone)]
pub(crate) struct DesktopLocalAppGrantRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    app: AppHandle,
    pending: RwLock<HashMap<String, PendingGrant>>,
    grants: RwLock<HashMap<String, GrantedGrant>>,
    shutdown: watch::Sender<bool>,
}

struct PendingGrant {
    request_id: [u8; 32],
    presence_challenge_id: [u8; 32],
    pending_grant_id: [u8; 32],
    projection: LocalAppGrantApprovalProjection,
}

struct GrantedGrant {
    grant_id: [u8; 32],
    projection: LocalAppGrantManagementProjection,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAppGrantApprovalProjection {
    selector: String,
    operation_id: String,
    resource_ref: String,
    state: String,
    reason_code: String,
    retryable: bool,
    expires_at_unix_ms: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAppGrantManagementProjection {
    selector: String,
    operation_id: String,
    resource_ref: String,
    state: String,
    reason_code: String,
    retryable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalAppGrantDecisionPayload {
    selector: String,
    approved: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalAppGrantRevokePayload {
    selector: String,
}

impl DesktopLocalAppGrantRuntime {
    pub(crate) fn start(app: AppHandle) -> Self {
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let runtime = Self {
            inner: Arc::new(RuntimeInner {
                app,
                pending: RwLock::new(HashMap::new()),
                grants: RwLock::new(HashMap::new()),
                shutdown,
            }),
        };
        let worker = runtime.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() { return; }
                    }
                    _ = tokio::time::sleep(POLL_INTERVAL) => {
                        let _ = worker.refresh_pending().await;
                    }
                }
            }
        });
        runtime
    }

    pub(crate) fn shutdown(&self) {
        self.inner.shutdown.send_replace(true);
    }

    async fn refresh_pending(&self) -> Result<(), String> {
        let Some(pending) = runtime_bridge::pending_local_app_grant()
            .await
            .map_err(|error| error.reason_code().as_str().to_string())?
        else {
            return Ok(());
        };
        let mut rows = self.inner.pending.write().await;
        if rows.values().any(|row| {
            row.request_id == pending.request_id && row.pending_grant_id == pending.pending_grant_id
        }) {
            return Ok(());
        }
        let selector = random_selector("grant-approval", 18)?;
        let projection = LocalAppGrantApprovalProjection {
            selector: selector.clone(),
            operation_id: pending.operation_id,
            resource_ref: pending.resource_ref,
            state: "pending".to_string(),
            reason_code: "local-app-presence-required".to_string(),
            retryable: false,
            expires_at_unix_ms: pending.expires_at_unix_ms,
        };
        rows.insert(
            selector,
            PendingGrant {
                request_id: pending.request_id,
                presence_challenge_id: pending.presence_challenge_id,
                pending_grant_id: pending.pending_grant_id,
                projection: projection.clone(),
            },
        );
        drop(rows);
        let _ = crate::menu_bar_shell::window::focus_main_window(&self.inner.app);
        self.inner
            .app
            .emit(APPROVAL_EVENT, projection)
            .map_err(|_| "local-app-grant-control-unavailable".to_string())
    }

    async fn list_pending(&self) -> Result<Vec<LocalAppGrantApprovalProjection>, String> {
        self.refresh_pending().await?;
        let now = chrono::Utc::now().timestamp_millis();
        let mut rows = self.inner.pending.write().await;
        rows.retain(|_, row| row.projection.expires_at_unix_ms > now);
        Ok(rows.values().map(|row| row.projection.clone()).collect())
    }

    async fn decide(
        &self,
        payload: LocalAppGrantDecisionPayload,
    ) -> Result<LocalAppGrantManagementProjection, String> {
        let selector = required_selector(&payload.selector, "grant-approval")?;
        let mut rows = self.inner.pending.write().await;
        let pending = rows
            .remove(selector)
            .ok_or_else(|| "local-app-grant-request-not-found".to_string())?;
        drop(rows);
        let result = runtime_bridge::decide_local_app_grant(LocalAppGrantControlDecisionRequest {
            request_id: pending.request_id,
            presence_challenge_id: pending.presence_challenge_id,
            approved: payload.approved,
        })
        .await
        .map_err(|error| error.reason_code().as_str().to_string());
        let result = match result {
            Ok(value) => value,
            Err(error) => {
                self.inner
                    .pending
                    .write()
                    .await
                    .insert(payload.selector, pending);
                return Err(error);
            }
        };
        if payload.approved && result.state != LocalAppGrantControlState::Granted {
            return Err("local-app-grant-control-unavailable".to_string());
        }
        if !payload.approved && result.state != LocalAppGrantControlState::Denied {
            return Err("local-app-grant-control-unavailable".to_string());
        }
        let control_selector = random_selector("grant-control", 18)?;
        let projection = LocalAppGrantManagementProjection {
            selector: control_selector.clone(),
            operation_id: result.operation_id,
            resource_ref: result.resource_ref,
            state: if payload.approved {
                "granted"
            } else {
                "denied"
            }
            .to_string(),
            reason_code: if payload.approved {
                "action-executed"
            } else {
                "local-app-grant-required"
            }
            .to_string(),
            retryable: false,
        };
        if payload.approved {
            self.inner.grants.write().await.insert(
                control_selector,
                GrantedGrant {
                    grant_id: result.grant_id,
                    projection: projection.clone(),
                },
            );
        }
        Ok(projection)
    }

    async fn list_grants(&self) -> Vec<LocalAppGrantManagementProjection> {
        self.inner
            .grants
            .read()
            .await
            .values()
            .map(|row| row.projection.clone())
            .collect()
    }

    async fn revoke(
        &self,
        payload: LocalAppGrantRevokePayload,
    ) -> Result<LocalAppGrantManagementProjection, String> {
        let selector = required_selector(&payload.selector, "grant-control")?;
        let grant_id = self
            .inner
            .grants
            .read()
            .await
            .get(selector)
            .map(|row| row.grant_id)
            .ok_or_else(|| "local-app-grant-not-found".to_string())?;
        let result = runtime_bridge::revoke_local_app_grant(grant_id)
            .await
            .map_err(|error| error.reason_code().as_str().to_string())?;
        if result.state != LocalAppGrantControlState::Revoked || result.grant_id != grant_id {
            return Err("local-app-grant-control-unavailable".to_string());
        }
        let mut rows = self.inner.grants.write().await;
        let mut projection = rows
            .remove(selector)
            .ok_or_else(|| "local-app-grant-not-found".to_string())?
            .projection;
        projection.state = "revoked".to_string();
        projection.reason_code = "local-app-grant-revoked".to_string();
        Ok(projection)
    }
}

#[tauri::command]
pub(crate) async fn local_app_grant_pending_list(
    runtime: tauri::State<'_, DesktopLocalAppGrantRuntime>,
) -> Result<Vec<LocalAppGrantApprovalProjection>, String> {
    runtime.list_pending().await
}

#[tauri::command]
pub(crate) async fn local_app_grant_decide(
    runtime: tauri::State<'_, DesktopLocalAppGrantRuntime>,
    payload: LocalAppGrantDecisionPayload,
) -> Result<LocalAppGrantManagementProjection, String> {
    runtime.decide(payload).await
}

#[tauri::command]
pub(crate) async fn local_app_grant_list(
    runtime: tauri::State<'_, DesktopLocalAppGrantRuntime>,
) -> Result<Vec<LocalAppGrantManagementProjection>, String> {
    Ok(runtime.list_grants().await)
}

#[tauri::command]
pub(crate) async fn local_app_grant_revoke(
    runtime: tauri::State<'_, DesktopLocalAppGrantRuntime>,
    payload: LocalAppGrantRevokePayload,
) -> Result<LocalAppGrantManagementProjection, String> {
    runtime.revoke(payload).await
}

fn random_selector(prefix: &str, byte_count: usize) -> Result<String, String> {
    crate::desktop_open_intent::presence::random_base64_url(byte_count)
        .map(|suffix| format!("{prefix}-{suffix}"))
}

fn required_selector<'a>(value: &'a str, prefix: &str) -> Result<&'a str, String> {
    if value.trim() != value
        || !value.starts_with(&format!("{prefix}-"))
        || value.len() > 160
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("local-app-grant-selector-invalid".to_string());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_projection_contains_no_runtime_authority_identifier() {
        let projection = LocalAppGrantApprovalProjection {
            selector: "grant-approval-safe_1".to_string(),
            operation_id: "runtime_agent.conversation.open".to_string(),
            resource_ref: "agent:agent-a".to_string(),
            state: "pending".to_string(),
            reason_code: "local-app-presence-required".to_string(),
            retryable: false,
            expires_at_unix_ms: 1_800_000_000_000,
        };
        let value = serde_json::to_value(projection).expect("serialize projection");
        let object = value.as_object().expect("projection object");
        assert_eq!(
            object.keys().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "expiresAtUnixMs",
                "operationId",
                "reasonCode",
                "resourceRef",
                "retryable",
                "selector",
                "state",
            ]
        );
        for forbidden in [
            "requestId",
            "presenceChallengeId",
            "grantId",
            "localAppPrincipalId",
            "localAppRecordId",
            "accountId",
            "sessionId",
        ] {
            assert!(!object.contains_key(forbidden));
        }
    }

    #[test]
    fn selector_boundary_rejects_raw_or_wrong_kind_values() {
        assert!(required_selector("grant-approval-safe_1", "grant-approval").is_ok());
        assert!(required_selector("grant-control-safe_1", "grant-approval").is_err());
        assert!(required_selector("raw runtime id", "grant-approval").is_err());
    }
}
