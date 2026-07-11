mod http;
mod plan;
mod supervisor;

use self::plan::{resolve_project_plan, DevelopmentProjectPlan};
use axum::Router;
use nimi_shell_tauri::capabilities::runtime::{
    self as runtime_bridge, LocalDevelopmentAuthorization, LocalDevelopmentAuthorizationState,
    LocalDevelopmentDecision, LocalDevelopmentDecisionRequest, LocalDevelopmentEvaluation,
    LocalDevelopmentEvaluationRequest, NimiHostError,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch, RwLock},
};

pub(crate) const APPROVAL_EVENT: &str = "local-development://approval-requested";
const PRESENCE_RELATIVE_PATH: &[&str] =
    &["run", "desktop", "local-development", "presence.v1.json"];
const PRESENCE_HEARTBEAT_INTERVAL_MS: u64 = 3_000;
const MAX_STATUS_LOGS: usize = 80;
const MAX_RECENT_FAILURES: usize = 20;

#[derive(Clone)]
pub(crate) struct DesktopLocalDevelopmentRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    app: AppHandle,
    descriptor_path: PathBuf,
    runs: RwLock<HashMap<String, Arc<RunContext>>>,
    recent_failures: RwLock<Vec<LocalDevelopmentRunStatus>>,
    pending: RwLock<HashMap<String, PendingApproval>>,
    management_selectors: RwLock<HashMap<String, [u8; 32]>>,
    shutdown: StdMutex<Vec<oneshot::Sender<()>>>,
}

pub(crate) struct RunContext {
    pub(crate) run_id: String,
    pub(crate) supervisor_run_id: [u8; 32],
    pub(crate) plan: DevelopmentProjectPlan,
    authorization_id: RwLock<Option<[u8; 32]>>,
    last_tauri_launch: RwLock<Option<(PathBuf, Vec<String>)>>,
    pub(crate) status: RwLock<LocalDevelopmentRunStatus>,
    pub(crate) cancel_tx: watch::Sender<bool>,
}

pub(crate) enum AuthorityRefresh {
    Active,
    ApprovalRequired,
    RuntimeUnavailable,
    Terminal,
}

