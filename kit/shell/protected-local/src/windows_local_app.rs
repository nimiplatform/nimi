mod agent_configure;
mod agent_work;
mod app_activity;
mod app_ai_config;
mod avatar_host_target;
mod conversation;
mod embodiment;
mod integration;
mod music_input;
mod realm_persona_character;
mod realm_realtime;
mod realm_world_core;
mod realtime;
mod reference;
mod scenario;
#[cfg(all(test, target_os = "macos"))]
mod session_rebind_tests;
mod shared_agent_ai_config;
mod storage;
mod text_behavior;
mod text_candidate;
mod video_session;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, RwLock};
use tonic::transport::Channel;

use crate::generated::{
    OpenLocalAppSessionRequest, RebindLocalAppSessionRequest, RenewLocalAppSessionRequest,
};
use crate::grpc_status::local_app_error_from_status;
#[cfg(target_os = "macos")]
use crate::macos_service_control::open_verified_local_app_runtime_channel;
#[cfg(target_os = "windows")]
use crate::windows_peer_trust::VerifiedRuntimePeer;
#[cfg(all(
    target_os = "windows",
    not(feature = "windows-source-local-development")
))]
use crate::windows_service_control::open_verified_runtime_channel;
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
use crate::windows_service_control::{open_verified_runtime_channel, SOURCE_LOCAL_APP_PIPE_REF};
use crate::{
    LocalAppAIConfigLocalOptionsRequest, LocalAppAIConfigOverwriteRequest,
    LocalAppActivityListRequest, LocalAppActivityMarkReadRequest, LocalAppActivityOpenRequest,
    LocalAppActivityOpenRequestCompleteRequest, LocalAppActivityPutRequest,
    LocalAppActivitySubscribeRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest, LocalAppAgentManagerSnapshotRequest,
    LocalAppAgentMemoryCorrectRequest, LocalAppAgentMemoryDeleteRequest,
    LocalAppAgentMemoryForgetRequest, LocalAppAgentMemoryInspectRequest,
    LocalAppAgentMemorySwitchRequest, LocalAppAgentPresentationAssetReadRequest,
    LocalAppAgentRealtimeAppendInputRequest, LocalAppAgentRealtimeOpenRequest,
    LocalAppAgentRealtimeOutputInterruptRequest, LocalAppAgentRealtimeSessionRequest,
    LocalAppAgentReference, LocalAppAgentUpdateAutonomyRequest,
    LocalAppAiRealtimeAppendInputRequest, LocalAppAiRealtimeOpenRequest,
    LocalAppAiRealtimeOutputInterruptRequest, LocalAppAiRealtimeOwnerControlRequest,
    LocalAppAiRealtimeSessionRequest, LocalAppAssetAdoptRequest, LocalAppAssetListRequest,
    LocalAppAssetListResult, LocalAppAssetMoveRequest, LocalAppAssetReadRequest,
    LocalAppAssetReadResult, LocalAppAssetRecord, LocalAppAssetRemoveRequest,
    LocalAppAssetRemoveResult, LocalAppAssetRevealRequest, LocalAppAssetRevealTarget,
    LocalAppAssetStatRequest, LocalAppAssetWriteReceiver, LocalAppAssetWriteRequest,
    LocalAppAvatarHostTargetResolveRequest, LocalAppAvatarHostTargetResolveResult,
    LocalAppConversationArtifactReadRequest, LocalAppConversationArtifactReadResult,
    LocalAppConversationAttachmentUploadRequest, LocalAppConversationAttachmentUploadResult,
    LocalAppConversationInterruptRequest, LocalAppConversationInterruptResult,
    LocalAppConversationOpenRequest, LocalAppConversationOpenResult,
    LocalAppConversationSendRequest, LocalAppConversationSendResult, LocalAppConversationSnapshot,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver, LocalAppConversationVoiceRenderRequest,
    LocalAppConversationVoiceRenderResult, LocalAppConversationVoiceTranscriptionRequest,
    LocalAppConversationVoiceTranscriptionResult, LocalAppCurrentUserDisplay,
    LocalAppCurrentUserStatus, LocalAppEmbodimentSnapshotRequest,
    LocalAppEmbodimentSubscribeRequest, LocalAppOperationError,
    LocalAppPersonaCharacterCreateRequest, LocalAppPersonaCharacterDeleteRequest,
    LocalAppPersonaCharacterGetOwnedRequest, LocalAppPersonaCharacterListOwnedRequest,
    LocalAppPersonaCharacterReplaceRequest, LocalAppRealmChatListRequest,
    LocalAppRealmRealtimeAckRequest, LocalAppRealmRealtimeChannelRequest,
    LocalAppRealmRealtimeOpenRequest, LocalAppRealmRealtimeSubscribeRequest,
    LocalAppRealmRealtimeSubscriptionRequest, LocalAppRealtimeSubscriptionReceiver,
    LocalAppReasonCode, LocalAppScenarioCancelRequest, LocalAppScenarioExecuteRequest,
    LocalAppScenarioGetRequest, LocalAppScenarioJobSubscribeRequest,
    LocalAppScenarioListVoiceAssetsRequest, LocalAppScenarioReadArtifactRequest,
    LocalAppScenarioStreamReceiver, LocalAppScenarioSubmitRequest,
    LocalAppScenarioUploadArtifactRequest, LocalAppSessionState, LocalAppSessionStatus,
    LocalAppSharedAgentAIConfigLocalOptionsRequest, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppStorageDocument, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageRemoveResult, LocalAppStorageWriteRequest, LocalAppTextCandidateRequest,
    LocalAppTextCandidateResult, LocalAppTextTurnRequest, LocalAppWorldCharacterCreateRequest,
    LocalAppWorldCharacterGetRequest, LocalAppWorldCharacterListRequest,
    LocalAppWorldCharacterReplaceRequest, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreGetRequest, LocalAppWorldCoreListRequest, LocalAppWorldCoreReplaceRequest,
    LocalAppWorldEntityCreateRequest, LocalAppWorldEntityGetRequest,
    LocalAppWorldEntityListRequest, LocalAppWorldRelationshipGetRequest,
    LocalAppWorldRelationshipListRequest, NimiLocalAppCarrier, NimiLocalAppSession,
};

