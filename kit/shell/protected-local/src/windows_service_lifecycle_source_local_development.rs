use std::ffi::OsStr;
use std::future::Future;
use std::os::windows::ffi::OsStrExt;
use std::pin::Pin;

use tonic::transport::Channel;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND};
use windows_sys::Win32::System::Pipes::WaitNamedPipeW;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;
use crate::generated::{OpenDesktopSessionRequest, RequestRuntimeRestartRequest};
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
    if before_epoch == [0u8; 32] {
        return Err(untrusted());
    }
    let mut control = RuntimeServiceControlServiceClient::new(channel);
    match control
        .request_runtime_restart(RequestRuntimeRestartRequest {})
        .await
    {
        Ok(response) if !response.into_inner().accepted => return Err(untrusted()),
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
        if let Ok((after_channel, _runtime_peer)) =
            open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await
        {
            let mut auth = RuntimeAuthServiceClient::new(after_channel);
            if let Ok(response) = auth
                .open_desktop_session(OpenDesktopSessionRequest {})
                .await
            {
                let after_epoch: [u8; 32] = response
                    .into_inner()
                    .runtime_boot_epoch
                    .try_into()
                    .map_err(|_| untrusted())?;
                if after_epoch != [0u8; 32] && after_epoch != before_epoch {
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