#[derive(Clone)]
struct PendingApproval {
    evaluation_id: [u8; 32],
    run: Arc<RunContext>,
    projection: LocalDevelopmentApprovalProjection,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentApprovalProjection {
    pub(crate) request_id: String,
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) account_id: String,
    pub(crate) requested_capabilities: Vec<String>,
    pub(crate) approval_state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentAuthorizationProjection {
    pub(crate) selector: String,
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) account_id: String,
    pub(crate) requested_capabilities: Vec<String>,
    pub(crate) persistence: String,
    pub(crate) state: String,
    pub(crate) updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentRunProjection {
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) state: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason_code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) host_generation: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentRunStatus {
    pub(crate) schema_version: u8,
    pub(crate) run_id: String,
    pub(crate) state: String,
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) renderer_origin: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason_code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) host_generation: u64,
    pub(crate) log_sequence: u64,
    pub(crate) logs: Vec<LocalDevelopmentLogLine>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentLogLine {
    sequence: u64,
    stream: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalDevelopmentDecisionPayload {
    request_id: String,
    decision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalDevelopmentRevokePayload {
    selector: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalDevelopmentPresenceDescriptor {
    schema_version: u8,
    desktop_app_id: String,
    desktop_pid: u32,
    endpoint: String,
    started_at: String,
    last_heartbeat_at: String,
}

impl DesktopLocalDevelopmentRuntime {
    pub(crate) fn start(app: AppHandle) -> Result<Self, String> {
        let nimi_dir = crate::desktop_paths::resolve_nimi_dir()?;
        let descriptor_path = PRESENCE_RELATIVE_PATH
            .iter()
            .fold(nimi_dir, |path, segment| path.join(segment));
        let listener = tauri::async_runtime::block_on(TcpListener::bind("127.0.0.1:0"))
            .map_err(|error| format!("local development bridge bind failed: {error}"))?;
        let endpoint = format!(
            "http://{}",
            listener
                .local_addr()
                .map_err(|error| format!("local development bridge address failed: {error}"))?
        );
        let started_at = crate::desktop_open_intent::presence::now_iso8601();
        let runtime = Self {
            inner: Arc::new(RuntimeInner {
                app,
                descriptor_path: descriptor_path.clone(),
                runs: RwLock::new(HashMap::new()),
                recent_failures: RwLock::new(Vec::new()),
                pending: RwLock::new(HashMap::new()),
                management_selectors: RwLock::new(HashMap::new()),
                shutdown: StdMutex::new(Vec::new()),
            }),
        };
        write_presence(&descriptor_path, &endpoint, &started_at)?;
        let (server_tx, server_rx) = oneshot::channel();
        let (heartbeat_tx, mut heartbeat_rx) = oneshot::channel();
        {
            let mut shutdown = runtime
                .inner
                .shutdown
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            shutdown.push(server_tx);
            shutdown.push(heartbeat_tx);
        }
        let router: Router = http::router(runtime.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = server_rx.await;
                })
                .await
            {
                eprintln!("[local-development] bridge server failed: {error}");
            }
        });
        let heartbeat_path = descriptor_path.clone();
        let heartbeat_endpoint = endpoint.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis(PRESENCE_HEARTBEAT_INTERVAL_MS));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(error) = write_presence(&heartbeat_path, &heartbeat_endpoint, &started_at) {
                            eprintln!("[local-development] presence heartbeat failed: {error}");
                        }
                    }
                    _ = &mut heartbeat_rx => break,
                }
            }
        });
        Ok(runtime)
    }

    pub(crate) async fn start_intent(
        &self,
        app_id: String,
        project_root: String,
        shell: String,
    ) -> LocalDevelopmentRunStatus {
        let plan = match resolve_project_plan(&project_root, &app_id, &shell) {
            Ok(plan) => plan,
            Err(reason) => {
                return self
                    .record_terminal_failure(app_id, project_root, shell, reason)
                    .await;
            }
        };
        let run_id = match random_selector("dev-run", 18) {
            Ok(value) => value,
            Err(reason) => {
                return self
                    .record_terminal_failure(app_id, project_root, shell, reason)
                    .await;
            }
        };
        let supervisor_run_id = match random_identifier() {
            Ok(value) => value,
            Err(reason) => {
                return self
                    .record_terminal_failure(app_id, project_root, shell, reason)
                    .await;
            }
        };
        let (cancel_tx, _) = watch::channel(false);
        let run = Arc::new(RunContext {
            run_id: run_id.clone(),
            supervisor_run_id,
            status: RwLock::new(initial_status(&run_id, &plan)),
            plan,
            authorization_id: RwLock::new(None),
            last_tauri_launch: RwLock::new(None),
            cancel_tx,
        });
        self.inner.runs.write().await.insert(run_id, run.clone());

        let daemon = runtime_bridge::current_daemon_status_async().await;
        if !daemon.running {
            run.fail("runtime-unavailable", "runtime-service-unavailable", true)
                .await;
            return run.status().await;
        }
        let evaluation =
            runtime_bridge::evaluate_local_development_project(LocalDevelopmentEvaluationRequest {
                expected_app_id: run.plan.app_id.clone(),
                project_root: run.plan.project_root.clone(),
                shell_kind: run.plan.shell.kind(),
                supervisor_run_id,
            })
            .await;
        let evaluation = match evaluation {
            Ok(value) => value,
            Err(error) => {
                run.fail_host_error(error).await;
                return run.status().await;
            }
        };
        if !evaluation_matches_plan(&evaluation.project, &run.plan) {
            run.fail(
                "project-changed",
                "local-development-project-changed",
                false,
            )
            .await;
            return run.status().await;
        }
        if evaluation.confirmation_required {
            if let Err(reason) = self.queue_approval(run.clone(), evaluation).await {
                run.fail("failed", &reason, false).await;
            }
            return run.status().await;
        }
        let Some(authorization) = evaluation.authorization else {
            run.fail("failed", "runtime-service-untrusted", false).await;
            return run.status().await;
        };
        if authorization.state != LocalDevelopmentAuthorizationState::Active {
            run.fail(
                "authorization-required",
                "local-development-authorization-required",
                false,
            )
            .await;
            return run.status().await;
        }
        *run.authorization_id.write().await = Some(authorization.authorization_id);
        self.spawn_supervisor(run.clone());
        run.status().await
    }

    pub(crate) async fn status(&self, run_id: &str) -> Option<LocalDevelopmentRunStatus> {
        let run = self.inner.runs.read().await.get(run_id).cloned()?;
        Some(run.status().await)
    }

    pub(crate) async fn refresh_authority(&self, run: Arc<RunContext>) -> AuthorityRefresh {
        let evaluation =
            runtime_bridge::evaluate_local_development_project(LocalDevelopmentEvaluationRequest {
                expected_app_id: run.plan.app_id.clone(),
                project_root: run.plan.project_root.clone(),
                shell_kind: run.plan.shell.kind(),
                supervisor_run_id: run.supervisor_run_id,
            })
            .await;
        let evaluation = match evaluation {
            Ok(value) => value,
            Err(error) => {
                return match error.reason_code().as_str() {
                    "runtime-service-unavailable" => {
                        run.fail("runtime-unavailable", "runtime-service-unavailable", true)
                            .await;
                        AuthorityRefresh::RuntimeUnavailable
                    }
                    "principal-unauthorized" => {
                        let _ =
                            runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
                        run.set_state(
                            "authorization-required",
                            "Sign in to Nimi Desktop to continue development",
                            Some("principal-unauthorized"),
                            true,
                        )
                        .await;
                        AuthorityRefresh::RuntimeUnavailable
                    }
                    _ => {
                        run.fail_host_error(error).await;
                        run.cancel_tx.send_replace(true);
                        AuthorityRefresh::Terminal
                    }
                };
            }
        };
        if !evaluation_matches_plan(&evaluation.project, &run.plan) {
            run.fail(
                "project-changed",
                "local-development-project-changed",
                false,
            )
            .await;
            let _ = runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
            run.cancel_tx.send_replace(true);
            return AuthorityRefresh::Terminal;
        }
        if evaluation.confirmation_required {
            let _ = runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
            *run.authorization_id.write().await = None;
            if let Err(reason) = self.queue_approval(run.clone(), evaluation).await {
                run.fail("failed", &reason, false).await;
                return AuthorityRefresh::Terminal;
            }
            return AuthorityRefresh::ApprovalRequired;
        }
        let Some(authorization) = evaluation.authorization else {
            run.fail("failed", "runtime-service-untrusted", false).await;
            return AuthorityRefresh::Terminal;
        };
        if authorization.state != LocalDevelopmentAuthorizationState::Active {
            run.fail(
                "authorization-required",
                "local-development-authorization-required",
                false,
            )
            .await;
            return AuthorityRefresh::Terminal;
        }
        *run.authorization_id.write().await = Some(authorization.authorization_id);
        if matches!(
            run.status().await.state.as_str(),
            "runtime-unavailable" | "authorization-required"
        ) {
            run.set_state(
                "restarting",
                "Re-establishing the supervised development host",
                None,
                true,
            )
            .await;
        }
        AuthorityRefresh::Active
    }

    async fn queue_approval(
        &self,
        run: Arc<RunContext>,
        evaluation: LocalDevelopmentEvaluation,
    ) -> Result<(), String> {
        let evaluation_id = evaluation
            .evaluation_id
            .ok_or_else(|| "runtime-service-untrusted".to_string())?;
        let request_id = random_selector("dev-approval", 18)?;
        let projection = LocalDevelopmentApprovalProjection {
            request_id: request_id.clone(),
            app_id: evaluation.project.app_id.clone(),
            display_name: evaluation.project.display_name.clone(),
            canonical_project_root: path_text(&evaluation.project.canonical_project_root),
            shell: evaluation.project.shell_kind.as_str().to_string(),
            account_id: evaluation.project.account_id.clone(),
            requested_capabilities: evaluation.project.requested_capabilities.clone(),
            approval_state: evaluation.state.as_str().to_string(),
        };
        let mut pending = self.inner.pending.write().await;
        pending.retain(|_, row| row.run.run_id != run.run_id);
        pending.insert(
            request_id,
            PendingApproval {
                evaluation_id,
                run: run.clone(),
                projection: projection.clone(),
            },
        );
        drop(pending);
        run.set_state(
            "pending-approval",
            "Waiting for approval in Nimi Desktop",
            None,
            false,
        )
        .await;
        let _ = crate::menu_bar_shell::window::focus_main_window(&self.inner.app);
        let _ = self.inner.app.emit(APPROVAL_EVENT, projection);
        Ok(())
    }

    pub(crate) async fn cancel(&self, run_id: &str) -> Option<LocalDevelopmentRunStatus> {
        let run = self.inner.runs.read().await.get(run_id).cloned()?;
        run.cancel_tx.send_replace(true);
        if run.authorization_id.read().await.is_none() {
            self.inner
                .pending
                .write()
                .await
                .retain(|_, pending| pending.run.run_id != run.run_id);
            run.set_state("stopped", "Development run cancelled", None, false)
                .await;
        }
        Some(run.status().await)
    }

    pub(crate) async fn pending_approvals(&self) -> Vec<LocalDevelopmentApprovalProjection> {
        self.inner
            .pending
            .read()
            .await
            .values()
            .map(|pending| pending.projection.clone())
            .collect()
    }

    pub(crate) async fn decide(
        &self,
        payload: LocalDevelopmentDecisionPayload,
    ) -> Result<LocalDevelopmentRunStatus, String> {
        let request_id = required_selector(&payload.request_id, "dev-approval")?;
        let decision = match payload.decision.as_str() {
            "deny" => LocalDevelopmentDecision::Deny,
            "allow-run-once" => LocalDevelopmentDecision::AllowRunOnce,
            "allow-remember-project" => LocalDevelopmentDecision::AllowRememberProject,
            _ => return Err("local-development-approval-decision-invalid".to_string()),
        };
        let pending = self
            .inner
            .pending
            .write()
            .await
            .remove(request_id)
            .ok_or_else(|| "local-development-approval-request-not-found".to_string())?;
        let authorization =
            runtime_bridge::decide_local_development_project(LocalDevelopmentDecisionRequest {
                evaluation_id: pending.evaluation_id,
                decision,
            })
            .await;
        let authorization = match authorization {
            Ok(value) => value,
            Err(error) => {
                pending.run.fail_host_error(error).await;
                return Ok(pending.run.status().await);
            }
        };
        if decision == LocalDevelopmentDecision::Deny {
            pending
                .run
                .set_state(
                    "denied",
                    "Development access was denied",
                    Some("local-development-approval-denied"),
                    false,
                )
                .await;
            return Ok(pending.run.status().await);
        }
        if authorization.state != LocalDevelopmentAuthorizationState::Active {
            pending
                .run
                .fail(
                    "authorization-required",
                    "local-development-authorization-required",
                    false,
                )
                .await;
            return Ok(pending.run.status().await);
        }
        *pending.run.authorization_id.write().await = Some(authorization.authorization_id);
        self.spawn_supervisor(pending.run.clone());
        Ok(pending.run.status().await)
    }

    pub(crate) async fn list_authorizations(
        &self,
    ) -> Result<Vec<LocalDevelopmentAuthorizationProjection>, String> {
        let authorizations = runtime_bridge::list_local_development_authorizations()
            .await
            .map_err(|error| error.reason_code().as_str().to_string())?;
        let mut selectors = self.inner.management_selectors.write().await;
        let mut out = Vec::with_capacity(authorizations.len());
        for authorization in authorizations {
            let selector = selectors
                .iter()
                .find_map(|(selector, id)| {
                    (*id == authorization.authorization_id).then(|| selector.clone())
                })
                .unwrap_or(random_selector("dev-project", 18)?);
            selectors.insert(selector.clone(), authorization.authorization_id);
            out.push(project_authorization(selector, authorization));
        }
        Ok(out)
    }

    pub(crate) async fn list_runs(&self) -> Vec<LocalDevelopmentRunProjection> {
        let runs = self
            .inner
            .runs
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut out = Vec::with_capacity(runs.len() + MAX_RECENT_FAILURES);
        for run in runs {
            out.push(project_run_status(run.status().await));
        }
        out.extend(
            self.inner
                .recent_failures
                .read()
                .await
                .iter()
                .cloned()
                .map(project_run_status),
        );
        out.sort_by(|left, right| {
            right
                .host_generation
                .cmp(&left.host_generation)
                .then_with(|| left.app_id.cmp(&right.app_id))
                .then_with(|| left.shell.cmp(&right.shell))
        });
        out
    }

    pub(crate) async fn revoke_authorization(
        &self,
        payload: LocalDevelopmentRevokePayload,
    ) -> Result<LocalDevelopmentAuthorizationProjection, String> {
        let selector = required_selector(&payload.selector, "dev-project")?;
        let authorization_id = self
            .inner
            .management_selectors
            .read()
            .await
            .get(selector)
            .copied()
            .ok_or_else(|| "local-development-authorization-not-found".to_string())?;
        let authorization =
            runtime_bridge::revoke_local_development_authorization(authorization_id)
                .await
                .map_err(|error| error.reason_code().as_str().to_string())?;
        for run in self.inner.runs.read().await.values() {
            if run.authorization_id.read().await.as_ref() == Some(&authorization_id) {
                run.cancel_tx.send_replace(true);
                run.set_state(
                    "revoked",
                    "Development authorization was revoked",
                    Some("local-development-session-revoked"),
                    false,
                )
                .await;
            }
        }
        Ok(project_authorization(selector.to_string(), authorization))
    }

    pub(crate) async fn shutdown(&self) {
        {
            let mut senders = self
                .inner
                .shutdown
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            for sender in senders.drain(..) {
                let _ = sender.send(());
            }
        }
        for run in self.inner.runs.read().await.values() {
            run.cancel_tx.send_replace(true);
        }
        let _ = fs::remove_file(&self.inner.descriptor_path);
    }

    fn spawn_supervisor(&self, run: Arc<RunContext>) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            supervisor::run(runtime, run).await;
        });
    }

    async fn record_terminal_failure(
        &self,
        app_id: String,
        project_root: String,
        shell: String,
        reason_code: String,
    ) -> LocalDevelopmentRunStatus {
        let status = terminal_status_without_run(app_id, project_root, shell, reason_code);
        if recordable_terminal_status(&status) {
            let mut failures = self.inner.recent_failures.write().await;
            failures.insert(0, status.clone());
            failures.truncate(MAX_RECENT_FAILURES);
        }
        status
    }
}