#[cfg(all(
    target_os = "windows",
    not(feature = "windows-source-local-development")
))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-local-app-v1";
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = SOURCE_LOCAL_APP_PIPE_REF;

const ACTION_EXECUTED: i32 = 1;
const LOCAL_APP_SESSION_READY: i32 = 1;
const CURRENT_USER_DISPLAY_UNAVAILABLE: i32 = 710;

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsLocalAppCarrier;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsLocalAppCarrier;

#[cfg(target_os = "windows")]
type PlatformRuntimePeer = Arc<VerifiedRuntimePeer>;

struct PlatformLocalAppSession {
    channel: Channel,
    #[cfg(target_os = "windows")]
    runtime_peer: PlatformRuntimePeer,
    operation_gate: RwLock<()>,
    session_maintenance: Mutex<()>,
    session_bound: AtomicBool,
    account_required: AtomicBool,
    retired: AtomicBool,
    current_user: RwLock<LocalAppCurrentUserStatus>,
}

impl PlatformLocalAppSession {
    fn transport_channel(&self) -> Result<Channel, LocalAppOperationError> {
        #[cfg(target_os = "windows")]
        if !self.runtime_peer.running() {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::RuntimeServiceUnavailable,
                true,
            ));
        }
        Ok(self.channel.clone())
    }

    fn checked_channel(&self) -> Result<Channel, LocalAppOperationError> {
        if !self.session_bound.load(Ordering::Acquire)
            || self.account_required.load(Ordering::Acquire)
            || self.retired.load(Ordering::Acquire)
        {
            return Err(runtime_unauthenticated());
        }
        self.transport_channel()
    }

    async fn store_ready_status(&self, status: &LocalAppSessionStatus) {
        *self.current_user.write().await = status.current_user.clone();
        self.session_bound.store(true, Ordering::Release);
        self.account_required.store(false, Ordering::Release);
    }

    fn record_session_error(&self, error: &LocalAppOperationError) {
        if matches!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeUnauthenticated
                | LocalAppReasonCode::AccountChanged
                | LocalAppReasonCode::Revoked
                | LocalAppReasonCode::ProjectChanged
        ) {
            // Binding is monotonic on this transport. Invalidating a bound
            // scope never turns its channel back into a bootstrap channel.
            self.account_required.store(true, Ordering::Release);
        }
    }

    async fn open_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let _maintenance = self.session_maintenance.lock().await;
        let _opening = self.operation_gate.write().await;
        if self.session_bound.load(Ordering::Acquire) {
            self.checked_channel()?;
            return Ok(ready_session_status(self.current_user.read().await.clone()));
        }
        let response = crate::grpc_limits::runtime_auth_client(self.transport_channel()?)
            .open_local_app_session(OpenLocalAppSessionRequest {})
            .await
            .map_err(local_app_error_from_status);
        let response = match response {
            Ok(response) => response.into_inner(),
            Err(error) => {
                self.record_session_error(&error);
                return Err(error);
            }
        };
        let status = validate_session_projection(response)?;
        self.store_ready_status(&status).await;
        Ok(status)
    }

    // @nimi-authority: rule.nimi.runtime.protected-session.r016
    async fn renew_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        // Renewal revalidates the same context; it must not wait for a caller
        // to finish a streaming body or prevent that caller's other reads.
        let _maintenance = self.session_maintenance.lock().await;
        let _renewal = self.operation_gate.read().await;
        let response = crate::grpc_limits::runtime_auth_client(self.checked_channel()?)
            .renew_local_app_session(RenewLocalAppSessionRequest {})
            .await
            .map_err(local_app_error_from_status);
        let response = match response {
            Ok(response) => response.into_inner(),
            Err(error) => {
                self.record_session_error(&error);
                return Err(error);
            }
        };
        let status = validate_session_projection(response)?;
        self.store_ready_status(&status).await;
        Ok(status)
    }

    async fn refresh_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        if self.session_bound.load(Ordering::Acquire) {
            self.renew_session().await
        } else {
            self.open_session().await
        }
    }

    async fn rebind_session(&self) -> Result<crate::LocalAppSessionRebind, LocalAppOperationError> {
        // No old Arc or deferred future may acquire authority again. The new
        // view below shares only the verified transport, never this gate.
        self.retired.store(true, Ordering::Release);
        let _maintenance = self.session_maintenance.lock().await;
        // Drain old unary requests (including tonic readiness queues) before
        // Runtime can interpret any new request as belonging to the new scope.
        let _rebind = self.operation_gate.write().await;
        if !self.session_bound.load(Ordering::Acquire) {
            return Err(runtime_unauthenticated());
        }
        let response = crate::grpc_limits::runtime_auth_client(self.transport_channel()?)
            .rebind_local_app_session(RebindLocalAppSessionRequest {})
            .await
            .map_err(local_app_error_from_status);
        let response = match response {
            Ok(response) => response.into_inner(),
            Err(error) => {
                self.record_session_error(&error);
                return Err(error);
            }
        };
        let status = validate_session_projection(response)?;
        let session = Self {
            channel: self.channel.clone(),
            #[cfg(target_os = "windows")]
            runtime_peer: self.runtime_peer.clone(),
            operation_gate: RwLock::new(()),
            session_maintenance: Mutex::new(()),
            session_bound: AtomicBool::new(true),
            account_required: AtomicBool::new(false),
            retired: AtomicBool::new(false),
            current_user: RwLock::new(status.current_user.clone()),
        };
        Ok(crate::LocalAppSessionRebind {
            status,
            session: Box::new(session),
        })
    }
}

