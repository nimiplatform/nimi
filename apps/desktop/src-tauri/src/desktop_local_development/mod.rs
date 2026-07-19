mod authority_summary;
mod domain;
mod http;
mod plan;
mod run_context;
mod supervisor;

use self::domain::{
    append_log_locked, developer_mode_projection, evaluation_matches_plan,
    initial_authority_retryable, initial_status, path_text, project_authorization,
    project_run_status, random_identifier, random_selector, recordable_terminal_status,
    required_selector, sanitize_log, terminal_status_without_run, write_presence,
    InitialAuthorityResolution, PendingApproval, PendingApprovalTarget,
    PermissionRequirementProjection,
};
pub(crate) use self::domain::{
    AuthorityRefresh, DeveloperModeProjection, DeveloperModeSetPayload,
    LocalDevelopmentApprovalProjection, LocalDevelopmentAuthorizationProjection,
    LocalDevelopmentDecisionPayload, LocalDevelopmentRevokePayload, LocalDevelopmentRunProjection,
    LocalDevelopmentRunStatus,
};
use self::plan::{resolve_project_plan, DevelopmentProjectPlan};
use axum::Router;
use nimi_shell_tauri::capabilities::runtime::{
    self as runtime_bridge, LocalDevelopmentAuthorizationState, LocalDevelopmentDecision,
    LocalDevelopmentDecisionRequest, LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest,
    NimiHostError,
};
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
const AUTHORITY_SUMMARY_RELATIVE_PATH: &[&str] = &[
    "run",
    "desktop",
    "local-development",
    "authority-summary.v1.json",
];
const INITIAL_AUTHORITY_RETRY_INTERVAL: Duration = Duration::from_millis(750);
const MAX_RECENT_FAILURES: usize = 20;

#[cfg(feature = "protected-local-e2e-fixture")]
fn report_windows_e2e_local_development(stage: &str, reason_code: Option<&str>) {
    eprintln!(
        "[desktop local-development protected-local-e2e-fixture] stage={} reason_code={}",
        stage,
        reason_code.unwrap_or("none")
    );
}

#[cfg(not(feature = "protected-local-e2e-fixture"))]
fn report_windows_e2e_local_development(_: &str, _: Option<&str>) {}

#[derive(Clone)]
pub(crate) struct DesktopLocalDevelopmentRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    app: AppHandle,
    descriptor_path: PathBuf,
    authority_summary_path: PathBuf,
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