impl RunContext {
    pub(crate) async fn status(&self) -> LocalDevelopmentRunStatus {
        self.status.read().await.clone()
    }

    pub(crate) async fn authorization_id(&self) -> Result<[u8; 32], String> {
        self.authorization_id
            .read()
            .await
            .ok_or_else(|| "local-development-authorization-required".to_string())
    }

    pub(crate) async fn set_state(
        &self,
        state: &str,
        message: &str,
        reason_code: Option<&str>,
        retryable: bool,
    ) {
        let mut status = self.status.write().await;
        status.state = state.to_string();
        status.message = message.to_string();
        status.reason_code = reason_code.map(str::to_string);
        status.retryable = retryable;
    }

    pub(crate) async fn mark_running(&self, process_id: u32) {
        let mut status = self.status.write().await;
        status.state = "running".to_string();
        status.message = format!("Supervised {} host is running", status.shell);
        status.reason_code = None;
        status.retryable = false;
        status.host_generation = status.host_generation.saturating_add(1);
        let generation = status.host_generation;
        append_log_locked(
            &mut status,
            "supervisor",
            format!("host generation {generation} started (pid {process_id})"),
        );
    }

    pub(crate) async fn fail(&self, state: &str, reason_code: &str, retryable: bool) {
        self.set_state(state, reason_code, Some(reason_code), retryable)
            .await;
    }

