use std::ffi::OsStr;
use std::future::Future;
use std::pin::Pin;

use tonic::transport::Channel;
use windows_service::service::{ServiceAccess, ServiceState};

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;
use crate::generated::{OpenDesktopSessionRequest, RequestRuntimeRestartRequest};
use crate::{
    FixedRuntimeServiceControl, ProtectedCarrierError, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};

use super::{
    open_verified_runtime_channel, project_start_outcome, project_status, query_service_state,
    query_service_status, repair_required, running_service_pid, service_manager, unavailable,
    untrusted, WindowsNamedPipeCarrier, RUNTIME_PROTECTED_PIPE_NAME, RUNTIME_SERVICE_NAME,
};

const WINDOWS_RUNTIME_STOP_BOUND_SECS: u64 = 25;
const WINDOWS_RUNTIME_SCM_RECOVERY_BOUND_SECS: u64 = 10;
const WINDOWS_RUNTIME_READY_BOUND_SECS: u64 = 45;
const WINDOWS_RUNTIME_RESTART_MARGIN_SECS: u64 = 10;
const WINDOWS_RUNTIME_RESTART_DEADLINE: std::time::Duration = std::time::Duration::from_secs(
    WINDOWS_RUNTIME_STOP_BOUND_SECS
        + WINDOWS_RUNTIME_SCM_RECOVERY_BOUND_SECS
        + WINDOWS_RUNTIME_READY_BOUND_SECS
        + WINDOWS_RUNTIME_RESTART_MARGIN_SECS,
);

impl FixedRuntimeServiceControl for WindowsNamedPipeCarrier {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
        let state = query_service_state(ServiceAccess::QUERY_STATUS)?;
        project_status(state)
    }

    fn request_runtime_service_start(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
        let manager = service_manager()?;
        let service = manager
            .open_service(
                RUNTIME_SERVICE_NAME,
                ServiceAccess::QUERY_STATUS | ServiceAccess::START,
            )
            .map_err(|_| unavailable())?;
        let before = service.query_status().map_err(|_| unavailable())?;
        match before.current_state {
            ServiceState::Stopped => {
                service.start(&[] as &[&OsStr]).map_err(|_| unavailable())?;
                let after = service.query_status().map_err(|_| unavailable())?;
                project_start_outcome(after.current_state)
            }
            state => project_start_outcome(state),
        }
    }

    fn request_runtime_service_restart(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<RuntimeServiceActionOutcome, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async {
            let (channel, _runtime_peer) =
                open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await?;
            let mut auth = RuntimeAuthServiceClient::new(channel.clone());
            let opened = auth
                .open_desktop_session(OpenDesktopSessionRequest {})
                .await
                .map_err(|_| untrusted())?
                .into_inner();
            let before_epoch: [u8; 32] = opened
                .runtime_boot_epoch
                .try_into()
                .map_err(|_| untrusted())?;
            request_verified_runtime_restart_on_channel(channel, before_epoch).await
        })
    }
}

pub(super) async fn request_verified_runtime_restart_on_channel(
    channel: Channel,
    before_epoch: [u8; 32],
) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
    let before = query_service_status()?;
    let before_pid = running_service_pid(&before)?;
    if before_epoch == [0u8; 32] {
        return Err(untrusted());
    }

    let mut control = RuntimeServiceControlServiceClient::new(channel);
    let request_result = control
        .request_runtime_restart(RequestRuntimeRestartRequest {})
        .await;
    match request_result {
        Ok(response) => {
            if !response.into_inner().accepted {
                return Err(untrusted());
            }
        }
        Err(status)
            if matches!(
                status.code(),
                tonic::Code::Unavailable | tonic::Code::Cancelled | tonic::Code::Unknown
            ) => {}
        Err(_) => return Err(untrusted()),
    }

    let deadline = tokio::time::Instant::now() + WINDOWS_RUNTIME_RESTART_DEADLINE;
    let mut replacement_observed = false;
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(if replacement_observed {
                unavailable()
            } else {
                repair_required()
            });
        }
        let status = match query_service_status() {
            Ok(status) => status,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                continue;
            }
        };
        match status.current_state {
            ServiceState::Stopped | ServiceState::StopPending | ServiceState::StartPending => {
                replacement_observed = true;
            }
            ServiceState::Running => {
                let Some(after_pid) = status.process_id.filter(|pid| *pid != 0) else {
                    return Err(untrusted());
                };
                if after_pid != before_pid {
                    replacement_observed = true;
                    if let Ok((after_channel, _runtime_peer)) =
                        open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await
                    {
                        let mut after_auth = RuntimeAuthServiceClient::new(after_channel);
                        if let Ok(response) = after_auth
                            .open_desktop_session(OpenDesktopSessionRequest {})
                            .await
                        {
                            let after_epoch: [u8; 32] = response
                                .into_inner()
                                .runtime_boot_epoch
                                .try_into()
                                .map_err(|_| untrusted())?;
                            if after_epoch != [0u8; 32] && after_epoch != before_epoch {
                                return Ok(RuntimeServiceActionOutcome {
                                    state: RuntimeServiceState::Running,
                                    release_id: None,
                                    reason_code: None,
                                    retryable: false,
                                });
                            }
                            return Err(untrusted());
                        }
                    }
                }
            }
            _ => return Err(repair_required()),
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        WINDOWS_RUNTIME_READY_BOUND_SECS, WINDOWS_RUNTIME_RESTART_DEADLINE,
        WINDOWS_RUNTIME_SCM_RECOVERY_BOUND_SECS, WINDOWS_RUNTIME_STOP_BOUND_SECS,
    };

    #[test]
    fn restart_deadline_covers_stop_recovery_and_replacement_readiness() {
        assert!(
            WINDOWS_RUNTIME_RESTART_DEADLINE.as_secs()
                >= WINDOWS_RUNTIME_STOP_BOUND_SECS
                    + WINDOWS_RUNTIME_SCM_RECOVERY_BOUND_SECS
                    + WINDOWS_RUNTIME_READY_BOUND_SECS
        );
    }
}