impl NimiLocalAppSession for PlatformLocalAppSession {
    fn can_retry_initial_bootstrap(&self) -> bool {
        !self.session_bound.load(Ordering::Acquire)
    }
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            if !self.session_bound.load(Ordering::Acquire)
                || self.account_required.load(Ordering::Acquire)
            {
                return self.refresh_session().await;
            }
            let _operation = self.operation_gate.read().await;
            self.checked_channel()?;
            let current_user = self.current_user.read().await.clone();
            Ok(ready_session_status(current_user))
        })
    }

    fn renew_technical_session(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(self.refresh_session())
    }

    fn rebind_technical_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<crate::LocalAppSessionRebind, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(self.rebind_session())
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

    fn stream_text_turn(
        &self,
        request: LocalAppTextTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppScenarioStreamReceiver, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::stream_text_turn(self.checked_channel()?, request).await
        })
    }

    fn execute_scenario(
        &self,
        request: LocalAppScenarioExecuteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::execute(self.checked_channel()?, request).await
        })
    }

    fn submit_scenario_job(
        &self,
        request: LocalAppScenarioSubmitRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::submit_job(self.checked_channel()?, request).await
        })
    }

    fn get_scenario_job(
        &self,
        request: LocalAppScenarioGetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::get_job(self.checked_channel()?, request).await
        })
    }

    fn subscribe_scenario_job(
        &self,
        request: LocalAppScenarioJobSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppScenarioStreamReceiver, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::subscribe_job(self.checked_channel()?, request).await
        })
    }

    fn cancel_scenario_job(
        &self,
        request: LocalAppScenarioCancelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::cancel_job(self.checked_channel()?, request).await
        })
    }

    fn read_scenario_artifact(
        &self,
        request: LocalAppScenarioReadArtifactRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::read_artifact(self.checked_channel()?, request).await
        })
    }

    fn upload_scenario_artifact(
        &self,
        request: LocalAppScenarioUploadArtifactRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::upload_artifact(self.checked_channel()?, request).await
        })
    }

    fn list_scenario_voice_assets(
        &self,
        request: LocalAppScenarioListVoiceAssetsRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            scenario::list_voice_assets(self.checked_channel()?, request).await
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

    fn app_ai_config_local_options(
        &self,
        request: LocalAppAIConfigLocalOptionsRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_ai_config::list_local_options(self.checked_channel()?, request).await
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

    fn realm_world_creation_eligibility_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::creation_eligibility(self.checked_channel()?).await
        })
    }

    fn realm_world_core_get(
        &self,
        request: LocalAppWorldCoreGetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::get(self.checked_channel()?, request).await
        })
    }

    fn realm_world_core_replace(
        &self,
        request: LocalAppWorldCoreReplaceRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::replace(self.checked_channel()?, request).await
        })
    }

    fn realm_world_character_list(
        &self,
        request: LocalAppWorldCharacterListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::list_characters(self.checked_channel()?, request).await
        })
    }

    fn realm_world_character_get(
        &self,
        request: LocalAppWorldCharacterGetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::get_character(self.checked_channel()?, request).await
        })
    }

    fn realm_world_character_create(
        &self,
        request: LocalAppWorldCharacterCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::create_character(self.checked_channel()?, request).await
        })
    }

    fn realm_world_character_replace(
        &self,
        request: LocalAppWorldCharacterReplaceRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::replace_character(self.checked_channel()?, request).await
        })
    }

    fn realm_world_entity_list(
        &self,
        request: LocalAppWorldEntityListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::list_entities(self.checked_channel()?, request).await
        })
    }

    fn realm_world_entity_get(
        &self,
        request: LocalAppWorldEntityGetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::get_entity(self.checked_channel()?, request).await
        })
    }

    fn realm_world_entity_create(
        &self,
        request: LocalAppWorldEntityCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::create_entity(self.checked_channel()?, request).await
        })
    }

    fn realm_world_relationship_list(
        &self,
        request: LocalAppWorldRelationshipListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::list_relationships(self.checked_channel()?, request).await
        })
    }

    fn realm_world_relationship_get(
        &self,
        request: LocalAppWorldRelationshipGetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::get_relationship(self.checked_channel()?, request).await
        })
    }

    fn realm_persona_character_list_owned(
        &self,
        request: LocalAppPersonaCharacterListOwnedRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_persona_character::list_owned(self.checked_channel()?, request).await
        })
    }

    fn realm_persona_character_get_owned(
        &self,
        request: LocalAppPersonaCharacterGetOwnedRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_persona_character::get_owned(self.checked_channel()?, request).await
        })
    }

    fn realm_persona_character_create(
        &self,
        request: LocalAppPersonaCharacterCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_persona_character::create(self.checked_channel()?, request).await
        })
    }

    fn realm_persona_character_replace(
        &self,
        request: LocalAppPersonaCharacterReplaceRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_persona_character::replace(self.checked_channel()?, request).await
        })
    }

    fn realm_persona_character_delete(
        &self,
        request: LocalAppPersonaCharacterDeleteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_persona_character::delete(self.checked_channel()?, request).await
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

    fn storage_asset_stat(
        &self,
        request: LocalAppAssetStatRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::stat_local_app_asset(self.checked_channel()?, request).await
        })
    }

    fn storage_asset_list(
        &self,
        request: LocalAppAssetListRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetListResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::list_local_app_assets(self.checked_channel()?, request).await
        })
    }

    fn storage_asset_write(
        &self,
        request: LocalAppAssetWriteRequest,
        body: LocalAppAssetWriteReceiver,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::write_local_app_asset(self.checked_channel()?, request, body).await
        })
    }

    fn storage_asset_read(
        &self,
        request: LocalAppAssetReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetReadResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::read_local_app_asset(self.checked_channel()?, request).await
        })
    }

    fn storage_asset_remove(
        &self,
        request: LocalAppAssetRemoveRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetRemoveResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::remove_local_app_asset(self.checked_channel()?, request).await
        })
    }

    fn storage_asset_move(
        &self,
        request: LocalAppAssetMoveRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::move_local_app_asset(self.checked_channel()?, request).await
        })
    }

    fn storage_asset_reveal(
        &self,
        request: LocalAppAssetRevealRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetRevealTarget, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::reveal_local_app_asset(self.checked_channel()?, request).await
        })
    }

    fn storage_asset_adopt(
        &self,
        request: LocalAppAssetAdoptRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::adopt_local_app_artifact(self.checked_channel()?, request).await
        })
    }

    fn agent_introduction_get(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>> {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            reference::introduction(self.checked_channel()?, request).await
        })
    }

    fn agent_reference_list(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalAppAgentReference>, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            reference::list(self.checked_channel()?).await
        })
    }

    fn avatar_host_target_resolve(
        &self,
        request: LocalAppAvatarHostTargetResolveRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppAvatarHostTargetResolveResult, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            avatar_host_target::resolve(self.checked_channel()?, request).await
        })
    }

    fn agent_work_reference_list(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::references(self.checked_channel()?, request).await
        })
    }
    fn agent_work_start(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::start(self.checked_channel()?, request).await
        })
    }
    fn agent_work_get(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::get(self.checked_channel()?, request).await
        })
    }
    fn agent_work_status(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::status(self.checked_channel()?, request).await
        })
    }
    fn agent_work_tool_calls_list(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::list_calls(self.checked_channel()?, request).await
        })
    }
    fn agent_work_tool_result_submit(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::submit_result(self.checked_channel()?, request).await
        })
    }
    fn agent_work_cancel(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::cancel(self.checked_channel()?, request).await
        })
    }
    fn agent_work_subscribe(
        &self,
        request: serde_json::Value,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_work::subscribe(self.checked_channel()?, request).await
        })
    }
    fn integration_list_catalog(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::list_catalog(self.checked_channel()?, request).await
        })
    }
    fn integration_list_connections(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::list_connections(self.checked_channel()?, request).await
        })
    }
    fn integration_invoke(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::invoke(self.checked_channel()?, request).await
        })
    }
    fn integration_get_call(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::get_call(self.checked_channel()?, request).await
        })
    }
    fn integration_list_calls(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::list_calls(self.checked_channel()?, request).await
        })
    }
    fn integration_cancel_call(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::cancel_call(self.checked_channel()?, request).await
        })
    }
    fn integration_register_provider(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::register_provider(self.checked_channel()?, request).await
        })
    }
    fn integration_unregister_provider(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::unregister_provider(self.checked_channel()?, request).await
        })
    }
    fn integration_poll_provider(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::poll_provider(self.checked_channel()?, request).await
        })
    }
    fn integration_complete_provider(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::complete_provider(self.checked_channel()?, request).await
        })
    }
    fn integration_get_management(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::get_management(self.checked_channel()?, request).await
        })
    }
    fn integration_put_connection(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::put_connection(self.checked_channel()?, request).await
        })
    }
    fn integration_remove_connection(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::remove_connection(self.checked_channel()?, request).await
        })
    }
    fn integration_set_permission(
        &self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            integration::set_permission(self.checked_channel()?, request).await
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

    fn conversation_attachment_upload(
        &self,
        request: LocalAppConversationAttachmentUploadRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationAttachmentUploadResult,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::upload_attachment(self.checked_channel()?, request).await
        })
    }

    fn conversation_artifact_read(
        &self,
        request: LocalAppConversationArtifactReadRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppConversationArtifactReadResult, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::read_artifact(self.checked_channel()?, request).await
        })
    }

    fn conversation_voice_transcribe(
        &self,
        request: LocalAppConversationVoiceTranscriptionRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationVoiceTranscriptionResult,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::transcribe_voice(self.checked_channel()?, request).await
        })
    }

    fn conversation_voice_render(
        &self,
        request: LocalAppConversationVoiceRenderRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppConversationVoiceRenderResult, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::render_voice(self.checked_channel()?, request).await
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
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationSnapshot, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::conversation_snapshot(self.checked_channel()?, request).await
        })
    }

    fn embodiment_snapshot(
        &self,
        request: LocalAppEmbodimentSnapshotRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.write().await;
            embodiment::snapshot(self.checked_channel()?, request).await
        })
    }

    fn embodiment_subscribe(
        &self,
        request: LocalAppEmbodimentSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            embodiment::subscribe(self.checked_channel()?, request).await
        })
    }

    fn activity_put(
        &self,
        request: LocalAppActivityPutRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::put(self.checked_channel()?, request).await
        })
    }

    fn activity_list(
        &self,
        request: LocalAppActivityListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::list(self.checked_channel()?, request).await
        })
    }

    fn activity_subscribe(
        &self,
        request: LocalAppActivitySubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::subscribe_changes(self.checked_channel()?, request).await
        })
    }

    fn activity_mark_read(
        &self,
        request: LocalAppActivityMarkReadRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::mark_read(self.checked_channel()?, request).await
        })
    }

    fn activity_open(
        &self,
        request: LocalAppActivityOpenRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::open(self.checked_channel()?, request).await
        })
    }

    fn activity_open_requests_subscribe(
        &self,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::subscribe_open_requests(self.checked_channel()?).await
        })
    }

    fn activity_open_request_complete(
        &self,
        request: LocalAppActivityOpenRequestCompleteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_activity::complete_open_request(self.checked_channel()?, request).await
        })
    }

    fn ai_realtime_open(
        &self,
        request: LocalAppAiRealtimeOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::ai_open(self.checked_channel()?, request).await
        })
    }

    fn video_session_open(
        &self,
        request: crate::LocalAppVideoSessionOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            video_session::open(self.checked_channel()?, request).await
        })
    }
    fn video_session_submit(
        &self,
        request: crate::LocalAppVideoSessionFrameRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            video_session::submit(self.checked_channel()?, request).await
        })
    }
    fn video_session_read(
        &self,
        request: crate::LocalAppVideoSessionScopeRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            video_session::read(self.checked_channel()?, request).await
        })
    }
    fn video_session_close(
        &self,
        request: crate::LocalAppVideoSessionScopeRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            video_session::close(self.checked_channel()?, request).await
        })
    }

    fn realm_chat_list(
        &self,
        request: LocalAppRealmChatListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_realtime::list_chats(self.checked_channel()?, request).await
        })
    }

    fn realm_realtime_open(
        &self,
        request: LocalAppRealmRealtimeOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_realtime::open(self.checked_channel()?, request).await
        })
    }

    fn realm_realtime_subscribe(
        &self,
        request: LocalAppRealmRealtimeSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_realtime::subscribe(self.checked_channel()?, request).await
        })
    }

    fn realm_realtime_ack(
        &self,
        request: LocalAppRealmRealtimeAckRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_realtime::ack(self.checked_channel()?, request).await
        })
    }

    fn realm_realtime_subscription_close(
        &self,
        request: LocalAppRealmRealtimeSubscriptionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_realtime::close_subscription(self.checked_channel()?, request).await
        })
    }

    fn realm_realtime_channel_close(
        &self,
        request: LocalAppRealmRealtimeChannelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_realtime::close_channel(self.checked_channel()?, request).await
        })
    }

    fn ai_realtime_append_input(
        &self,
        request: LocalAppAiRealtimeAppendInputRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::ai_append_input(self.checked_channel()?, request).await
        })
    }

    fn ai_realtime_submit_owner_control(
        &self,
        request: LocalAppAiRealtimeOwnerControlRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::ai_submit_owner_control(self.checked_channel()?, request).await
        })
    }

    fn ai_realtime_subscribe(
        &self,
        request: LocalAppAiRealtimeSessionRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::ai_subscribe(self.checked_channel()?, request).await
        })
    }

    fn ai_realtime_interrupt_output(
        &self,
        request: LocalAppAiRealtimeOutputInterruptRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::ai_interrupt_output(self.checked_channel()?, request).await
        })
    }

    fn ai_realtime_close(
        &self,
        request: LocalAppAiRealtimeSessionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::ai_close(self.checked_channel()?, request).await
        })
    }

    fn agent_realtime_open(
        &self,
        request: LocalAppAgentRealtimeOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::agent_open(self.checked_channel()?, request).await
        })
    }

    fn agent_realtime_append_input(
        &self,
        request: LocalAppAgentRealtimeAppendInputRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::agent_append_input(self.checked_channel()?, request).await
        })
    }

    fn agent_realtime_subscribe(
        &self,
        request: LocalAppAgentRealtimeSessionRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::agent_subscribe(self.checked_channel()?, request).await
        })
    }

    fn agent_realtime_status(
        &self,
        request: LocalAppAgentRealtimeSessionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::agent_status(self.checked_channel()?, request).await
        })
    }

    fn agent_realtime_interrupt_output(
        &self,
        request: LocalAppAgentRealtimeOutputInterruptRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::agent_interrupt_output(self.checked_channel()?, request).await
        })
    }

    fn agent_realtime_close(
        &self,
        request: LocalAppAgentRealtimeSessionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realtime::agent_close(self.checked_channel()?, request).await
        })
    }

    fn shared_agent_ai_config_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            shared_agent_ai_config::get(self.checked_channel()?).await
        })
    }

    fn shared_agent_ai_config_overwrite(
        &self,
        request: LocalAppSharedAgentAIConfigOverwriteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            shared_agent_ai_config::overwrite(self.checked_channel()?, request).await
        })
    }

    fn shared_agent_ai_config_local_options(
        &self,
        request: LocalAppSharedAgentAIConfigLocalOptionsRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            shared_agent_ai_config::list_local_options(self.checked_channel()?, request).await
        })
    }

    fn agent_manager_snapshot(
        &self,
        request: LocalAppAgentManagerSnapshotRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::manager_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_autonomy_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::autonomy_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_update_autonomy(
        &self,
        request: LocalAppAgentUpdateAutonomyRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::update_autonomy(self.checked_channel()?, request).await
        })
    }

    fn agent_presentation_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::presentation_snapshot(self.checked_channel()?, request).await
        })
    }

    fn agent_presentation_read_asset(
        &self,
        request: LocalAppAgentPresentationAssetReadRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::presentation_read_asset(self.checked_channel()?, request).await
        })
    }

    fn agent_commit_presentation(
        &self,
        request: LocalAppAgentCommitPresentationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::commit_presentation(self.checked_channel()?, request).await
        })
    }

    fn agent_memory_inspect(
        &self,
        request: LocalAppAgentMemoryInspectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::memory_inspect(self.checked_channel()?, request).await
        })
    }

    fn agent_memory_correct(
        &self,
        request: LocalAppAgentMemoryCorrectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::memory_correct(self.checked_channel()?, request).await
        })
    }

    fn agent_memory_forget(
        &self,
        request: LocalAppAgentMemoryForgetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::memory_forget(self.checked_channel()?, request).await
        })
    }

    fn agent_memory_switch(
        &self,
        request: LocalAppAgentMemorySwitchRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::memory_switch(self.checked_channel()?, request).await
        })
    }

    fn agent_memory_delete(
        &self,
        request: LocalAppAgentMemoryDeleteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            agent_configure::memory_delete(self.checked_channel()?, request).await
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
    let session = PlatformLocalAppSession {
        channel,
        runtime_peer: Arc::new(runtime_peer),
        operation_gate: RwLock::new(()),
        session_maintenance: Mutex::new(()),
        session_bound: AtomicBool::new(false),
        account_required: AtomicBool::new(false),
        retired: AtomicBool::new(false),
        current_user: RwLock::new(unavailable_current_user()),
    };
    if let Err(error) = session.open_session().await {
        if !retain_channel_for_account_required(&error) {
            return Err(transient_open_session_failure(error));
        }
    }
    Ok(Box::new(session))
}