    pub(crate) async fn fail_host_error(&self, error: NimiHostError) {
        let reason = error.reason_code().as_str();
        let state = match reason {
            "runtime-service-unavailable" => "runtime-unavailable",
            "local-development-project-changed" => "project-changed",
            "local-development-approval-denied" => "denied",
            "local-development-session-revoked" => "revoked",
            "local-development-reapproval-required"
            | "local-development-authorization-required" => "authorization-required",
            _ => "failed",
        };
        self.fail(state, reason, error.retryable()).await;
    }

    pub(crate) async fn log(&self, stream: &str, message: impl Into<String>) {
        let mut status = self.status.write().await;
        append_log_locked(&mut status, stream, sanitize_log(message.into()));
    }
}

#[tauri::command]
pub(crate) async fn local_development_pending_approvals(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
) -> Result<Vec<LocalDevelopmentApprovalProjection>, String> {
    Ok(runtime.pending_approvals().await)
}

#[tauri::command]
pub(crate) async fn local_development_decide(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
    payload: LocalDevelopmentDecisionPayload,
) -> Result<LocalDevelopmentRunStatus, String> {
    runtime.decide(payload).await
}

#[tauri::command]
pub(crate) async fn local_development_authorizations_list(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
) -> Result<Vec<LocalDevelopmentAuthorizationProjection>, String> {
    runtime.list_authorizations().await
}

