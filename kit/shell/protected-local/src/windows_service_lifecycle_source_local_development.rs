use std::ffi::OsStr;
use std::future::Future;
use std::os::windows::ffi::OsStrExt;
use std::pin::Pin;

use tonic::transport::Channel;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND};
use windows_sys::Win32::System::Pipes::WaitNamedPipeW;

use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;
use crate::generated::RequestRuntimeRestartRequest;
use crate::windows_source_policy::{source_pipe_name, WindowsSourcePipeRole};
use crate::{
    FixedRuntimeServiceControl, ProtectedCarrierError, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};

use super::{
    open_verified_runtime_channel, unavailable, untrusted, WindowsNamedPipeCarrier,
    RUNTIME_PROTECTED_PIPE_NAME,
};

const SOURCE_RUNTIME_RESTART_DEADLINE: std::time::Duration = std::time::Duration::from_secs(45);

impl FixedRuntimeServiceControl for WindowsNamedPipeCarrier {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
        let state = if source_runtime_pipe_exists()? {
            RuntimeServiceState::Running
        } else {
            RuntimeServiceState::Stopped
        };
        Ok(RuntimeServiceStatus {
            state,
            release_id: None,
            reason_code: None,
            retryable: true,
        })
    }

    fn request_runtime_service_start(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
        Err(unavailable())
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
            let (channel, runtime_peer) =
                open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await?;
            request_verified_runtime_restart_on_channel(channel, runtime_peer.creation_marker())
                .await
        })
    }
}

pub(super) async fn request_verified_runtime_restart_on_channel(
    channel: Channel,
    before_creation_marker: u64,
) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
    if before_creation_marker == 0 {
        return Err(untrusted());
    }
    let mut control = RuntimeServiceControlServiceClient::new(channel);
    match control
        .request_runtime_restart(RequestRuntimeRestartRequest {})
        .await
    {
        Ok(response) if !response.get_ref().accepted => return Err(untrusted()),
        Ok(_) => {}
        Err(status)
            if matches!(
                status.code(),
                tonic::Code::Unavailable | tonic::Code::Cancelled | tonic::Code::Unknown
            ) => {}
        Err(_) => return Err(untrusted()),
    }

    let deadline = tokio::time::Instant::now() + SOURCE_RUNTIME_RESTART_DEADLINE;
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(unavailable());
        }
        if let Ok((_after_channel, after_runtime_peer)) =
            open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await
        {
            let after_creation_marker = after_runtime_peer.creation_marker();
            if after_creation_marker != 0 && after_creation_marker != before_creation_marker {
                super::invalidate_verified_desktop_runtime_channel().await;
                return Ok(RuntimeServiceActionOutcome {
                    state: RuntimeServiceState::Running,
                    release_id: None,
                    reason_code: None,
                    retryable: false,
                });
            }
            return Err(untrusted());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

fn source_runtime_pipe_exists() -> Result<bool, ProtectedCarrierError> {
    let user_sid = crate::windows_peer_trust::current_user_sid()?;
    let name =
        source_pipe_name(&user_sid, WindowsSourcePipeRole::Desktop).map_err(|_| untrusted())?;
    let wide = OsStr::new(&name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe { WaitNamedPipeW(wide.as_ptr(), 1) } != 0 {
        return Ok(true);
    }
    let error = unsafe { GetLastError() };
    if error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND {
        return Ok(false);
    }
    // A busy current-user pipe still proves the endpoint is published; exact
    // peer verification remains mandatory before any protected operation.
    Ok(true)
}
