mod permission;
mod storage;

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use tonic::transport::Channel;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::OpenLocalAppSessionRequest;
use crate::grpc_status::local_app_error_from_status;
#[cfg(target_os = "macos")]
use crate::macos_peer_trust::VerifiedMacOSRuntimePeer;
#[cfg(target_os = "macos")]
use crate::macos_service_control::open_verified_local_app_runtime_channel;
#[cfg(target_os = "windows")]
use crate::windows_peer_trust::VerifiedRuntimePeer;
#[cfg(target_os = "windows")]
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    LocalAppOperationError, LocalAppPermissionRequest, LocalAppPermissionStatus,
    LocalAppPermissionStatusRequest, LocalAppReasonCode, LocalAppSessionState,
    LocalAppSessionStatus, LocalAppStorageDocument, LocalAppStorageReadRequest,
    LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult, LocalAppStorageWriteRequest,
    NimiLocalAppCarrier, NimiLocalAppSession,
};

#[cfg(all(target_os = "windows", not(feature = "windows-e2e-fixture")))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-local-app-v1";
#[cfg(all(target_os = "windows", feature = "windows-e2e-fixture"))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-e2e-local-app-v1";

const ACTION_EXECUTED: i32 = 1;
const LOCAL_APP_SESSION_READY: i32 = 1;
const LOCAL_APP_TRUST_LOCAL_DEVELOPMENT: i32 = 3;

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsLocalAppCarrier;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsLocalAppCarrier;

#[cfg(target_os = "windows")]
type PlatformRuntimePeer = VerifiedRuntimePeer;
#[cfg(target_os = "macos")]
type PlatformRuntimePeer = VerifiedMacOSRuntimePeer;

struct PlatformLocalAppSession {
    channel: Channel,
    _runtime_peer: PlatformRuntimePeer,
    _runtime_boot_epoch: [u8; 32],
}

impl NimiLocalAppSession for PlatformLocalAppSession {
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async {
            Ok(LocalAppSessionStatus {
                state: LocalAppSessionState::Ready,
                reason_code: LocalAppReasonCode::ActionExecuted,
                retryable: false,
            })
        })
    }

    fn permission_status(
        &self,
        request: LocalAppPermissionStatusRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionStatus, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(permission::local_app_permission_status(
            self.channel.clone(),
            request,
        ))
    }

    fn permission_request(
        &self,
        request: LocalAppPermissionRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionStatus, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(permission::request_local_app_permission(
            self.channel.clone(),
            request,
        ))
    }

    fn storage_read_json(
        &self,
        request: LocalAppStorageReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageDocument, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(storage::read_local_app_storage_json(
            self.channel.clone(),
            request,
        ))
    }

    fn storage_write_json(
        &self,
        request: LocalAppStorageWriteRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageDocument, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(storage::write_local_app_storage_json(
            self.channel.clone(),
            request,
        ))
    }

    fn storage_remove_json(
        &self,
        request: LocalAppStorageRemoveRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageRemoveResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(storage::remove_local_app_storage_json(
            self.channel.clone(),
            request,
        ))
    }
}

#[cfg(target_os = "windows")]
impl NimiLocalAppCarrier for WindowsLocalAppCarrier {
    fn open_local_app_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(open_local_app_session())
    }
}

#[cfg(target_os = "macos")]
impl NimiLocalAppCarrier for MacOsLocalAppCarrier {
    fn open_local_app_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(open_local_app_session())
    }
}

async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let (channel, runtime_peer) = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let response = RuntimeAuthServiceClient::new(channel.clone())
        .open_local_app_session(OpenLocalAppSessionRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.state != LOCAL_APP_SESSION_READY
        || response.trust_class != LOCAL_APP_TRUST_LOCAL_DEVELOPMENT
        || response.account_generation == 0
        || response.reason_code != ACTION_EXECUTED
    {
        return Err(untrusted());
    }
    let runtime_boot_epoch: [u8; 32] = response
        .runtime_boot_epoch
        .try_into()
        .map_err(|_| untrusted())?;
    if runtime_boot_epoch == [0u8; 32] {
        return Err(untrusted());
    }
    Ok(Box::new(PlatformLocalAppSession {
        channel,
        _runtime_peer: runtime_peer,
        _runtime_boot_epoch: runtime_boot_epoch,
    }))
}