#[tauri::command]
pub(crate) async fn local_development_runs_list(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
) -> Result<Vec<LocalDevelopmentRunProjection>, String> {
    Ok(runtime.list_runs().await)
}

#[tauri::command]
pub(crate) async fn local_development_authorization_revoke(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
    payload: LocalDevelopmentRevokePayload,
) -> Result<LocalDevelopmentAuthorizationProjection, String> {
    runtime.revoke_authorization(payload).await
}

fn initial_status(run_id: &str, plan: &DevelopmentProjectPlan) -> LocalDevelopmentRunStatus {
    LocalDevelopmentRunStatus {
        schema_version: 1,
        run_id: run_id.to_string(),
        state: "preparing".to_string(),
        app_id: plan.app_id.clone(),
        display_name: plan.display_name.clone(),
        canonical_project_root: path_text(&plan.project_root),
        shell: plan.shell.name().to_string(),
        renderer_origin: plan.renderer_origin.clone(),
        message: "Validating project with Nimi Runtime".to_string(),
        reason_code: None,
        retryable: false,
        host_generation: 0,
        log_sequence: 0,
        logs: Vec::new(),
    }
}

fn terminal_status_without_run(
    app_id: String,
    project_root: String,
    shell: String,
    reason_code: String,
) -> LocalDevelopmentRunStatus {
    LocalDevelopmentRunStatus {
        schema_version: 1,
        run_id: String::new(),
        state: if reason_code == "runtime-service-unavailable" {
            "runtime-unavailable"
        } else {
            "project-changed"
        }
        .to_string(),
        app_id,
        display_name: String::new(),
        canonical_project_root: project_root,
        shell,
        renderer_origin: String::new(),
        message: reason_code.clone(),
        reason_code: Some(reason_code),
        retryable: false,
        host_generation: 0,
        log_sequence: 0,
        logs: Vec::new(),
    }
}

