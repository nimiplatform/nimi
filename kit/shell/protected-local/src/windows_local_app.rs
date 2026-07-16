mod agent;
mod artifact;
mod permission;
mod projection;
mod storage;
mod voice;

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use tokio::sync::Mutex;
use tonic::transport::Channel;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::OpenLocalAppSessionRequest;
use crate::grpc_status::local_app_error_from_status;
use crate::windows_peer_trust::VerifiedRuntimePeer;
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    LocalAppAgentConversationSnapshotRequest, LocalAppAgentInventoryRequest,
    LocalAppAgentOpenConversationRequest, LocalAppAgentProjection, LocalAppAgentSendTurnRequest,
    LocalAppAgentSubscribeTurnRequest, LocalAppAgentSubscribeVoiceStreamRequest,
    LocalAppAgentTranscribeVoiceRequest, LocalAppAgentVoiceStreamPage,
    LocalAppAgentVoiceTranscription, LocalAppArtifactBytes, LocalAppArtifactReadRequest,
    LocalAppOperationError, LocalAppPermissionPosture, LocalAppPermissionPostureRequest,
    LocalAppPermissionRequest, LocalAppReasonCode, LocalAppSessionState, LocalAppSessionStatus,
    LocalAppStorageDocument, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageRemoveResult, LocalAppStorageWriteRequest, NimiLocalAppCarrier,
    NimiLocalAppSession,
};
use agent::TurnStreams;
use voice::VoiceStreams;

#[cfg(not(feature = "windows-e2e-fixture"))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-local-app-v1";
#[cfg(feature = "windows-e2e-fixture")]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-e2e-local-app-v1";

const ACTION_EXECUTED: i32 = 1;
const LOCAL_APP_SESSION_READY: i32 = 1;
const LOCAL_APP_TRUST_LOCAL_DEVELOPMENT: i32 = 3;

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsLocalAppCarrier;

struct WindowsLocalAppSession {
    channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    _runtime_boot_epoch: [u8; 32],
    turn_streams: TurnStreams,
    voice_streams: VoiceStreams,
}

impl NimiLocalAppSession for WindowsLocalAppSession {
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async {
            Ok(LocalAppSessionStatus {
                state: LocalAppSessionState::ZeroGrant,
                reason_code: LocalAppReasonCode::NoGrant,
                retryable: false,
            })
        })
    }

    fn permission_posture(
        &self,
        request: LocalAppPermissionPostureRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionPosture, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(permission::local_app_permission_posture(
            self.channel.clone(),
            request,
        ))
    }

    fn permission_request(
        &self,
        request: LocalAppPermissionRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionPosture, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(permission::request_local_app_permission(
            self.channel.clone(),
            request,
        ))
    }

    fn artifacts_read_runtime_bytes(
        &self,
        request: LocalAppArtifactReadRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppArtifactBytes, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(artifact::read_local_app_artifact(
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

    fn agent_open_conversation(
        &self,
        request: LocalAppAgentOpenConversationRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(agent::open_local_app_conversation(
            self.channel.clone(),
            request,
        ))
    }

    fn agent_inventory(
        &self,
        request: LocalAppAgentInventoryRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(agent::list_local_app_agent_inventory(
            self.channel.clone(),
            request,
        ))
    }

    fn agent_send_turn(
        &self,
        request: LocalAppAgentSendTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(agent::send_local_app_turn(self.channel.clone(), request))
    }

    fn agent_subscribe_turn(
        &self,
        request: LocalAppAgentSubscribeTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(agent::subscribe_local_app_turn(
            self.channel.clone(),
            &self.turn_streams,
            request,
        ))
    }

    fn agent_get_conversation_snapshot(
        &self,
        request: LocalAppAgentConversationSnapshotRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(agent::get_local_app_conversation_snapshot(
            self.channel.clone(),
            request,
        ))
    }

    fn agent_transcribe_voice(
        &self,
        request: LocalAppAgentTranscribeVoiceRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentVoiceTranscription, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(voice::transcribe_local_app_agent_voice(
            self.channel.clone(),
            request,
        ))
    }

    fn agent_subscribe_voice_stream(
        &self,
        request: LocalAppAgentSubscribeVoiceStreamRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentVoiceStreamPage, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(voice::subscribe_local_app_agent_voice_stream(
            self.channel.clone(),
            &self.voice_streams,
            request,
        ))
    }
}

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
    Ok(Box::new(WindowsLocalAppSession {
        channel,
        _runtime_peer: runtime_peer,
        _runtime_boot_epoch: runtime_boot_epoch,
        turn_streams: Mutex::new(std::collections::HashMap::new()),
        voice_streams: Mutex::new(std::collections::HashMap::new()),
    }))
}

async fn open_local_app_runtime_channel(
) -> Result<(Channel, VerifiedRuntimePeer), crate::ProtectedCarrierError> {
    with_one_unavailable_retry(
        || open_verified_runtime_channel(RUNTIME_LOCAL_APP_PIPE_NAME),
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