#[cfg(target_os = "windows")]
async fn open_local_app_runtime_channel(
) -> Result<(Channel, VerifiedRuntimePeer), crate::ProtectedCarrierError> {
    with_one_unavailable_retry(
        || open_verified_runtime_channel(RUNTIME_LOCAL_APP_PIPE_NAME),
        Duration::from_millis(100),
    )
    .await
}

#[cfg(target_os = "macos")]
async fn open_local_app_runtime_channel(
) -> Result<(Channel, VerifiedMacOSRuntimePeer), crate::ProtectedCarrierError> {
    with_one_unavailable_retry(
        open_verified_local_app_runtime_channel,
        Duration::from_millis(100),
    )
    .await
}

async fn with_one_unavailable_retry<T, F, Fut>(
    mut open: F,
    retry_delay: Duration,
) -> Result<T, crate::ProtectedCarrierError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, crate::ProtectedCarrierError>>,
{
    match open().await {
        Ok(value) => Ok(value),
        Err(error)
            if error.reason_code()
                == crate::ProtectedCarrierReasonCode::RuntimeServiceUnavailable
                && error.retryable() =>
        {
            tokio::time::sleep(retry_delay).await;
            open().await
        }
        Err(error) => Err(error),
    }
}

pub(super) fn require_text(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() || value.trim() != value {
        return Err(invalid_payload());
    }
    Ok(())
}

fn local_app_error_from_protected(error: crate::ProtectedCarrierError) -> LocalAppOperationError {
    let reason = match error.reason_code() {
        crate::ProtectedCarrierReasonCode::ProtectedCarrierRequired => {
            LocalAppReasonCode::ProtectedCarrierRequired
        }
        crate::ProtectedCarrierReasonCode::RuntimeServiceUnavailable => {
            LocalAppReasonCode::RuntimeServiceUnavailable
        }
        crate::ProtectedCarrierReasonCode::RuntimeServiceUntrusted => {
            LocalAppReasonCode::RuntimeServiceUntrusted
        }
        crate::ProtectedCarrierReasonCode::RuntimeServiceRepairRequired => {
            LocalAppReasonCode::RuntimeServiceRepairRequired
        }
    };
    LocalAppOperationError::new(reason, error.retryable())
}

pub(super) fn invalid_payload() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false)
}

pub(super) fn untrusted() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[tokio::test]
    async fn local_app_channel_retries_one_exact_unavailable_handshake() {
        let mut outcomes = VecDeque::from([
            Err(crate::ProtectedCarrierError::new(
                crate::ProtectedCarrierReasonCode::RuntimeServiceUnavailable,
                true,
            )),
            Ok(7u8),
        ]);
        let result = with_one_unavailable_retry(
            || std::future::ready(outcomes.pop_front().expect("bounded outcome")),
            Duration::ZERO,
        )
        .await
        .expect("one unavailable retry");
        assert_eq!(result, 7);
        assert!(outcomes.is_empty());
    }

    #[tokio::test]
    async fn local_app_channel_never_retries_untrusted_failures() {
        let mut calls = 0;
        let error = with_one_unavailable_retry(
            || {
                calls += 1;
                std::future::ready(Err::<u8, _>(crate::ProtectedCarrierError::new(
                    crate::ProtectedCarrierReasonCode::RuntimeServiceUntrusted,
                    false,
                )))
            },
            Duration::ZERO,
        )
        .await
        .expect_err("untrusted failure");
        assert_eq!(calls, 1);
        assert_eq!(
            error.reason_code(),
            crate::ProtectedCarrierReasonCode::RuntimeServiceUntrusted
        );
    }
}