fn recordable_terminal_status(status: &LocalDevelopmentRunStatus) -> bool {
    let app_id = status.app_id.as_str();
    !app_id.is_empty()
        && app_id.len() <= 160
        && app_id.trim() == app_id
        && app_id
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && app_id
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && app_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        && std::path::Path::new(&status.canonical_project_root).is_absolute()
        && status.canonical_project_root.trim() == status.canonical_project_root
        && matches!(status.shell.as_str(), "electron" | "tauri")
}

fn evaluation_matches_plan(
    project: &runtime_bridge::LocalDevelopmentProject,
    plan: &DevelopmentProjectPlan,
) -> bool {
    project.app_id == plan.app_id
        && project.display_name == plan.display_name
        && project.shell_kind == plan.shell.kind()
        && paths_equal(&project.canonical_project_root, &plan.project_root)
}

fn project_authorization(
    selector: String,
    authorization: LocalDevelopmentAuthorization,
) -> LocalDevelopmentAuthorizationProjection {
    LocalDevelopmentAuthorizationProjection {
        selector,
        app_id: authorization.project.app_id,
        display_name: authorization.project.display_name,
        canonical_project_root: path_text(&authorization.project.canonical_project_root),
        shell: authorization.project.shell_kind.as_str().to_string(),
        account_id: authorization.project.account_id,
        requested_capabilities: authorization.project.requested_capabilities,
        persistence: authorization.persistence.as_str().to_string(),
        state: authorization.state.as_str().to_string(),
        updated_at_unix_ms: authorization.updated_at_unix_ms,
    }
}

