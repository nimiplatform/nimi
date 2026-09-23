#[cfg(target_os = "linux")]
use nimi_shell_protected_local::LinuxLocalAppCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsLocalAppCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsLocalAppCarrier;
use nimi_shell_protected_local::{
    LocalAppAIConfigLocalOptionsRequest, LocalAppAIConfigOverwriteRequest,
    LocalAppActivityListRequest, LocalAppActivityMarkReadRequest, LocalAppActivityOpenRequest,
    LocalAppActivityOpenRequestCompleteRequest, LocalAppActivityPutRequest,
    LocalAppActivitySubscribeRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest,
    LocalAppAgentManagerSnapshotRequest, LocalAppAgentMemoryCorrectRequest,
    LocalAppAgentMemoryDeleteRequest, LocalAppAgentMemoryForgetRequest,
    LocalAppAgentMemoryInspectRequest, LocalAppAgentMemorySwitchRequest,
    LocalAppAgentPresentationAssetReadRequest, LocalAppAgentUpdateAutonomyRequest,
    LocalAppAssetAdoptRequest, LocalAppAssetListRequest, LocalAppAssetListResult,
    LocalAppAssetMoveRequest, LocalAppAssetRange, LocalAppAssetReadReceiver,
    LocalAppAssetReadRequest, LocalAppAssetRecord, LocalAppAssetRemoveRequest,
    LocalAppAssetRemoveResult, LocalAppAssetRevealRequest, LocalAppAssetRevealTarget,
    LocalAppAssetStatRequest, LocalAppAssetWriteRequest, LocalAppEmbodimentSnapshotRequest,
    LocalAppEmbodimentSubscribeRequest, LocalAppOperationError,
    LocalAppPersonaCharacterCreateRequest, LocalAppPersonaCharacterDeleteRequest,
    LocalAppPersonaCharacterGetOwnedRequest, LocalAppPersonaCharacterListOwnedRequest,
    LocalAppPersonaCharacterReplaceRequest, LocalAppRealtimeSubscriptionReceiver,
    LocalAppReasonCode, LocalAppScenarioUploadArtifactRequest, LocalAppSessionStatus,
    LocalAppSharedAgentAIConfigLocalOptionsRequest, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppStorageDocument, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageRemoveResult, LocalAppStorageWriteRequest, LocalAppTextCandidateRequest,
    LocalAppTextCandidateResult, LocalAppWorldCharacterCreateRequest,
    LocalAppWorldCharacterGetRequest, LocalAppWorldCharacterListRequest,
    LocalAppWorldCharacterReplaceRequest, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreGetRequest, LocalAppWorldCoreListRequest, LocalAppWorldCoreReplaceRequest,
    LocalAppWorldEntityCreateRequest, LocalAppWorldEntityGetRequest,
    LocalAppWorldEntityListRequest, LocalAppWorldRelationshipGetRequest,
    LocalAppWorldRelationshipListRequest, NimiLocalAppCarrier, NimiLocalAppSession,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

const MAX_ASSET_STREAMS: usize = 8;
const MAX_EMBODIMENT_STREAMS: usize = 8;
const MAX_ACTIVITY_STREAMS: usize = 8;

struct AssetWriteStream {
    sender: tokio::sync::mpsc::Sender<Vec<u8>>,
    task: JoinHandle<Result<LocalAppAssetRecord, LocalAppOperationError>>,
    session: Arc<dyn NimiLocalAppSession>,
}

struct AssetReadStream {
    receiver: Mutex<LocalAppAssetReadReceiver>,
    session: Arc<dyn NimiLocalAppSession>,
}

struct EmbodimentStream {
    receiver: Mutex<Option<LocalAppRealtimeSubscriptionReceiver>>,
    close_tx: watch::Sender<bool>,
}

pub struct RuntimeBridgeAssetReadOpenResult {
    pub stream_id: String,
    pub asset: LocalAppAssetRecord,
    pub range: LocalAppAssetRange,
}

pub struct RuntimeBridgeAssetReadNextResult {
    pub completed: bool,
    pub body_chunk: Option<Vec<u8>>,
}

pub struct RuntimeBridgeEmbodimentNextResult {
    pub completed: bool,
    pub event: Option<serde_json::Value>,
}

pub struct RuntimeBridgeActivityNextResult {
    pub completed: bool,
    pub event: Option<serde_json::Value>,
}

#[derive(Clone)]
enum ActivityStreamClosure {
    Open,
    Canceled,
    Failed(LocalAppOperationError),
}

struct ActivityStream {
    receiver: Mutex<Option<LocalAppRealtimeSubscriptionReceiver>>,
    closure: watch::Sender<ActivityStreamClosure>,
}

impl ActivityStream {
    /// Ends the stream for any pending pull and drops the carrier receiver,
    /// which cancels the Runtime stream.
    async fn close(&self, closure: ActivityStreamClosure) {
        self.closure.send_replace(closure);
        self.receiver.lock().await.take();
    }
}

/// Renderer-pulled App activity stream registry. Each registry serves one
/// exact command, so a subscription id never crosses between the change feed
/// and the source open-request feed.
struct ActivityStreams {
    prefix: &'static str,
    counter: AtomicU64,
    streams: Mutex<HashMap<String, Arc<ActivityStream>>>,
}

impl ActivityStreams {
    fn new(prefix: &'static str) -> Self {
        Self {
            prefix,
            counter: AtomicU64::new(1),
            streams: Mutex::new(HashMap::new()),
        }
    }

    async fn ensure_capacity(&self) -> Result<(), LocalAppOperationError> {
        if self.streams.lock().await.len() >= MAX_ACTIVITY_STREAMS {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::ResourceExhausted,
                false,
            ));
        }
        Ok(())
    }

    async fn insert(
        &self,
        receiver: LocalAppRealtimeSubscriptionReceiver,
    ) -> Result<String, LocalAppOperationError> {
        let stream_id = format!(
            "{}-{}",
            self.prefix,
            self.counter.fetch_add(1, Ordering::Relaxed)
        );
        let (closure, _) = watch::channel(ActivityStreamClosure::Open);
        let mut streams = self.streams.lock().await;
        if streams.len() >= MAX_ACTIVITY_STREAMS {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::ResourceExhausted,
                false,
            ));
        }
        streams.insert(
            stream_id.clone(),
            Arc::new(ActivityStream {
                receiver: Mutex::new(Some(receiver)),
                closure,
            }),
        );
        Ok(stream_id)
    }

    async fn next(
        &self,
        stream_id: &str,
    ) -> Result<RuntimeBridgeActivityNextResult, LocalAppOperationError> {
        let stream = self.streams.lock().await.get(stream_id).cloned();
        let Some(stream) = stream else {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::NotFound,
                false,
            ));
        };
        let mut closure_rx = stream.closure.subscribe();
        let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::InvalidPayload,
                false,
            ));
        };
        let closed = |closure: &ActivityStreamClosure| match closure {
            ActivityStreamClosure::Open => None,
            ActivityStreamClosure::Canceled => Some(Ok(RuntimeBridgeActivityNextResult {
                completed: true,
                event: None,
            })),
            ActivityStreamClosure::Failed(error) => Some(Err(error.clone())),
        };
        if let Some(result) = closed(&closure_rx.borrow()) {
            return result;
        }
        let Some(receiver) = receiver_slot.as_mut() else {
            return Ok(RuntimeBridgeActivityNextResult {
                completed: true,
                event: None,
            });
        };
        let next = tokio::select! {
            biased;
            _ = closure_rx.changed() => None,
            next = receiver.recv() => next,
        };
        let result = match next {
            Some(Ok(event)) => {
                return Ok(RuntimeBridgeActivityNextResult {
                    completed: false,
                    event: Some(event),
                })
            }
            Some(Err(error)) => Err(error),
            None => closed(&closure_rx.borrow()).unwrap_or(Ok(RuntimeBridgeActivityNextResult {
                completed: true,
                event: None,
            })),
        };
        self.streams.lock().await.remove(stream_id);
        result
    }

    async fn close(&self, stream_id: &str) -> bool {
        let stream = self.streams.lock().await.remove(stream_id);
        if let Some(stream) = stream.as_ref() {
            stream.close(ActivityStreamClosure::Canceled).await;
        }
        stream.is_some()
    }

    async fn drain(&self) -> Vec<Arc<ActivityStream>> {
        self.streams
            .lock()
            .await
            .drain()
            .map(|(_, stream)| stream)
            .collect()
    }
}