#[cfg(target_os = "macos")]
async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let channel = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let session = PlatformLocalAppSession {
        channel,
        operation_gate: RwLock::new(()),
        session_maintenance: Mutex::new(()),
        session_bound: AtomicBool::new(false),
        account_required: AtomicBool::new(false),
        retired: AtomicBool::new(false),
        current_user: RwLock::new(unavailable_current_user()),
    };
    if let Err(error) = session.open_session().await {
        if !retain_channel_for_account_required(&error) {
            return Err(transient_open_session_failure(error));
        }
    }
    Ok(Box::new(session))
}

fn ready_session_status(current_user: LocalAppCurrentUserStatus) -> LocalAppSessionStatus {
    LocalAppSessionStatus {
        state: LocalAppSessionState::Ready,
        reason_code: LocalAppReasonCode::ActionExecuted,
        retryable: false,
        current_user,
    }
}

fn unavailable_current_user() -> LocalAppCurrentUserStatus {
    LocalAppCurrentUserStatus {
        value: None,
        reason_code: LocalAppReasonCode::CurrentUserDisplayUnavailable,
        retryable: true,
    }
}

fn retain_channel_for_account_required(error: &LocalAppOperationError) -> bool {
    error.reason_code() == LocalAppReasonCode::RuntimeUnauthenticated
}