fn project_run_status(status: LocalDevelopmentRunStatus) -> LocalDevelopmentRunProjection {
    let display_name = if status.display_name.is_empty() {
        status.app_id.clone()
    } else {
        status.display_name
    };
    LocalDevelopmentRunProjection {
        app_id: status.app_id,
        display_name,
        canonical_project_root: status.canonical_project_root,
        shell: status.shell,
        state: status.state,
        message: status.message,
        reason_code: status.reason_code,
        retryable: status.retryable,
        host_generation: status.host_generation,
    }
}

fn append_log_locked(status: &mut LocalDevelopmentRunStatus, stream: &str, message: String) {
    status.log_sequence = status.log_sequence.saturating_add(1);
    status.logs.push(LocalDevelopmentLogLine {
        sequence: status.log_sequence,
        stream: stream.to_string(),
        message,
    });
    if status.logs.len() > MAX_STATUS_LOGS {
        status.logs.drain(..status.logs.len() - MAX_STATUS_LOGS);
    }
}

fn sanitize_log(message: String) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lowered = trimmed.to_ascii_lowercase();
    if [
        "session_proof",
        "sessionproof",
        "access_token",
        "refresh_token",
        "authorization: bearer",
        "credential",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
    {
        return "[sensitive supervisor output redacted]".to_string();
    }
    trimmed.chars().take(2_000).collect()
}

fn paths_equal(left: &std::path::Path, right: &std::path::Path) -> bool {
    left.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
        == right
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase()
}

fn path_text(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

fn random_identifier() -> Result<[u8; 32], String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| "local-development-supervisor-required".to_string())?;
    if bytes == [0u8; 32] {
        return Err("local-development-supervisor-required".to_string());
    }
    Ok(bytes)
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
        return Err("local-development-supervisor-required".to_string());
    }
    Ok(value)
}

fn write_presence(path: &std::path::Path, endpoint: &str, started_at: &str) -> Result<(), String> {
    crate::desktop_open_intent::presence::write_presence_document(
        path,
        &LocalDevelopmentPresenceDescriptor {
            schema_version: 1,
            desktop_app_id: "nimi.desktop".to_string(),
            desktop_pid: std::process::id(),
            endpoint: endpoint.to_string(),
            started_at: started_at.to_string(),
            last_heartbeat_at: crate::desktop_open_intent::presence::now_iso8601(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectors_are_exact_and_do_not_admit_path_or_header_syntax() {
        assert!(required_selector("dev-run-abc_123", "dev-run").is_ok());
        for invalid in [
            " dev-run-abc",
            "dev-run-abc/def",
            "dev-run-abc:Bearer",
            "other-abc",
        ] {
            assert!(required_selector(invalid, "dev-run").is_err(), "{invalid}");
        }
    }

    #[test]
    fn supervisor_logs_redact_security_material() {
        assert_eq!(
            sanitize_log("authorization: Bearer secret".to_string()),
            "[sensitive supervisor output redacted]"
        );
        assert_eq!(sanitize_log("Vite ready".to_string()), "Vite ready");
    }
}
