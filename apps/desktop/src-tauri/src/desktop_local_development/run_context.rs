use super::{
    append_log_locked, sanitize_log, LocalDevelopmentRunStatus, NimiHostError, RunContext,
};

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
