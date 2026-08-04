mod app_ai_config;
mod artifact;
mod configure;
mod conversation;
mod permission;
mod realm_world_core;
mod storage;
mod text_candidate;

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use tokio::sync::RwLock;
use tonic::transport::Channel;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::{OpenLocalAppSessionRequest, RenewLocalAppSessionRequest};
use crate::grpc_status::local_app_error_from_status;
#[cfg(target_os = "macos")]
use crate::macos_service_control::open_verified_local_app_runtime_channel;
#[cfg(target_os = "windows")]
use crate::windows_peer_trust::VerifiedRuntimePeer;
#[cfg(target_os = "windows")]
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    LocalAppAIConfigOverwriteRequest, LocalAppAgentAIProfileApplyRequest,
    LocalAppAgentAIProfilePreviewRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest, LocalAppAgentUpdateAutonomyRequest,
    LocalAppAgentUpdateConfigurationRequest, LocalAppArtifactPutRequest, LocalAppArtifactPutResult,
    LocalAppArtifactReadRequest, LocalAppArtifactReadResult, LocalAppConversationInterruptRequest,
    LocalAppConversationInterruptResult, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshotRequest,
    LocalAppConversationSubscribeRequest, LocalAppConversationSubscriptionReceiver,
    LocalAppOperationError, LocalAppPermissionRequest, LocalAppPermissionStatus,
    LocalAppPermissionStatusRequest, LocalAppReasonCode, LocalAppSessionState,
    LocalAppSessionStatus, LocalAppStorageDocument, LocalAppStorageReadRequest,
    LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult, LocalAppStorageWriteRequest,
    LocalAppTextCandidateRequest, LocalAppTextCandidateResult, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreListRequest, NimiLocalAppCarrier, NimiLocalAppSession,
};

#[cfg(target_os = "windows")]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-local-app-v1";

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

struct PlatformLocalAppSession {
    channel: Channel,
    #[cfg(target_os = "windows")]
    runtime_peer: PlatformRuntimePeer,
    account_generation: u64,
    #[cfg(target_os = "windows")]
    runtime_boot_epoch: [u8; 32],
    operation_gate: RwLock<()>,
}

impl PlatformLocalAppSession {
    fn checked_channel(&self) -> Result<Channel, LocalAppOperationError> {
        #[cfg(target_os = "windows")]
        let _ = &self.runtime_peer;
        Ok(self.channel.clone())
    }

    async fn renew_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let _renewal = self.operation_gate.write().await;
        let response = RuntimeAuthServiceClient::new(self.checked_channel()?)
            .renew_local_app_session(RenewLocalAppSessionRequest {})
            .await
            .map_err(local_app_error_from_status)?
            .into_inner();
        #[cfg(target_os = "windows")]
        let (account_generation, runtime_boot_epoch) = validate_session_projection(response)?;
        #[cfg(target_os = "macos")]
        let account_generation = validate_session_projection(response)?;
        if account_generation != self.account_generation {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::AccountChanged,
                false,
            ));
        }
        #[cfg(target_os = "windows")]
        if runtime_boot_epoch != self.runtime_boot_epoch {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::RuntimeRestarted,
                true,
            ));
        }
        Ok(ready_session_status())
    }
}