/// Host-only Tauri projection of one connection-bound Local App session.
/// It exposes the same exact typed operations as the Electron Node-API addon.
pub struct RuntimeBridgeLocalAppHost {
    carrier: Arc<dyn NimiLocalAppCarrier>,
    session: Mutex<Option<Arc<dyn NimiLocalAppSession>>>,
    asset_write_streams: Mutex<HashMap<String, AssetWriteStream>>,
    asset_read_streams: Mutex<HashMap<String, Arc<AssetReadStream>>>,
    asset_stream_counter: AtomicU64,
    embodiment_streams: Mutex<HashMap<String, Arc<EmbodimentStream>>>,
    embodiment_stream_counter: AtomicU64,
    activity_streams: ActivityStreams,
    activity_open_request_streams: ActivityStreams,
}

impl RuntimeBridgeLocalAppHost {
    fn new(carrier: Arc<dyn NimiLocalAppCarrier>) -> Self {
        Self {
            carrier,
            session: Mutex::new(None),
            asset_write_streams: Mutex::new(HashMap::new()),
            asset_read_streams: Mutex::new(HashMap::new()),
            asset_stream_counter: AtomicU64::new(1),
            embodiment_streams: Mutex::new(HashMap::new()),
            embodiment_stream_counter: AtomicU64::new(1),
            activity_streams: ActivityStreams::new("activity"),
            activity_open_request_streams: ActivityStreams::new("activity-open-requests"),
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    pub fn platform_default() -> Self {
        #[cfg(target_os = "windows")]
        let carrier: Arc<dyn NimiLocalAppCarrier> = Arc::new(WindowsLocalAppCarrier);
        #[cfg(target_os = "macos")]
        let carrier: Arc<dyn NimiLocalAppCarrier> = Arc::new(MacOsLocalAppCarrier);
        #[cfg(target_os = "linux")]
        let carrier: Arc<dyn NimiLocalAppCarrier> = Arc::new(LinuxLocalAppCarrier);
        Self::new(carrier)
    }

    pub async fn session_status(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.session_status().await {
            Ok(status) => Ok(status),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    /// Host-only technical renewal seam. Tauri renderers receive no command
    /// for this operation; an admitted host lifecycle scheduler owns it.
    pub async fn renew_technical_session(
        &self,
    ) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.renew_technical_session().await {
            Ok(status) => Ok(status),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn generate_text_candidate(
        &self,
        request: LocalAppTextCandidateRequest,
    ) -> Result<LocalAppTextCandidateResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.generate_text_candidate(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn upload_scenario_artifact(
        &self,
        request: LocalAppScenarioUploadArtifactRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.upload_scenario_artifact(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn app_ai_config_get(&self) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.app_ai_config_get().await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn app_ai_config_overwrite(
        &self,
        request: LocalAppAIConfigOverwriteRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.app_ai_config_overwrite(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn app_ai_config_local_options(
        &self,
        request: LocalAppAIConfigLocalOptionsRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.app_ai_config_local_options(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_core_list(
        &self,
        request: LocalAppWorldCoreListRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_core_list(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_core_create(
        &self,
        request: LocalAppWorldCoreCreateRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_core_create(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_creation_eligibility_get(
        &self,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_creation_eligibility_get().await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_core_get(
        &self,
        request: LocalAppWorldCoreGetRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_core_get(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_core_replace(
        &self,
        request: LocalAppWorldCoreReplaceRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_core_replace(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_character_list(
        &self,
        request: LocalAppWorldCharacterListRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_character_list(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_character_get(
        &self,
        request: LocalAppWorldCharacterGetRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_character_get(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_character_create(
        &self,
        request: LocalAppWorldCharacterCreateRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_character_create(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_character_replace(
        &self,
        request: LocalAppWorldCharacterReplaceRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_character_replace(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_entity_list(
        &self,
        request: LocalAppWorldEntityListRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_entity_list(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_entity_get(
        &self,
        request: LocalAppWorldEntityGetRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_entity_get(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_entity_create(
        &self,
        request: LocalAppWorldEntityCreateRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_entity_create(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_relationship_list(
        &self,
        request: LocalAppWorldRelationshipListRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_relationship_list(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn world_relationship_get(
        &self,
        request: LocalAppWorldRelationshipGetRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_world_relationship_get(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn persona_character_list_owned(
        &self,
        request: LocalAppPersonaCharacterListOwnedRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_persona_character_list_owned(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn persona_character_get_owned(
        &self,
        request: LocalAppPersonaCharacterGetOwnedRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_persona_character_get_owned(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn persona_character_create(
        &self,
        request: LocalAppPersonaCharacterCreateRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_persona_character_create(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn persona_character_replace(
        &self,
        request: LocalAppPersonaCharacterReplaceRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_persona_character_replace(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn persona_character_delete(
        &self,
        request: LocalAppPersonaCharacterDeleteRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.realm_persona_character_delete(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn shared_agent_ai_config_get(
        &self,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.shared_agent_ai_config_get().await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn shared_agent_ai_config_overwrite(
        &self,
        request: LocalAppSharedAgentAIConfigOverwriteRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.shared_agent_ai_config_overwrite(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn shared_agent_ai_config_local_options(
        &self,
        request: LocalAppSharedAgentAIConfigLocalOptionsRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.shared_agent_ai_config_local_options(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_manager_snapshot(
        &self,
        request: LocalAppAgentManagerSnapshotRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_manager_snapshot(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_autonomy_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_autonomy_snapshot(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_update_autonomy(
        &self,
        request: LocalAppAgentUpdateAutonomyRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_update_autonomy(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_presentation_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_presentation_snapshot(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_presentation_read_asset(
        &self,
        request: LocalAppAgentPresentationAssetReadRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_presentation_read_asset(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_commit_presentation(
        &self,
        request: LocalAppAgentCommitPresentationRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_commit_presentation(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_memory_inspect(
        &self,
        request: LocalAppAgentMemoryInspectRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_memory_inspect(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_memory_correct(
        &self,
        request: LocalAppAgentMemoryCorrectRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_memory_correct(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_memory_forget(
        &self,
        request: LocalAppAgentMemoryForgetRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_memory_forget(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_memory_switch(
        &self,
        request: LocalAppAgentMemorySwitchRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_memory_switch(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn agent_memory_delete(
        &self,
        request: LocalAppAgentMemoryDeleteRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.agent_memory_delete(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn embodiment_snapshot(
        &self,
        request: LocalAppEmbodimentSnapshotRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.embodiment_snapshot(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn embodiment_subscribe(
        &self,
        request: LocalAppEmbodimentSubscribeRequest,
    ) -> Result<String, LocalAppOperationError> {
        if self.embodiment_streams.lock().await.len() >= MAX_EMBODIMENT_STREAMS {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::ResourceExhausted,
                false,
            ));
        }
        let session = self.current_or_open_session().await?;
        match session.embodiment_subscribe(request).await {
            Ok(receiver) => {
                let stream_id = format!(
                    "embodiment-{}",
                    self.embodiment_stream_counter
                        .fetch_add(1, Ordering::Relaxed)
                );
                let (close_tx, _) = watch::channel(false);
                let mut streams = self.embodiment_streams.lock().await;
                if streams.len() >= MAX_EMBODIMENT_STREAMS {
                    return Err(LocalAppOperationError::new(
                        LocalAppReasonCode::ResourceExhausted,
                        false,
                    ));
                }
                streams.insert(
                    stream_id.clone(),
                    Arc::new(EmbodimentStream {
                        receiver: Mutex::new(Some(receiver)),
                        close_tx,
                    }),
                );
                Ok(stream_id)
            }
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn embodiment_stream_next(
        &self,
        stream_id: &str,
    ) -> Result<RuntimeBridgeEmbodimentNextResult, LocalAppOperationError> {
        let stream = self.embodiment_streams.lock().await.get(stream_id).cloned();
        let Some(stream) = stream else {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::NotFound,
                false,
            ));
        };
        let mut close_rx = stream.close_tx.subscribe();
        let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::InvalidPayload,
                false,
            ));
        };
        let Some(receiver) = receiver_slot.as_mut() else {
            return Ok(RuntimeBridgeEmbodimentNextResult {
                completed: true,
                event: None,
            });
        };
        let next = tokio::select! {
            biased;
            _ = close_rx.changed() => None,
            next = receiver.recv() => next,
        };
        match next {
            Some(Ok(event)) => Ok(RuntimeBridgeEmbodimentNextResult {
                completed: false,
                event: Some(event),
            }),
            Some(Err(error)) => {
                self.embodiment_streams.lock().await.remove(stream_id);
                Err(error)
            }
            None => {
                self.embodiment_streams.lock().await.remove(stream_id);
                Ok(RuntimeBridgeEmbodimentNextResult {
                    completed: true,
                    event: None,
                })
            }
        }
    }

    pub async fn embodiment_stream_close(&self, stream_id: &str) -> bool {
        let stream = self.embodiment_streams.lock().await.remove(stream_id);
        if let Some(stream) = stream.as_ref() {
            stream.close_tx.send_replace(true);
            stream.receiver.lock().await.take();
        }
        stream.is_some()
    }

    pub async fn activity_put(
        &self,
        request: LocalAppActivityPutRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.activity_put(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn activity_list(
        &self,
        request: LocalAppActivityListRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.activity_list(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn activity_subscribe(
        &self,
        request: LocalAppActivitySubscribeRequest,
    ) -> Result<String, LocalAppOperationError> {
        self.activity_streams.ensure_capacity().await?;
        let session = self.current_or_open_session().await?;
        match session.activity_subscribe(request).await {
            Ok(receiver) => self.activity_streams.insert(receiver).await,
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn activity_stream_next(
        &self,
        stream_id: &str,
    ) -> Result<RuntimeBridgeActivityNextResult, LocalAppOperationError> {
        self.activity_streams.next(stream_id).await
    }

    pub async fn activity_stream_close(&self, stream_id: &str) -> bool {
        self.activity_streams.close(stream_id).await
    }

    pub async fn activity_mark_read(
        &self,
        request: LocalAppActivityMarkReadRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.activity_mark_read(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    /// Host-private source-open stream. The caller consumes the open request
    /// id for the Desktop launch and returns only the typed result.
    pub async fn activity_open(
        &self,
        request: LocalAppActivityOpenRequest,
    ) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.activity_open(request).await {
            Ok(receiver) => Ok(receiver),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn activity_open_requests_subscribe(&self) -> Result<String, LocalAppOperationError> {
        self.activity_open_request_streams.ensure_capacity().await?;
        let session = self.current_or_open_session().await?;
        match session.activity_open_requests_subscribe().await {
            Ok(receiver) => self.activity_open_request_streams.insert(receiver).await,
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn activity_open_requests_stream_next(
        &self,
        stream_id: &str,
    ) -> Result<RuntimeBridgeActivityNextResult, LocalAppOperationError> {
        self.activity_open_request_streams.next(stream_id).await
    }

    pub async fn activity_open_requests_stream_close(&self, stream_id: &str) -> bool {
        self.activity_open_request_streams.close(stream_id).await
    }

    pub async fn activity_open_request_complete(
        &self,
        request: LocalAppActivityOpenRequestCompleteRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.activity_open_request_complete(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_read_json(
        &self,
        request: LocalAppStorageReadRequest,
    ) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_read_json(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_write_json(
        &self,
        request: LocalAppStorageWriteRequest,
    ) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_write_json(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_remove_json(
        &self,
        request: LocalAppStorageRemoveRequest,
    ) -> Result<LocalAppStorageRemoveResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_remove_json(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_asset_stat(
        &self,
        request: LocalAppAssetStatRequest,
    ) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_asset_stat(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_asset_list(
        &self,
        request: LocalAppAssetListRequest,
    ) -> Result<LocalAppAssetListResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_asset_list(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_asset_write_open(
        &self,
        request: LocalAppAssetWriteRequest,
    ) -> Result<String, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        let mut streams = self.asset_write_streams.lock().await;
        if streams.len() >= MAX_ASSET_STREAMS {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::ResourceExhausted,
                false,
            ));
        }
        let stream_id = format!(
            "asset-write-{}",
            self.asset_stream_counter.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, body) = tokio::sync::mpsc::channel(2);
        let task_session = session.clone();
        let task =
            tokio::spawn(async move { task_session.storage_asset_write(request, body).await });
        streams.insert(
            stream_id.clone(),
            AssetWriteStream {
                sender,
                task,
                session,
            },
        );
        Ok(stream_id)
    }

    pub async fn storage_asset_write_chunk(
        &self,
        stream_id: &str,
        body_chunk: Vec<u8>,
    ) -> Result<(), LocalAppOperationError> {
        let sender = self
            .asset_write_streams
            .lock()
            .await
            .get(stream_id)
            .map(|stream| stream.sender.clone())
            .ok_or_else(|| LocalAppOperationError::new(LocalAppReasonCode::NotFound, false))?;
        sender
            .send(body_chunk)
            .await
            .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::Canceled, false))
    }

    pub async fn storage_asset_write_commit(
        &self,
        stream_id: &str,
    ) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
        let stream = self
            .asset_write_streams
            .lock()
            .await
            .remove(stream_id)
            .ok_or_else(|| LocalAppOperationError::new(LocalAppReasonCode::NotFound, false))?;
        drop(stream.sender);
        match stream.task.await {
            Ok(Ok(asset)) => Ok(asset),
            Ok(Err(error)) => {
                self.clear_on_transport_failure(&stream.session, &error)
                    .await;
                Err(error)
            }
            Err(_) => Err(LocalAppOperationError::new(
                LocalAppReasonCode::Canceled,
                false,
            )),
        }
    }

    pub async fn storage_asset_write_abort(&self, stream_id: &str) -> bool {
        let stream = self.asset_write_streams.lock().await.remove(stream_id);
        if let Some(stream) = stream {
            stream.task.abort();
            drop(stream.sender);
            true
        } else {
            false
        }
    }

    pub async fn storage_asset_read_open(
        &self,
        request: LocalAppAssetReadRequest,
    ) -> Result<RuntimeBridgeAssetReadOpenResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        if self.asset_read_streams.lock().await.len() >= MAX_ASSET_STREAMS {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::ResourceExhausted,
                false,
            ));
        }
        let result = match session.storage_asset_read(request).await {
            Ok(value) => value,
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                return Err(error);
            }
        };
        let stream_id = format!(
            "asset-read-{}",
            self.asset_stream_counter.fetch_add(1, Ordering::Relaxed)
        );
        self.asset_read_streams.lock().await.insert(
            stream_id.clone(),
            Arc::new(AssetReadStream {
                receiver: Mutex::new(result.body),
                session,
            }),
        );
        Ok(RuntimeBridgeAssetReadOpenResult {
            stream_id,
            asset: result.asset,
            range: result.range,
        })
    }

    pub async fn storage_asset_read_next(
        &self,
        stream_id: &str,
    ) -> Result<RuntimeBridgeAssetReadNextResult, LocalAppOperationError> {
        let stream = self
            .asset_read_streams
            .lock()
            .await
            .get(stream_id)
            .cloned()
            .ok_or_else(|| LocalAppOperationError::new(LocalAppReasonCode::NotFound, false))?;
        let next = stream.receiver.lock().await.recv().await;
        match next {
            Some(Ok(body_chunk)) => Ok(RuntimeBridgeAssetReadNextResult {
                completed: false,
                body_chunk: Some(body_chunk),
            }),
            Some(Err(error)) => {
                self.asset_read_streams.lock().await.remove(stream_id);
                self.clear_on_transport_failure(&stream.session, &error)
                    .await;
                Err(error)
            }
            None => {
                self.asset_read_streams.lock().await.remove(stream_id);
                Ok(RuntimeBridgeAssetReadNextResult {
                    completed: true,
                    body_chunk: None,
                })
            }
        }
    }

    pub async fn storage_asset_read_close(&self, stream_id: &str) -> bool {
        self.asset_read_streams
            .lock()
            .await
            .remove(stream_id)
            .is_some()
    }

    pub async fn storage_asset_remove(
        &self,
        request: LocalAppAssetRemoveRequest,
    ) -> Result<LocalAppAssetRemoveResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_asset_remove(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_asset_move(
        &self,
        request: LocalAppAssetMoveRequest,
    ) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_asset_move(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_asset_reveal(
        &self,
        request: LocalAppAssetRevealRequest,
    ) -> Result<LocalAppAssetRevealTarget, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_asset_reveal(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_asset_adopt(
        &self,
        request: LocalAppAssetAdoptRequest,
    ) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_asset_adopt(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    async fn current_or_open_session(
        &self,
    ) -> Result<Arc<dyn NimiLocalAppSession>, LocalAppOperationError> {
        let mut current = self.session.lock().await;
        if let Some(session) = current.as_ref() {
            return Ok(session.clone());
        }
        let session =
            Arc::<dyn NimiLocalAppSession>::from(self.carrier.open_local_app_session().await?);
        *current = Some(session.clone());
        Ok(session)
    }

    async fn clear_on_transport_failure(
        &self,
        session: &Arc<dyn NimiLocalAppSession>,
        error: &LocalAppOperationError,
    ) {
        if !matches!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeServiceUnavailable
                | LocalAppReasonCode::RuntimeServiceUntrusted
                | LocalAppReasonCode::RuntimeUnauthenticated
                | LocalAppReasonCode::ProcessReplaced
                | LocalAppReasonCode::AccountChanged
                | LocalAppReasonCode::RuntimeRestarted
                | LocalAppReasonCode::Revoked
        ) {
            return;
        }
        let mut current = self.session.lock().await;
        if !current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
        {
            return;
        }
        *current = None;
        for (_, stream) in self.asset_write_streams.lock().await.drain() {
            stream.task.abort();
        }
        self.asset_read_streams.lock().await.clear();
        // Activity feeds are account-scoped: streams of the invalidated
        // session end with its failure and never carry into a fresh bind.
        let mut activity_streams = self.activity_streams.drain().await;
        activity_streams.extend(self.activity_open_request_streams.drain().await);
        drop(current);
        for stream in activity_streams {
            stream
                .close(ActivityStreamClosure::Failed(error.clone()))
                .await;
        }
    }
}

impl Default for RuntimeBridgeLocalAppHost {
    fn default() -> Self {
        Self::platform_default()
    }
}

#[cfg(test)]
mod activity_stream_tests {
    use super::*;
    use serde_json::json;

    fn stream_pair() -> (
        tokio::sync::mpsc::Sender<Result<serde_json::Value, LocalAppOperationError>>,
        LocalAppRealtimeSubscriptionReceiver,
    ) {
        tokio::sync::mpsc::channel(4)
    }

    #[tokio::test]
    async fn activity_stream_pulls_events_and_completes_with_the_runtime_stream() {
        let streams = ActivityStreams::new("activity");
        let (sender, receiver) = stream_pair();
        let stream_id = streams.insert(receiver).await.expect("stream id");
        assert_eq!(stream_id, "activity-1");
        sender
            .send(Ok(json!({ "changeSeq": "1", "kind": "remove", "activityId": "act_1" })))
            .await
            .expect("event");
        let next = streams.next(&stream_id).await.expect("next event");
        assert!(!next.completed);
        assert_eq!(next.event.expect("event")["kind"], "remove");
        drop(sender);
        let next = streams.next(&stream_id).await.expect("completion");
        assert!(next.completed);
        assert_eq!(
            streams
                .next(&stream_id)
                .await
                .err()
                .map(|error| error.reason_code()),
            Some(LocalAppReasonCode::NotFound)
        );
    }

    #[tokio::test]
    async fn activity_stream_cancel_ends_a_pending_pull_and_drops_the_carrier_receiver() {
        let streams = Arc::new(ActivityStreams::new("activity-open-requests"));
        let (sender, receiver) = stream_pair();
        let stream_id = streams.insert(receiver).await.expect("stream id");
        let pending = {
            let streams = Arc::clone(&streams);
            let stream_id = stream_id.clone();
            tokio::spawn(async move { streams.next(&stream_id).await })
        };
        tokio::task::yield_now().await;
        assert!(streams.close(&stream_id).await);
        let next = pending
            .await
            .expect("pending pull joins")
            .expect("canceled pull completes");
        assert!(next.completed);
        assert!(sender.is_closed(), "cancel must release the carrier stream");
        assert!(!streams.close(&stream_id).await);
    }

    #[tokio::test]
    async fn drained_activity_streams_surface_the_session_failure() {
        let streams = Arc::new(ActivityStreams::new("activity"));
        let (sender, receiver) = stream_pair();
        let stream_id = streams.insert(receiver).await.expect("stream id");
        let pending = {
            let streams = Arc::clone(&streams);
            let stream_id = stream_id.clone();
            tokio::spawn(async move { streams.next(&stream_id).await })
        };
        tokio::task::yield_now().await;
        let failure = LocalAppOperationError::new(LocalAppReasonCode::AccountChanged, false);
        for stream in streams.drain().await {
            stream
                .close(ActivityStreamClosure::Failed(failure.clone()))
                .await;
        }
        let error = pending
            .await
            .expect("pending pull joins")
            .err()
            .expect("session failure reaches the pending pull");
        assert_eq!(error.reason_code(), LocalAppReasonCode::AccountChanged);
        assert!(sender.is_closed());
    }

    #[tokio::test]
    async fn activity_stream_registry_is_bounded() {
        let streams = ActivityStreams::new("activity");
        let mut senders = Vec::new();
        for _ in 0..MAX_ACTIVITY_STREAMS {
            let (sender, receiver) = stream_pair();
            streams.insert(receiver).await.expect("bounded stream");
            senders.push(sender);
        }
        assert_eq!(
            streams
                .ensure_capacity()
                .await
                .err()
                .map(|error| error.reason_code()),
            Some(LocalAppReasonCode::ResourceExhausted)
        );
        let (sender, receiver) = stream_pair();
        assert_eq!(
            streams
                .insert(receiver)
                .await
                .err()
                .map(|error| error.reason_code()),
            Some(LocalAppReasonCode::ResourceExhausted)
        );
        assert!(sender.is_closed(), "an over-limit stream is released at once");
    }
}