// A failed session open on a freshly verified one-shot channel means the
// Runtime either closed its accept-side grant check or is still finishing its
// ready transition; both are transient because the supervisor renews the
// one-shot grant and the next open reconnects. Typed denials keep their exact
// fail-closed verdicts.
fn transient_open_session_failure(error: LocalAppOperationError) -> LocalAppOperationError {
    match error.reason_code() {
        LocalAppReasonCode::RuntimeServiceErrorUnclassified
        | LocalAppReasonCode::OperationUnavailable => {
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
        }
        _ => error,
    }
}

fn runtime_unauthenticated() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeUnauthenticated, false)
}

fn validate_session_projection(
    response: crate::generated::OpenLocalAppSessionResponse,
) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
    if response.state != LOCAL_APP_SESSION_READY || response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    let current_user = match (response.current_user, response.current_user_reason_code) {
        (Some(value), ACTION_EXECUTED) => {
            if !valid_current_user_text(&value.handle, 160)
                || !valid_current_user_text(&value.display_name, 256)
                || value
                    .avatar_url
                    .as_deref()
                    .is_some_and(|avatar| !valid_current_user_avatar(avatar))
            {
                return Err(untrusted());
            }
            LocalAppCurrentUserStatus {
                value: Some(LocalAppCurrentUserDisplay {
                    handle: value.handle,
                    display_name: value.display_name,
                    avatar_url: value.avatar_url,
                }),
                reason_code: LocalAppReasonCode::ActionExecuted,
                retryable: false,
            }
        }
        (None, CURRENT_USER_DISPLAY_UNAVAILABLE) => LocalAppCurrentUserStatus {
            value: None,
            reason_code: LocalAppReasonCode::CurrentUserDisplayUnavailable,
            retryable: true,
        },
        _ => return Err(untrusted()),
    };
    Ok(ready_session_status(current_user))
}