impl DesktopLocalDevelopmentRuntime {
    pub(crate) fn start(app: AppHandle) -> Result<Self, String> {
        let nimi_dir = crate::desktop_paths::resolve_nimi_dir()?;
        let descriptor_path = PRESENCE_RELATIVE_PATH
            .iter()
            .fold(nimi_dir.clone(), |path, segment| path.join(segment));
        let authority_summary_path = AUTHORITY_SUMMARY_RELATIVE_PATH
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
                authority_summary_path: authority_summary_path.clone(),
                runs: RwLock::new(HashMap::new()),
                recent_failures: RwLock::new(Vec::new()),
                pending: RwLock::new(HashMap::new()),
                management_selectors: RwLock::new(HashMap::new()),
                shutdown: StdMutex::new(Vec::new()),
            }),
        };
        write_presence(&descriptor_path, &endpoint, &started_at)?;
        let (server_tx, server_rx) = oneshot::channel();
        let (heartbeat_tx, heartbeat_rx) = oneshot::channel();
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
        authority_summary::spawn_heartbeat(
            descriptor_path,
            authority_summary_path,
            endpoint,
            started_at,
            heartbeat_rx,
        );
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

        if self.resolve_initial_authority(run.clone()).await
            == InitialAuthorityResolution::Retryable
        {
            self.spawn_initial_authority_retry(run.clone());
        }
        run.status().await
    }

    async fn resolve_initial_authority(&self, run: Arc<RunContext>) -> InitialAuthorityResolution {
        if *run.cancel_tx.borrow() {
            return InitialAuthorityResolution::Settled;
        }
        let daemon = runtime_bridge::current_daemon_status_async().await;
        if !daemon.running {
            report_windows_e2e_local_development(
                "daemon-preflight-unavailable",
                Some("runtime-service-unavailable"),
            );
            run.fail("runtime-unavailable", "runtime-service-unavailable", true)
                .await;
            return InitialAuthorityResolution::Retryable;
        }
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
                report_windows_e2e_local_development(
                    "evaluation-error",
                    Some(error.reason_code().as_str()),
                );
                let reason = error.reason_code().as_str();
                if initial_authority_retryable(reason) {
                    if reason == "principal-unauthorized" {
                        run.set_state(
                            "authorization-required",
                            "Sign in to Nimi Desktop to continue development",
                            Some(reason),
                            true,
                        )
                        .await;
                    } else {
                        run.fail("runtime-unavailable", reason, true).await;
                    }
                    return InitialAuthorityResolution::Retryable;
                }
                run.fail_host_error(error).await;
                return InitialAuthorityResolution::Settled;
            }
        };
        report_windows_e2e_local_development("evaluation-succeeded", None);
        if !evaluation_matches_plan(&evaluation.project, &run.plan) {
            run.fail(
                "project-changed",
                "local-development-project-changed",
                false,
            )
            .await;
            return InitialAuthorityResolution::Settled;
        }
        if evaluation.confirmation_required {
            if let Err(reason) = self.queue_approval(run.clone(), evaluation).await {
                run.fail("failed", &reason, false).await;
            }
            return InitialAuthorityResolution::Settled;
        }
        let Some(authorization) = evaluation.authorization else {
            run.fail("failed", "runtime-service-untrusted", false).await;
            return InitialAuthorityResolution::Settled;
        };
        if authorization.state != LocalDevelopmentAuthorizationState::Active {
            run.fail(
                "authorization-required",
                "local-development-authorization-required",
                false,
            )
            .await;
            return InitialAuthorityResolution::Settled;
        }
        *run.authorization_id.write().await = Some(authorization.authorization_id);
        self.spawn_supervisor(run.clone());
        InitialAuthorityResolution::Settled
    }

    fn spawn_initial_authority_retry(&self, run: Arc<RunContext>) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            runtime.retry_initial_authority(run).await;
        });
    }

    async fn retry_initial_authority(&self, run: Arc<RunContext>) {
        let mut cancel = run.cancel_tx.subscribe();
        loop {
            tokio::select! {
                changed = cancel.changed() => {
                    if changed.is_err() || *cancel.borrow() {
                        return;
                    }
                }
                _ = tokio::time::sleep(INITIAL_AUTHORITY_RETRY_INTERVAL) => {}
            }
            if *cancel.borrow()
                || self.resolve_initial_authority(run.clone()).await
                    != InitialAuthorityResolution::Retryable
            {
                return;
            }
        }
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
        let target = PendingApprovalTarget::Evaluation(
            evaluation
                .evaluation_id
                .ok_or_else(|| "runtime-service-untrusted".to_string())?,
        );
        let request_id = random_selector("dev-approval", 18)?;
        let projection = LocalDevelopmentApprovalProjection {
            request_id: request_id.clone(),
            app_id: evaluation.project.app_id.clone(),
            display_name: evaluation.project.display_name.clone(),
            canonical_project_root: path_text(&evaluation.project.canonical_project_root),
            shell: evaluation.project.shell_kind.as_str().to_string(),
            account_id: evaluation.project.account_id.clone(),
            permission_requirements: evaluation
                .project
                .permission_requirements
                .iter()
                .map(|requirement| PermissionRequirementProjection {
                    permission_id: requirement.permission_id.clone(),
                    reason: requirement.reason.clone(),
                })
                .collect(),
            approval_state: evaluation.state.as_str().to_string(),
        };
        let mut pending = self.inner.pending.write().await;
        pending.retain(|_, row| row.run.run_id != run.run_id);
        pending.insert(
            request_id,
            PendingApproval {
                target,
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
    async fn terminate_all_runs_for_mode_off(&self) {
        let runs = self
            .inner
            .runs
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        self.inner.pending.write().await.clear();
        for run in runs {
            run.cancel_tx.send_replace(true);
            let _ = runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
            *run.authorization_id.write().await = None;
            run.set_state(
                "stopped",
                "Developer Mode was disabled",
                Some("local-app-developer-mode-disabled"),
                false,
            )
            .await;
        }
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
            "allow-project" => LocalDevelopmentDecision::AllowProject,
            _ => return Err("local-development-approval-decision-invalid".to_string()),
        };
        let pending = self
            .inner
            .pending
            .write()
            .await
            .remove(request_id)
            .ok_or_else(|| "local-development-approval-request-not-found".to_string())?;
        let PendingApprovalTarget::Evaluation(evaluation_id) = pending.target;
        let authorization =
            runtime_bridge::decide_local_development_project(LocalDevelopmentDecisionRequest {
                evaluation_id,
                decision,
                risk_disclosure_acknowledged: payload.risk_disclosure_acknowledged,
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
        let _ = fs::remove_file(&self.inner.authority_summary_path);
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

#[tauri::command]
pub(crate) async fn local_development_pending_approvals(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
) -> Result<Vec<LocalDevelopmentApprovalProjection>, String> {
    Ok(runtime.pending_approvals().await)
}

#[tauri::command]
pub(crate) async fn developer_mode_status() -> DeveloperModeProjection {
    match runtime_bridge::get_developer_mode_status().await {
        Ok(status) => developer_mode_projection(status),
        Err(error) => DeveloperModeProjection {
            state: "unavailable".to_string(),
            enabled: false,
            revision: 0,
            account_generation: 0,
            reason_code: error.reason_code().as_str().to_string(),
            retryable: error.retryable(),
        },
    }
}

#[tauri::command]
pub(crate) async fn developer_mode_set(
    runtime: tauri::State<'_, DesktopLocalDevelopmentRuntime>,
    payload: DeveloperModeSetPayload,
) -> Result<DeveloperModeProjection, String> {
    let status = runtime_bridge::set_developer_mode(payload.enabled)
        .await
        .map_err(|error| error.reason_code().as_str().to_string())?;
    if !payload.enabled {
        runtime.terminate_all_runs_for_mode_off().await;
    }
    Ok(developer_mode_projection(status))
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
