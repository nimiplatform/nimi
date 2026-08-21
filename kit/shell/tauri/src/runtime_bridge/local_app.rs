#[cfg(target_os = "linux")]
use nimi_shell_protected_local::LinuxLocalAppCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsLocalAppCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsLocalAppCarrier;
use nimi_shell_protected_local::{
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentUpdateAutonomyRequest, LocalAppAssetAdoptRequest, LocalAppAssetListRequest,
    LocalAppAssetListResult, LocalAppAssetMoveRequest, LocalAppAssetRange,
    LocalAppAssetReadReceiver, LocalAppAssetReadRequest, LocalAppAssetRecord,
    LocalAppAssetRemoveRequest, LocalAppAssetRemoveResult, LocalAppAssetRevealRequest,
    LocalAppAssetRevealTarget, LocalAppAssetStatRequest, LocalAppAssetWriteRequest,
    LocalAppOperationError, LocalAppPersonaCharacterCreateRequest,
    LocalAppPersonaCharacterGetOwnedRequest, LocalAppPersonaCharacterListOwnedRequest,
    LocalAppPersonaCharacterReplaceRequest, LocalAppReasonCode,
    LocalAppScenarioUploadArtifactRequest, LocalAppSessionStatus,
    LocalAppSharedAgentAIConfigOverwriteRequest, LocalAppStorageDocument,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult,
    LocalAppStorageWriteRequest, LocalAppTextCandidateRequest, LocalAppTextCandidateResult,
    LocalAppWorldCoreCreateRequest, LocalAppWorldCoreListRequest, NimiLocalAppCarrier,
    NimiLocalAppSession,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const MAX_ASSET_STREAMS: usize = 8;

struct AssetWriteStream {
    sender: tokio::sync::mpsc::Sender<Vec<u8>>,
    task: JoinHandle<Result<LocalAppAssetRecord, LocalAppOperationError>>,
    session: Arc<dyn NimiLocalAppSession>,
}

struct AssetReadStream {
    receiver: Mutex<LocalAppAssetReadReceiver>,
    session: Arc<dyn NimiLocalAppSession>,
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

/// Host-only Tauri projection of one connection-bound Local App session.
/// It exposes the same exact typed operations as the Electron Node-API addon.
pub struct RuntimeBridgeLocalAppHost {
    carrier: Arc<dyn NimiLocalAppCarrier>,
    session: Mutex<Option<Arc<dyn NimiLocalAppSession>>>,
    asset_write_streams: Mutex<HashMap<String, AssetWriteStream>>,
    asset_read_streams: Mutex<HashMap<String, Arc<AssetReadStream>>>,
    asset_stream_counter: AtomicU64,
}

impl RuntimeBridgeLocalAppHost {
    fn new(carrier: Arc<dyn NimiLocalAppCarrier>) -> Self {
        Self {
            carrier,
            session: Mutex::new(None),
            asset_write_streams: Mutex::new(HashMap::new()),
            asset_read_streams: Mutex::new(HashMap::new()),
            asset_stream_counter: AtomicU64::new(1),
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

    pub async fn model_config_local_selections_get(
        &self,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.model_config_local_selections_get().await {
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
        if current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
        {
            *current = None;
            for (_, stream) in self.asset_write_streams.lock().await.drain() {
                stream.task.abort();
            }
            self.asset_read_streams.lock().await.clear();
        }
    }
}

impl Default for RuntimeBridgeLocalAppHost {
    fn default() -> Self {
        Self::platform_default()
    }
}