fn valid_current_user_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_current_user_avatar(value: &str) -> bool {
    if value.is_empty() || value.len() > 2048 || value.trim() != value {
        return false;
    }
    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return false;
    }
    match parsed.scheme() {
        "https" => parsed.port().is_none_or(|port| port == 443),
        "http" => parsed.host_str() == Some("127.0.0.1") && parsed.port() == Some(3002),
        _ => false,
    }
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

    #[cfg(target_os = "macos")]
    #[tokio::test(flavor = "current_thread")]
    async fn session_renewal_reaches_transport_while_a_stream_operation_is_active() {
        use hyper_util::rt::TokioIo;
        use std::sync::{atomic::AtomicUsize, Arc};
        use tower::service_fn;

        let attempts = Arc::new(AtomicUsize::new(0));
        let observed = attempts.clone();
        let channel = tonic::transport::Endpoint::from_static("http://127.0.0.1:1")
            .connect_with_connector_lazy(service_fn(move |_| {
                observed.fetch_add(1, Ordering::SeqCst);
                async {
                    Err::<TokioIo<tokio::io::DuplexStream>, _>(std::io::Error::new(
                        std::io::ErrorKind::ConnectionRefused,
                        "renewal transport fixture",
                    ))
                }
            }));
        let session = PlatformLocalAppSession {
            channel,
            operation_gate: RwLock::new(()),
            session_maintenance: Mutex::new(()),
            session_bound: AtomicBool::new(true),
            account_required: AtomicBool::new(false),
            retired: AtomicBool::new(false),
            current_user: RwLock::new(unavailable_current_user()),
        };
        // A streaming upload retains its operation guard while waiting for body chunks.
        let _active_stream = session.operation_gate.read().await;
        let result = tokio::time::timeout(Duration::from_secs(1), session.renew_session())
            .await
            .expect("renewal must not queue an exclusive lock behind an open stream");
        assert!(
            result.is_err(),
            "the fixture deliberately has no Runtime transport"
        );
        assert!(attempts.load(Ordering::SeqCst) > 0);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test(flavor = "current_thread")]
    async fn invalidated_bound_channel_never_returns_to_bootstrap() {
        use hyper_util::rt::TokioIo;
        use std::sync::{atomic::AtomicUsize, Arc};
        use tower::service_fn;
        let attempts = Arc::new(AtomicUsize::new(0));
        let observed = attempts.clone();
        let channel = tonic::transport::Endpoint::from_static("http://127.0.0.1:1")
            .connect_with_connector_lazy(service_fn(move |_| {
                observed.fetch_add(1, Ordering::SeqCst);
                async {
                    Err::<TokioIo<tokio::io::DuplexStream>, _>(std::io::Error::from(
                        std::io::ErrorKind::ConnectionRefused,
                    ))
                }
            }));
        let session = PlatformLocalAppSession {
            channel,
            operation_gate: RwLock::new(()),
            session_maintenance: Mutex::new(()),
            session_bound: AtomicBool::new(false),
            account_required: AtomicBool::new(false),
            retired: AtomicBool::new(false),
            current_user: RwLock::new(unavailable_current_user()),
        };
        assert!(session.can_retry_initial_bootstrap());
        session
            .store_ready_status(&ready_session_status(unavailable_current_user()))
            .await;
        assert!(!session.can_retry_initial_bootstrap());
        session.record_session_error(&runtime_unauthenticated());
        assert!(session.session_bound.load(Ordering::Acquire));
        assert!(!session.can_retry_initial_bootstrap());
        for outcome in [
            session.open_session().await,
            session.refresh_session().await,
            session.session_status().await,
        ] {
            assert_eq!(
                outcome.unwrap_err().reason_code(),
                LocalAppReasonCode::RuntimeUnauthenticated
            );
        }
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            0,
            "no Open or Renew may use the invalidated bound channel"
        );
    }

    #[test]
    fn local_app_session_decodes_exact_current_user_and_isolates_unavailable_display() {
        let ready = validate_session_projection(crate::generated::OpenLocalAppSessionResponse {
            state: LOCAL_APP_SESSION_READY,
            reason_code: ACTION_EXECUTED,
            current_user: Some(crate::generated::CurrentUserDisplayProjection {
                handle: "halliday".to_string(),
                display_name: "Halliday".to_string(),
                avatar_url: None,
            }),
            current_user_reason_code: ACTION_EXECUTED,
        })
        .expect("ready Current User");
        assert_eq!(
            ready.current_user.value.expect("display"),
            LocalAppCurrentUserDisplay {
                handle: "halliday".to_string(),
                display_name: "Halliday".to_string(),
                avatar_url: None,
            }
        );

        let unavailable =
            validate_session_projection(crate::generated::OpenLocalAppSessionResponse {
                state: LOCAL_APP_SESSION_READY,
                reason_code: ACTION_EXECUTED,
                current_user: None,
                current_user_reason_code: CURRENT_USER_DISPLAY_UNAVAILABLE,
            })
            .expect("display failure must not fail the App session");
        assert_eq!(unavailable.state, LocalAppSessionState::Ready);
        assert_eq!(unavailable.current_user.value, None);
        assert!(unavailable.current_user.retryable);
    }

    #[test]
    fn local_app_session_rejects_malformed_or_credential_bearing_avatar_projection() {
        for avatar in [
            "https://cdn.example/a.png?token=secret",
            "https://user:secret@cdn.example/a.png", // pragma: allowlist secret
            "http://realm.example/a.png",
        ] {
            let response = crate::generated::OpenLocalAppSessionResponse {
                state: LOCAL_APP_SESSION_READY,
                reason_code: ACTION_EXECUTED,
                current_user: Some(crate::generated::CurrentUserDisplayProjection {
                    handle: "halliday".to_string(),
                    display_name: "Halliday".to_string(),
                    avatar_url: Some(avatar.to_string()),
                }),
                current_user_reason_code: ACTION_EXECUTED,
            };
            assert!(
                validate_session_projection(response).is_err(),
                "avatar {avatar}"
            );
        }
    }

    #[test]
    fn anonymous_ready_runtime_retains_verified_channel_for_later_account_binding() {
        let error = LocalAppOperationError::new(LocalAppReasonCode::RuntimeUnauthenticated, false);
        assert!(retain_channel_for_account_required(&error));
    }

    #[test]
    fn unreachable_runtime_does_not_masquerade_as_account_required() {
        let error =
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true);
        assert!(!retain_channel_for_account_required(&error));
    }

    #[test]
    fn raced_session_open_failure_stays_transient_unavailable() {
        for reason in [
            LocalAppReasonCode::RuntimeServiceErrorUnclassified,
            LocalAppReasonCode::OperationUnavailable,
        ] {
            let error = transient_open_session_failure(LocalAppOperationError::new(reason, false));
            assert_eq!(
                error.reason_code(),
                LocalAppReasonCode::RuntimeServiceUnavailable,
                "{reason:?}"
            );
            assert!(error.retryable(), "{reason:?}");
        }
    }

    #[test]
    fn typed_session_open_denials_keep_exact_verdicts() {
        for reason in [
            LocalAppReasonCode::RuntimeServiceUntrusted,
            LocalAppReasonCode::Revoked,
            LocalAppReasonCode::RuntimeAccessDenied,
            LocalAppReasonCode::ProcessReplaced,
        ] {
            let error = LocalAppOperationError::new(reason, false);
            assert_eq!(
                transient_open_session_failure(error).reason_code(),
                reason,
                "{reason:?}"
            );
        }
    }

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