impl NimiLocalAppSession for PlatformLocalAppSession {
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            self.checked_channel()?;
            Ok(ready_session_status())
        })
    }

    fn renew_technical_session(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(self.renew_session())
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
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            permission::local_app_permission_status(self.checked_channel()?, request).await
        })
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
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            permission::request_local_app_permission(self.checked_channel()?, request).await
        })
    }

    fn generate_text_candidate(
        &self,
        request: LocalAppTextCandidateRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppTextCandidateResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            text_candidate::generate(self.checked_channel()?, request).await
        })
    }

    fn app_ai_config_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_ai_config::get(self.checked_channel()?).await
        })
    }

    fn app_ai_config_overwrite(
        &self,
        request: LocalAppAIConfigOverwriteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_ai_config::overwrite(self.checked_channel()?, request).await
        })
    }

    fn realm_world_core_list(
        &self,
        request: LocalAppWorldCoreListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::list(self.checked_channel()?, request).await
        })
    }

    fn realm_world_core_create(
        &self,
        request: LocalAppWorldCoreCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::create(self.checked_channel()?, request).await
        })
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
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::read_local_app_storage_json(self.checked_channel()?, request).await
        })
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
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::write_local_app_storage_json(self.checked_channel()?, request).await
        })
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
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::remove_local_app_storage_json(self.checked_channel()?, request).await
        })
    }

    fn conversation_open(
        &self,
        request: LocalAppConversationOpenRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationOpenResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::open_conversation(self.checked_channel()?, request).await
        })
    }

    fn conversation_send_turn(
        &self,
        request: LocalAppConversationSendRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationSendResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::send_turn(self.checked_channel()?, request).await
        })
    }

    fn conversation_interrupt_turn(
        &self,
        request: LocalAppConversationInterruptRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationInterruptResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::interrupt_turn(self.checked_channel()?, request).await
        })
    }

    fn conversation_subscribe(
        &self,
        request: LocalAppConversationSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationSubscriptionReceiver,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::subscribe(self.checked_channel()?, request).await
        })
    }

    fn conversation_snapshot(
        &self,
        request: LocalAppConversationSnapshotRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::conversation_snapshot(self.checked_channel()?, request).await
        })
    }

    fn artifact_put(
        &self,
        request: LocalAppArtifactPutRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppArtifactPutResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            artifact::put_artifact(self.checked_channel()?, request).await
        })
    }

    fn artifact_read_bytes(
        &self,
        request: LocalAppArtifactReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppArtifactReadResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            artifact::read_artifact_bytes(self.checked_channel()?, request).await
        })
    }

    fn agent_configuration_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::configuration_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_update_configuration(
        &self,
        request: LocalAppAgentUpdateConfigurationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::update_configuration(self.checked_channel()?, request).await
        })
    }

    fn agent_readiness_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::readiness_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_ai_profile_preview(
        &self,
        request: LocalAppAgentAIProfilePreviewRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::ai_profile_preview(self.checked_channel()?, request).await
        })
    }

    fn agent_ai_profile_apply(
        &self,
        request: LocalAppAgentAIProfileApplyRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::ai_profile_apply(self.checked_channel()?, request).await
        })
    }

    fn agent_autonomy_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::autonomy_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_update_autonomy(
        &self,
        request: LocalAppAgentUpdateAutonomyRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::update_autonomy(self.checked_channel()?, request).await
        })
    }

    fn agent_presentation_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::presentation_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_commit_presentation(
        &self,
        request: LocalAppAgentCommitPresentationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            configure::commit_presentation(self.checked_channel()?, request).await
        })
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

#[cfg(target_os = "windows")]
async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let (channel, runtime_peer) = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let response = RuntimeAuthServiceClient::new(channel.clone())
        .open_local_app_session(OpenLocalAppSessionRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (account_generation, runtime_boot_epoch) = validate_session_projection(response)?;
    Ok(Box::new(PlatformLocalAppSession {
        channel,
        runtime_peer,
        account_generation,
        runtime_boot_epoch,
        operation_gate: RwLock::new(()),
    }))
}

#[cfg(target_os = "macos")]
async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let channel = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let response = RuntimeAuthServiceClient::new(channel.clone())
        .open_local_app_session(OpenLocalAppSessionRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let account_generation = validate_session_projection(response)?;
    Ok(Box::new(PlatformLocalAppSession {
        channel,
        account_generation,
        operation_gate: RwLock::new(()),
    }))
}

fn ready_session_status() -> LocalAppSessionStatus {
    LocalAppSessionStatus {
        state: LocalAppSessionState::Ready,
        reason_code: LocalAppReasonCode::ActionExecuted,
        retryable: false,
    }
}

#[cfg(target_os = "windows")]
fn validate_session_projection(
    response: crate::generated::OpenLocalAppSessionResponse,
) -> Result<(u64, [u8; 32]), LocalAppOperationError> {
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
    Ok((response.account_generation, runtime_boot_epoch))
}

#[cfg(target_os = "macos")]
fn validate_session_projection(
    response: crate::generated::OpenLocalAppSessionResponse,
) -> Result<u64, LocalAppOperationError> {
    if response.state != LOCAL_APP_SESSION_READY
        || response.trust_class != LOCAL_APP_TRUST_LOCAL_DEVELOPMENT
        || response.account_generation == 0
        || response.reason_code != ACTION_EXECUTED
    {
        return Err(untrusted());
    }
    Ok(response.account_generation)
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
async fn open_local_app_runtime_channel() -> Result<Channel, crate::ProtectedCarrierError> {
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
