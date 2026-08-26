use super::*;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};
use tokio::sync::watch;
use tokio::task::JoinHandle;

type ConversationStreamRegistry = HashMap<String, Arc<ConversationStream>>;
struct ConversationStream {
    receiver: Mutex<Option<LocalAppConversationSubscriptionReceiver>>,
    close_tx: watch::Sender<bool>,
}
static CONVERSATION_STREAMS: OnceLock<Mutex<ConversationStreamRegistry>> = OnceLock::new();
static CONVERSATION_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_CONVERSATION_STREAMS: usize = 8;

type RealtimeStreamRegistry = HashMap<String, Arc<RealtimeStream>>;
struct RealtimeStream {
    receiver: Mutex<Option<LocalAppRealtimeSubscriptionReceiver>>,
    close_tx: watch::Sender<bool>,
}
static REALTIME_STREAMS: OnceLock<Mutex<RealtimeStreamRegistry>> = OnceLock::new();
static REALTIME_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_REALTIME_STREAMS: usize = 16;

enum ConversationVoiceCancellation {
    Pending,
    Active(Arc<Notify>),
}

static CONVERSATION_VOICE_CANCELLATIONS: OnceLock<
    Mutex<HashMap<String, ConversationVoiceCancellation>>,
> = OnceLock::new();

fn conversation_voice_cancellations(
) -> &'static Mutex<HashMap<String, ConversationVoiceCancellation>> {
    CONVERSATION_VOICE_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

type ScenarioStreamRegistry = HashMap<String, Arc<ScenarioStream>>;
struct ScenarioStream {
    receiver: Mutex<Option<LocalAppScenarioStreamReceiver>>,
    close_tx: watch::Sender<bool>,
}
static SCENARIO_JOB_STREAMS: OnceLock<Mutex<ScenarioStreamRegistry>> = OnceLock::new();
static TEXT_TURN_STREAMS: OnceLock<Mutex<ScenarioStreamRegistry>> = OnceLock::new();
static SCENARIO_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_SCENARIO_STREAMS: usize = 8;
const MAX_ASSET_STREAMS: usize = 8;
const MAX_ASSET_CHUNK_BYTES: usize = 1024 * 1024;

struct AssetWriteStream {
    sender: tokio::sync::mpsc::Sender<Vec<u8>>,
    task: JoinHandle<Result<LocalAppAssetRecord, LocalAppOperationError>>,
}
type AssetWriteRegistry = HashMap<String, AssetWriteStream>;
type AssetReadRegistry = HashMap<String, Arc<Mutex<LocalAppAssetReadReceiver>>>;
static ASSET_WRITE_STREAMS: OnceLock<Mutex<AssetWriteRegistry>> = OnceLock::new();
static ASSET_READ_STREAMS: OnceLock<Mutex<AssetReadRegistry>> = OnceLock::new();
static ASSET_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);

fn asset_write_streams() -> &'static Mutex<AssetWriteRegistry> {
    ASSET_WRITE_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn asset_read_streams() -> &'static Mutex<AssetReadRegistry> {
    ASSET_READ_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn conversation_streams() -> &'static Mutex<ConversationStreamRegistry> {
    CONVERSATION_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn realtime_streams() -> &'static Mutex<RealtimeStreamRegistry> {
    REALTIME_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn scenario_job_streams() -> &'static Mutex<ScenarioStreamRegistry> {
    SCENARIO_JOB_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn text_turn_streams() -> &'static Mutex<ScenarioStreamRegistry> {
    TEXT_TURN_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[napi(js_name = "localAppSessionStatus")]
pub async fn local_app_session_status() -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session.session_status().await {
        Ok(status) => NativeJsonOutcome::success(project_session_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppSessionRenew")]
pub async fn local_app_session_renew() -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session.renew_technical_session().await {
        Ok(status) => NativeJsonOutcome::success(project_session_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppAIConfigGet")]
pub async fn local_app_ai_config_get() -> NativeJsonOutcome {
    invoke_agent(|session| async move { session.app_ai_config_get().await }).await
}

#[napi(js_name = "localAppAIConfigOverwrite")]
pub async fn local_app_ai_config_overwrite(
    input: NativeAppAIConfigOverwriteInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .app_ai_config_overwrite(LocalAppAIConfigOverwriteRequest {
                expected_revision: input.expected_revision,
                capabilities: input.capabilities,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAIConfigLocalOptions")]
pub async fn local_app_ai_config_local_options(
    input: NativeAIConfigLocalOptionsInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .app_ai_config_local_options(LocalAppAIConfigLocalOptionsRequest {
                kind: input.kind,
                capability_contract: input.capability_contract,
                connector_ref: input.connector_ref.unwrap_or_default(),
                search: input.search.unwrap_or_default(),
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppTextGenerateCandidate")]
pub async fn local_app_text_generate_candidate(
    input: NativeTextCandidateInput,
) -> NativeJsonOutcome {
    let request = match native_text_request(input) {
        Ok(request) => request,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .generate_text_candidate(request)
            .await
            .map(|result| {
                json!({
                    "text": result.text,
                    "finishReason": result.finish_reason,
                    "traceId": result.trace_id,
                })
            })
    })
    .await
}

#[napi(js_name = "localAppScenarioExecute")]
pub async fn local_app_scenario_execute(input: NativeScenarioSpecInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .execute_scenario(LocalAppScenarioExecuteRequest { spec: input.spec })
            .await
    })
    .await
}

#[napi(js_name = "localAppScenarioJobSubmit")]
pub async fn local_app_scenario_job_submit(
    input: NativeScenarioJobSubmitInput,
) -> NativeJsonOutcome {
    let timeout_ms = match optional_native_i32(Some(input.timeout_ms)) {
        Ok(Some(value)) if value >= 0 => value,
        _ => {
            return NativeJsonOutcome::error(LocalAppOperationError::new(
                LocalAppReasonCode::InvalidPayload,
                false,
            ));
        }
    };
    invoke_agent(|session| async move {
        session
            .submit_scenario_job(LocalAppScenarioSubmitRequest {
                spec: input.spec,
                timeout_ms,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppScenarioJobGet")]
pub async fn local_app_scenario_job_get(input: NativeScenarioJobInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .get_scenario_job(LocalAppScenarioGetRequest {
                job_id: input.job_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppScenarioJobCancel")]
pub async fn local_app_scenario_job_cancel(
    input: NativeScenarioJobCancelInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .cancel_scenario_job(LocalAppScenarioCancelRequest {
                job_id: input.job_id,
                reason: input.reason,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppArtifactRead")]
pub async fn local_app_artifact_read(input: NativeScenarioArtifactInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .read_scenario_artifact(LocalAppScenarioReadArtifactRequest {
                artifact_id: input.artifact_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppArtifactUpload")]
pub async fn local_app_artifact_upload(
    input: NativeScenarioArtifactUploadInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .upload_scenario_artifact(LocalAppScenarioUploadArtifactRequest {
                bytes: input.bytes.to_vec(),
                mime_type: input.mime_type,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppVoiceAssetsList")]
pub async fn local_app_voice_assets_list(
    input: NativeScenarioVoiceAssetsInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .list_scenario_voice_assets(LocalAppScenarioListVoiceAssetsRequest {
                page_size: input.page_size,
                page_token: input.page_token,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAssetStat")]
pub async fn local_app_asset_stat(input: NativeStorageReadInput) -> NativeJsonOutcome {
    invoke_asset_record(|session| async move {
        session
            .storage_asset_stat(LocalAppAssetStatRequest {
                relative_path: input.relative_path,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAssetList")]
pub async fn local_app_asset_list(input: NativeAssetListInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .storage_asset_list(LocalAppAssetListRequest {
            prefix: input.prefix,
            cursor: input.cursor,
            page_size: input.page_size,
        })
        .await
    {
        Ok(result) => NativeJsonOutcome::success(json!({
            "assets": result.assets.into_iter().map(project_asset_record).collect::<Vec<_>>(),
            "nextCursor": result.next_cursor,
        })),
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppAssetWriteOpen")]
pub async fn local_app_asset_write_open(input: NativeAssetWriteOpenInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let mut streams = asset_write_streams().lock().await;
    if streams.len() >= MAX_ASSET_STREAMS {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let stream_id = format!(
        "asset-write-{}",
        ASSET_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, body) = tokio::sync::mpsc::channel(2);
    let request = LocalAppAssetWriteRequest {
        relative_path: input.relative_path,
        media_type: input.media_type,
        overwrite: input.overwrite,
    };
    let task = tokio::spawn(async move { session.storage_asset_write(request, body).await });
    streams.insert(stream_id.clone(), AssetWriteStream { sender, task });
    NativeJsonOutcome::success(json!({ "streamId": stream_id }))
}

#[napi(js_name = "localAppAssetWriteChunk")]
pub async fn local_app_asset_write_chunk(input: NativeAssetWriteChunkInput) -> NativeJsonOutcome {
    if input.body_chunk.is_empty() || input.body_chunk.len() > MAX_ASSET_CHUNK_BYTES {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    }
    let sender = asset_write_streams()
        .lock()
        .await
        .get(input.stream_id.as_str())
        .map(|stream| stream.sender.clone());
    let Some(sender) = sender else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    };
    match sender.send(input.body_chunk.to_vec()).await {
        Ok(()) => NativeJsonOutcome::success(json!({ "accepted": true })),
        Err(_) => NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::Canceled,
            false,
        )),
    }
}

#[napi(js_name = "localAppAssetWriteCommit")]
pub async fn local_app_asset_write_commit(input: NativeScenarioStreamInput) -> NativeJsonOutcome {
    let stream = asset_write_streams()
        .lock()
        .await
        .remove(input.stream_id.as_str());
    let Some(stream) = stream else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    };
    drop(stream.sender);
    match stream.task.await {
        Ok(Ok(asset)) => NativeJsonOutcome::success(project_asset_record(asset)),
        Ok(Err(error)) => NativeJsonOutcome::error(error),
        Err(_) => NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::Canceled,
            false,
        )),
    }
}

#[napi(js_name = "localAppAssetWriteAbort")]
pub async fn local_app_asset_write_abort(input: NativeScenarioStreamInput) -> NativeJsonOutcome {
    let stream = asset_write_streams()
        .lock()
        .await
        .remove(input.stream_id.as_str());
    if let Some(stream) = stream {
        stream.task.abort();
        drop(stream.sender);
        NativeJsonOutcome::success(json!({ "closed": true }))
    } else {
        NativeJsonOutcome::success(json!({ "closed": false }))
    }
}

#[napi(js_name = "localAppAssetReadOpen")]
pub async fn local_app_asset_read_open(input: NativeAssetReadInput) -> NativeJsonOutcome {
    let offset = match optional_nonnegative_safe_i64(input.offset, false) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let length = match optional_nonnegative_safe_i64(input.length, true) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    if asset_read_streams().lock().await.len() >= MAX_ASSET_STREAMS {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    match session
        .storage_asset_read(LocalAppAssetReadRequest {
            relative_path: input.relative_path,
            offset,
            length,
        })
        .await
    {
        Ok(result) => {
            let stream_id = format!(
                "asset-read-{}",
                ASSET_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            asset_read_streams()
                .lock()
                .await
                .insert(stream_id.clone(), Arc::new(Mutex::new(result.body)));
            NativeJsonOutcome::success(json!({
                "streamId": stream_id,
                "asset": project_asset_record(result.asset),
                "range": { "offset": result.range.offset, "length": result.range.length, "totalSize": result.range.total_size },
            }))
        }
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppAssetReadNext")]
pub async fn local_app_asset_read_next(
    input: NativeScenarioStreamInput,
) -> NativeAssetReadNextOutcome {
    let receiver = asset_read_streams()
        .lock()
        .await
        .get(input.stream_id.as_str())
        .cloned();
    let Some(receiver) = receiver else {
        return asset_read_error(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    };
    let next = receiver.lock().await.recv().await;
    match next {
        Some(Ok(chunk)) => NativeAssetReadNextOutcome {
            status: "ok".into(),
            value: Some(chunk.into()),
            completed: Some(false),
            reason_code: None,
            retryable: None,
            reason_metadata: None,
        },
        Some(Err(error)) => {
            asset_read_streams()
                .lock()
                .await
                .remove(input.stream_id.as_str());
            asset_read_error(error)
        }
        None => {
            asset_read_streams()
                .lock()
                .await
                .remove(input.stream_id.as_str());
            NativeAssetReadNextOutcome {
                status: "ok".into(),
                value: None,
                completed: Some(true),
                reason_code: None,
                retryable: None,
                reason_metadata: None,
            }
        }
    }
}

#[napi(js_name = "localAppAssetReadClose")]
pub async fn local_app_asset_read_close(input: NativeScenarioStreamInput) -> NativeJsonOutcome {
    let closed = asset_read_streams()
        .lock()
        .await
        .remove(input.stream_id.as_str())
        .is_some();
    NativeJsonOutcome::success(json!({ "closed": closed }))
}

#[napi(js_name = "localAppAssetRemove")]
pub async fn local_app_asset_remove(input: NativeStorageRemoveInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .storage_asset_remove(LocalAppAssetRemoveRequest {
            relative_path: input.relative_path,
        })
        .await
    {
        Ok(result) => NativeJsonOutcome::success(json!({ "removed": result.removed })),
        Err(error) => NativeJsonOutcome::error(error),
    }
}

#[napi(js_name = "localAppAssetMove")]
pub async fn local_app_asset_move(input: NativeAssetMoveInput) -> NativeJsonOutcome {
    invoke_asset_record(|session| async move {
        session
            .storage_asset_move(LocalAppAssetMoveRequest {
                from_relative_path: input.from_relative_path,
                to_relative_path: input.to_relative_path,
                overwrite: input.overwrite,
            })
            .await
    })
    .await
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-044
#[napi(js_name = "localAppAssetReveal")]
pub async fn local_app_asset_reveal(input: NativeStorageReadInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let target = match session
        .storage_asset_reveal(LocalAppAssetRevealRequest {
            relative_path: input.relative_path,
        })
        .await
    {
        Ok(value) => value,
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            return NativeJsonOutcome::error(error);
        }
    };
    match tokio::task::spawn_blocking(move || {
        nimi_shell_protected_local::reveal_local_app_asset_target(target)
    })
    .await
    {
        Ok(Ok(())) => NativeJsonOutcome::success(json!({ "revealed": true })),
        Ok(Err(error)) => NativeJsonOutcome::error(error),
        Err(_) => NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::HostInternalError,
            false,
        )),
    }
}

#[napi(js_name = "localAppAssetAdopt")]
pub async fn local_app_asset_adopt(input: NativeAssetAdoptInput) -> NativeJsonOutcome {
    invoke_asset_record(|session| async move {
        session
            .storage_asset_adopt(LocalAppAssetAdoptRequest {
                artifact_id: input.artifact_id,
                relative_path: input.relative_path,
                overwrite: input.overwrite,
            })
            .await
    })
    .await
}

fn project_asset_record(asset: LocalAppAssetRecord) -> JsonValue {
    json!({ "relativePath": asset.relative_path, "mediaType": if asset.media_type.is_empty() { None } else { Some(asset.media_type) },
        "sizeBytes": asset.size_bytes, "sha256": asset.sha256, "createdAt": asset.created_at, "updatedAt": asset.updated_at })
}

async fn invoke_asset_record<F, Fut>(operation: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiLocalAppSession>) -> Fut,
    Fut: std::future::Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>>,
{
    let session = match current_or_open_session().await {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match operation(session.clone()).await {
        Ok(asset) => NativeJsonOutcome::success(project_asset_record(asset)),
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

fn optional_nonnegative_safe_i64(
    value: Option<f64>,
    positive: bool,
) -> Result<Option<i64>, LocalAppOperationError> {
    const MAX: f64 = 9_007_199_254_740_991.0;
    value
        .map(|value| {
            if !value.is_finite()
                || value.fract() != 0.0
                || value < if positive { 1.0 } else { 0.0 }
                || value > MAX
            {
                Err(LocalAppOperationError::new(
                    LocalAppReasonCode::InvalidRange,
                    false,
                ))
            } else {
                Ok(value as i64)
            }
        })
        .transpose()
}

fn asset_read_error(error: LocalAppOperationError) -> NativeAssetReadNextOutcome {
    NativeAssetReadNextOutcome {
        status: "error".into(),
        value: None,
        completed: None,
        reason_code: Some(error.reason_code().as_str().into()),
        retryable: Some(error.retryable()),
        reason_metadata: if error.reason_metadata().is_empty() {
            None
        } else {
            Some(json!(error.reason_metadata()))
        },
    }
}

#[napi(js_name = "localAppTextTurnSubscribe")]
pub async fn local_app_text_turn_subscribe(input: NativeTextCandidateInput) -> NativeJsonOutcome {
    let request = match native_text_request(input) {
        Ok(request) => request,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let receiver = match session.stream_text_turn(request).await {
        Ok(receiver) => receiver,
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            return NativeJsonOutcome::error(error);
        }
    };
    open_scenario_stream(text_turn_streams(), "text-turn", receiver).await
}

#[napi(js_name = "localAppTextTurnStreamNext")]
pub async fn local_app_text_turn_stream_next(
    input: NativeScenarioStreamInput,
) -> NativeJsonOutcome {
    scenario_stream_next(text_turn_streams(), input.stream_id).await
}

#[napi(js_name = "localAppTextTurnStreamClose")]
pub async fn local_app_text_turn_stream_close(
    input: NativeScenarioStreamInput,
) -> NativeJsonOutcome {
    scenario_stream_close(text_turn_streams(), input.stream_id).await
}

#[napi(js_name = "localAppScenarioJobSubscribe")]
pub async fn local_app_scenario_job_subscribe(input: NativeScenarioJobInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let receiver = match session
        .subscribe_scenario_job(LocalAppScenarioJobSubscribeRequest {
            job_id: input.job_id,
        })
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            return NativeJsonOutcome::error(error);
        }
    };
    open_scenario_stream(scenario_job_streams(), "scenario-job", receiver).await
}

#[napi(js_name = "localAppScenarioJobStreamNext")]
pub async fn local_app_scenario_job_stream_next(
    input: NativeScenarioStreamInput,
) -> NativeJsonOutcome {
    scenario_stream_next(scenario_job_streams(), input.stream_id).await
}

#[napi(js_name = "localAppScenarioJobStreamClose")]
pub async fn local_app_scenario_job_stream_close(
    input: NativeScenarioStreamInput,
) -> NativeJsonOutcome {
    scenario_stream_close(scenario_job_streams(), input.stream_id).await
}

fn native_text_request(
    input: NativeTextCandidateInput,
) -> Result<LocalAppTextCandidateRequest, LocalAppOperationError> {
    Ok(LocalAppTextCandidateRequest {
        messages: input
            .messages
            .into_iter()
            .map(|message| LocalAppTextCandidateMessage {
                role: message.role,
                text: message.text,
            })
            .collect(),
        temperature: input.temperature.map(|value| value as f32),
        top_p: input.top_p.map(|value| value as f32),
        max_tokens: optional_native_i32(input.max_tokens)?,
        top_k: optional_native_i32(input.top_k)?,
        presence_penalty: input.presence_penalty.map(|value| value as f32),
        frequency_penalty: input.frequency_penalty.map(|value| value as f32),
        stop: input.stop.unwrap_or_default(),
        seed: optional_native_i64(input.seed)?,
    })
}

fn optional_native_i32(value: Option<f64>) -> Result<Option<i32>, LocalAppOperationError> {
    value
        .map(|entry| {
            if !entry.is_finite()
                || entry.fract() != 0.0
                || entry < i32::MIN as f64
                || entry > i32::MAX as f64
            {
                return Err(LocalAppOperationError::new(
                    LocalAppReasonCode::InvalidPayload,
                    false,
                ));
            }
            Ok(entry as i32)
        })
        .transpose()
}

fn optional_native_i64(value: Option<f64>) -> Result<Option<i64>, LocalAppOperationError> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    value
        .map(|entry| {
            if !entry.is_finite() || entry.fract() != 0.0 || entry.abs() > MAX_SAFE_INTEGER {
                return Err(LocalAppOperationError::new(
                    LocalAppReasonCode::InvalidPayload,
                    false,
                ));
            }
            Ok(entry as i64)
        })
        .transpose()
}

async fn open_scenario_stream(
    registry: &'static Mutex<ScenarioStreamRegistry>,
    prefix: &str,
    receiver: LocalAppScenarioStreamReceiver,
) -> NativeJsonOutcome {
    let mut streams = registry.lock().await;
    if streams.len() >= MAX_SCENARIO_STREAMS {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let stream_id = format!(
        "{}-{}",
        prefix,
        SCENARIO_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let (close_tx, _) = watch::channel(false);
    streams.insert(
        stream_id.clone(),
        Arc::new(ScenarioStream {
            receiver: Mutex::new(Some(receiver)),
            close_tx,
        }),
    );
    NativeJsonOutcome::success(json!({ "streamId": stream_id }))
}

async fn scenario_stream_next(
    registry: &'static Mutex<ScenarioStreamRegistry>,
    stream_id: String,
) -> NativeJsonOutcome {
    let stream = registry.lock().await.get(stream_id.as_str()).cloned();
    let Some(stream) = stream else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    };
    let mut close_rx = stream.close_tx.subscribe();
    let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    };
    let Some(receiver) = receiver_slot.as_mut() else {
        return NativeJsonOutcome::success(json!({ "completed": true }));
    };
    let next = tokio::select! {
        biased;
        _ = close_rx.changed() => None,
        next = receiver.recv() => next,
    };
    match next {
        Some(Ok(event)) => {
            NativeJsonOutcome::success(json!({ "completed": false, "event": event }))
        }
        Some(Err(error)) => {
            registry.lock().await.remove(stream_id.as_str());
            NativeJsonOutcome::error(error)
        }
        None => {
            registry.lock().await.remove(stream_id.as_str());
            NativeJsonOutcome::success(json!({ "completed": true }))
        }
    }
}

async fn scenario_stream_close(
    registry: &'static Mutex<ScenarioStreamRegistry>,
    stream_id: String,
) -> NativeJsonOutcome {
    let stream = registry.lock().await.remove(stream_id.as_str());
    if let Some(stream) = stream.as_ref() {
        stream.close_tx.send_replace(true);
        stream.receiver.lock().await.take();
    }
    NativeJsonOutcome::success(json!({ "closed": stream.is_some() }))
}

#[napi(js_name = "localAppRealmWorldCoreList")]
pub async fn local_app_realm_world_core_list(input: NativeWorldCoreListInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_world_core_list(LocalAppWorldCoreListRequest {
                take: input.take,
                visibility: input.visibility,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmWorldCoreCreate")]
pub async fn local_app_realm_world_core_create(
    input: NativeWorldCoreCreateInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_world_core_create(LocalAppWorldCoreCreateRequest { body: input.body })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmPersonaCharacterListOwned")]
pub async fn local_app_realm_persona_character_list_owned(
    input: NativePersonaCharacterListOwnedInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_persona_character_list_owned(LocalAppPersonaCharacterListOwnedRequest {
                world_id: input.world_id,
                visibility: input.visibility,
                after_id: input.after_id,
                take: input.take,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmPersonaCharacterGetOwned")]
pub async fn local_app_realm_persona_character_get_owned(
    input: NativePersonaCharacterGetOwnedInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_persona_character_get_owned(LocalAppPersonaCharacterGetOwnedRequest {
                persona_character_id: input.persona_character_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmPersonaCharacterCreate")]
pub async fn local_app_realm_persona_character_create(
    input: NativePersonaCharacterCreateInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_persona_character_create(LocalAppPersonaCharacterCreateRequest {
                body: input.body,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmPersonaCharacterReplace")]
pub async fn local_app_realm_persona_character_replace(
    input: NativePersonaCharacterReplaceInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_persona_character_replace(LocalAppPersonaCharacterReplaceRequest {
                persona_character_id: input.persona_character_id,
                body: input.body,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmPersonaCharacterDelete")]
pub async fn local_app_realm_persona_character_delete(
    input: NativePersonaCharacterDeleteInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_persona_character_delete(LocalAppPersonaCharacterDeleteRequest {
                persona_character_id: input.persona_character_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentReferenceList")]
pub async fn local_app_agent_reference_list() -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session.agent_reference_list().await.map(|references| {
            JsonValue::Array(
                references
                    .into_iter()
                    .map(project_agent_reference)
                    .collect(),
            )
        })
    })
    .await
}

fn project_agent_reference(reference: LocalAppAgentReference) -> JsonValue {
    json!({
        "agentHandle": reference.agent_handle,
        "displayName": reference.display_name,
        "avatarUrl": reference.avatar_url,
    })
}

#[napi(js_name = "localAppSharedAgentAIConfigGet")]
pub async fn local_app_shared_agent_ai_config_get() -> NativeJsonOutcome {
    invoke_agent(|session| async move { session.shared_agent_ai_config_get().await }).await
}

#[napi(js_name = "localAppSharedAgentAIConfigOverwrite")]
pub async fn local_app_shared_agent_ai_config_overwrite(
    input: NativeAppAIConfigOverwriteInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .shared_agent_ai_config_overwrite(LocalAppSharedAgentAIConfigOverwriteRequest {
                expected_revision: input.expected_revision,
                capabilities: input.capabilities,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppSharedAgentAIConfigLocalOptions")]
pub async fn local_app_shared_agent_ai_config_local_options(
    input: NativeAIConfigLocalOptionsInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .shared_agent_ai_config_local_options(LocalAppSharedAgentAIConfigLocalOptionsRequest {
                kind: input.kind,
                capability_contract: input.capability_contract,
                connector_ref: input.connector_ref.unwrap_or_default(),
                search: input.search.unwrap_or_default(),
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentAutonomySnapshot")]
pub async fn local_app_agent_autonomy_snapshot(input: NativeAgentHandleInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_autonomy_snapshot(LocalAppAgentHandleRequest {
                agent_handle: input.agent_handle,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentUpdateAutonomy")]
pub async fn local_app_agent_update_autonomy(
    input: NativeAgentUpdateAutonomyInput,
) -> NativeJsonOutcome {
    let revision = match decimal_revision(&input.expected_autonomy_revision, false) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .agent_update_autonomy(LocalAppAgentUpdateAutonomyRequest {
                agent_handle: input.agent_handle,
                expected_autonomy_revision: revision,
                intent: input.intent,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentPresentationSnapshot")]
pub async fn local_app_agent_presentation_snapshot(
    input: NativeAgentHandleInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_presentation_snapshot(LocalAppAgentHandleRequest {
                agent_handle: input.agent_handle,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentCommitPresentation")]
pub async fn local_app_agent_commit_presentation(
    input: NativeAgentCommitPresentationInput,
) -> NativeJsonOutcome {
    let revision = match decimal_revision(&input.expected_presentation_revision, true) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .agent_commit_presentation(LocalAppAgentCommitPresentationRequest {
                agent_handle: input.agent_handle,
                expected_presentation_revision: revision,
                intent: input.intent,
                imported_assets: input.imported_assets,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppStorageReadJson")]
pub async fn local_app_storage_read_json(input: NativeStorageReadInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .storage_read_json(LocalAppStorageReadRequest {
                relative_path: input.relative_path,
            })
            .await
            .map(|document| json!({"value": document.value, "sizeBytes": document.size_bytes}))
    })
    .await
}

#[napi(js_name = "localAppStorageWriteJson")]
pub async fn local_app_storage_write_json(input: NativeStorageWriteInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .storage_write_json(LocalAppStorageWriteRequest {
                relative_path: input.relative_path,
                value: input.value,
            })
            .await
            .map(|document| json!({"value": document.value, "sizeBytes": document.size_bytes}))
    })
    .await
}

#[napi(js_name = "localAppStorageRemoveJson")]
pub async fn local_app_storage_remove_json(input: NativeStorageRemoveInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .storage_remove_json(LocalAppStorageRemoveRequest {
                relative_path: input.relative_path,
            })
            .await
            .map(|result| json!({"removed": result.removed}))
    })
    .await
}

#[napi(js_name = "localAppConversationOpen")]
pub async fn local_app_conversation_open(input: NativeConversationOpenInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .conversation_open(LocalAppConversationOpenRequest {
                agent_handle: input.agent_handle,
            })
            .await
            .map(|result| {
                json!({
                    "conversationAnchorId": result.conversation_anchor_id,
                    "activeTurnId": result.active_turn_id,
                })
            })
    })
    .await
}

#[napi(js_name = "localAppConversationSendTurn")]
pub async fn local_app_conversation_send_turn(
    input: NativeConversationSendInput,
) -> NativeJsonOutcome {
    let parts = match native_conversation_input_parts(input.parts) {
        Ok(parts) => parts,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .conversation_send_turn(LocalAppConversationSendRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
                request_id: input.request_id,
                parts,
            })
            .await
            .map(|result| json!({ "turnId": result.turn_id }))
    })
    .await
}

#[napi(js_name = "localAppConversationAttachmentUpload")]
pub async fn local_app_conversation_attachment_upload(
    input: NativeConversationAttachmentUploadInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .conversation_attachment_upload(LocalAppConversationAttachmentUploadRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
                mime_type: input.mime_type,
                display_name: input.display_name,
                bytes: input.bytes.to_vec(),
            })
            .await
            .map(|result| {
                json!({
                    "artifactId": result.artifact_id,
                    "expiresAt": result.expires_at,
                })
            })
    })
    .await
}

#[napi(js_name = "localAppConversationArtifactRead")]
pub async fn local_app_conversation_artifact_read(
    input: NativeConversationArtifactReadInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .conversation_artifact_read(LocalAppConversationArtifactReadRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
                artifact_id: input.artifact_id,
            })
            .await
            .map(|result| {
                json!({
                    "artifactId": result.artifact_id,
                    "bytes": result.bytes,
                    "mimeType": result.mime_type,
                    "byteLength": result.byte_length,
                })
            })
    })
    .await
}

#[napi(js_name = "localAppConversationVoiceTranscribe")]
pub async fn local_app_conversation_voice_transcribe(
    input: NativeConversationVoiceTranscriptionInput,
) -> NativeJsonOutcome {
    let request_id = input.request_id.trim().to_string();
    if request_id.is_empty() || request_id.len() > 256 {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::AiVoiceInputInvalid,
            false,
        ));
    }
    run_conversation_voice_transcription(
        request_id,
        invoke_agent(|session| async move {
            session
                .conversation_voice_transcribe(LocalAppConversationVoiceTranscriptionRequest {
                    agent_handle: input.agent_handle,
                    conversation_anchor_id: input.conversation_anchor_id,
                    request_id: input.request_id,
                    mime_type: input.mime_type,
                    audio_bytes: input.audio_bytes.to_vec(),
                })
                .await
                .map(|result| json!({ "text": result.text }))
        }),
    )
    .await
}

#[napi(js_name = "localAppConversationVoiceTranscribeCancel")]
pub async fn local_app_conversation_voice_transcribe_cancel(
    input: NativeConversationVoiceTranscriptionCancelInput,
) -> NativeJsonOutcome {
    let request_id = input.request_id.trim().to_string();
    if request_id.is_empty() || request_id.len() > 256 {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::AiVoiceInputInvalid,
            false,
        ));
    }
    let cancellation = {
        let mut registry = conversation_voice_cancellations().lock().await;
        match registry.remove(&request_id) {
            Some(ConversationVoiceCancellation::Active(cancellation)) => Some(cancellation),
            Some(ConversationVoiceCancellation::Pending) => {
                registry.insert(request_id, ConversationVoiceCancellation::Pending);
                None
            }
            None => {
                registry.insert(request_id, ConversationVoiceCancellation::Pending);
                None
            }
        }
    };
    if let Some(cancellation) = cancellation {
        cancellation.notify_one();
    }
    NativeJsonOutcome::success(json!({ "canceled": true }))
}

async fn run_conversation_voice_transcription<F>(
    request_id: String,
    operation: F,
) -> NativeJsonOutcome
where
    F: Future<Output = NativeJsonOutcome>,
{
    let cancellation = Arc::new(Notify::new());
    {
        let mut registry = conversation_voice_cancellations().lock().await;
        match registry.remove(&request_id) {
            Some(ConversationVoiceCancellation::Pending) => {
                return NativeJsonOutcome::error(LocalAppOperationError::new(
                    LocalAppReasonCode::Canceled,
                    true,
                ));
            }
            Some(existing @ ConversationVoiceCancellation::Active(_)) => {
                registry.insert(request_id, existing);
                return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
            }
            None => {
                registry.insert(
                    request_id.clone(),
                    ConversationVoiceCancellation::Active(Arc::clone(&cancellation)),
                );
            }
        }
    }
    tokio::pin!(operation);
    let outcome = tokio::select! {
        biased;
        outcome = &mut operation => outcome,
        () = cancellation.notified() => NativeJsonOutcome::error(LocalAppOperationError::new(LocalAppReasonCode::Canceled, true)),
    };
    let mut registry = conversation_voice_cancellations().lock().await;
    if matches!(registry.get(&request_id), Some(ConversationVoiceCancellation::Active(current)) if Arc::ptr_eq(current, &cancellation))
    {
        registry.remove(&request_id);
    }
    outcome
}

fn native_conversation_input_parts(
    value: JsonValue,
) -> Result<Vec<LocalAppConversationInputPart>, LocalAppOperationError> {
    let parts = value.as_array().ok_or_else(native_invalid_payload)?;
    if parts.is_empty() || parts.len() > 2 {
        return Err(native_invalid_payload());
    }
    parts
        .iter()
        .map(|part| {
            let record = part.as_object().ok_or_else(native_invalid_payload)?;
            match record.get("kind").and_then(JsonValue::as_str) {
                Some("text") if record.len() == 2 => record
                    .get("text")
                    .and_then(JsonValue::as_str)
                    .map(|text| LocalAppConversationInputPart::Text(text.to_string()))
                    .ok_or_else(native_invalid_payload),
                Some("artifact-ref") if record.len() == 2 => record
                    .get("artifactId")
                    .and_then(JsonValue::as_str)
                    .map(|artifact_id| {
                        LocalAppConversationInputPart::ArtifactRef(artifact_id.to_string())
                    })
                    .ok_or_else(native_invalid_payload),
                _ => Err(native_invalid_payload()),
            }
        })
        .collect()
}

fn native_invalid_payload() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false)
}

#[napi(js_name = "localAppConversationInterruptTurn")]
pub async fn local_app_conversation_interrupt_turn(
    input: NativeConversationScopeInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .conversation_interrupt_turn(LocalAppConversationInterruptRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
            })
            .await
            .map(|result| json!({ "turnId": result.turn_id }))
    })
    .await
}

#[napi(js_name = "localAppConversationSnapshot")]
pub async fn local_app_conversation_snapshot(
    input: NativeConversationScopeInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .conversation_snapshot(LocalAppConversationSnapshotRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
            })
            .await
            .map(|snapshot| {
                json!({
                    "conversationAnchorId": snapshot.conversation_anchor_id,
                    "throughSequence": snapshot.through_sequence.to_string(),
                    "turns": snapshot.turns,
                    "messages": snapshot.messages.into_iter().map(|message| json!({
                        "messageId": message.message_id,
                        "turnId": message.turn_id,
                        "role": match message.role {
                            LocalAppConversationMessageRole::User => "user",
                            LocalAppConversationMessageRole::Assistant => "assistant",
                        },
                        "parts": message.parts,
                    })).collect::<Vec<_>>(),
                    "actions": snapshot.actions,
                    "voices": snapshot.voices,
                    "truncatedBefore": snapshot.truncated_before,
                })
            })
    })
    .await
}

#[napi(js_name = "localAppConversationSubscribe")]
pub async fn local_app_conversation_subscribe(
    input: NativeConversationScopeInput,
) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    let stream_id = format!(
        "conversation-{}",
        CONVERSATION_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    {
        let registry = conversation_streams().lock().await;
        if registry.len() >= MAX_CONVERSATION_STREAMS {
            return NativeJsonOutcome::error(LocalAppOperationError::new(
                LocalAppReasonCode::ResourceExhausted,
                false,
            ));
        }
    }
    let receiver = match session
        .conversation_subscribe(LocalAppConversationSubscribeRequest {
            agent_handle: input.agent_handle,
            conversation_anchor_id: input.conversation_anchor_id,
        })
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            return NativeJsonOutcome::error(error);
        }
    };
    let (close_tx, _) = watch::channel(false);
    conversation_streams().lock().await.insert(
        stream_id.clone(),
        Arc::new(ConversationStream {
            receiver: Mutex::new(Some(receiver)),
            close_tx,
        }),
    );
    NativeJsonOutcome::success(json!({ "streamId": stream_id }))
}

#[napi(js_name = "localAppConversationStreamNext")]
pub async fn local_app_conversation_stream_next(
    input: NativeConversationStreamInput,
) -> NativeJsonOutcome {
    let stream = conversation_streams()
        .lock()
        .await
        .get(input.stream_id.as_str())
        .cloned();
    let Some(stream) = stream else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    };
    let mut close_rx = stream.close_tx.subscribe();
    let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    };
    let Some(receiver) = receiver_slot.as_mut() else {
        return NativeJsonOutcome::success(json!({ "completed": true }));
    };
    let next = tokio::select! {
        biased;
        _ = close_rx.changed() => None,
        next = receiver.recv() => next,
    };
    match next {
        Some(Ok(event)) => NativeJsonOutcome::success(
            json!({ "completed": false, "event": project_conversation_event(event) }),
        ),
        Some(Err(error)) => {
            conversation_streams()
                .lock()
                .await
                .remove(input.stream_id.as_str());
            NativeJsonOutcome::error(error)
        }
        None => {
            conversation_streams()
                .lock()
                .await
                .remove(input.stream_id.as_str());
            NativeJsonOutcome::success(json!({ "completed": true }))
        }
    }
}

#[napi(js_name = "localAppConversationStreamClose")]
pub async fn local_app_conversation_stream_close(
    input: NativeConversationStreamInput,
) -> NativeJsonOutcome {
    let stream = conversation_streams()
        .lock()
        .await
        .remove(input.stream_id.as_str());
    if let Some(stream) = stream.as_ref() {
        stream.close_tx.send_replace(true);
        stream.receiver.lock().await.take();
    }
    NativeJsonOutcome::success(json!({ "closed": stream.is_some() }))
}

#[napi(js_name = "localAppAiRealtimeOpen")]
pub async fn local_app_ai_realtime_open(input: NativeAiRealtimeOpenInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .ai_realtime_open(LocalAppAiRealtimeOpenRequest {
                input_audio: input.input_audio,
                audio_output_enabled: input.audio_output_enabled,
                turn_detection: input.turn_detection,
                initial_instruction: input.initial_instruction,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmRealtimeOpen")]
pub async fn local_app_realm_realtime_open() -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_realtime_open(LocalAppRealmRealtimeOpenRequest)
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmChatList")]
pub async fn local_app_realm_chat_list(input: NativeRealmChatListInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_chat_list(LocalAppRealmChatListRequest {
                cursor: input.cursor,
                limit: input.limit,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmRealtimeSubscribe")]
pub async fn local_app_realm_realtime_subscribe(
    input: NativeRealmRealtimeSubscribeInput,
) -> NativeJsonOutcome {
    subscribe_realtime("realm", |session| async move {
        session
            .realm_realtime_subscribe(LocalAppRealmRealtimeSubscribeRequest {
                channel_id: input.channel_id,
                target: input.target,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmRealtimeAck")]
pub async fn local_app_realm_realtime_ack(input: NativeRealmRealtimeAckInput) -> NativeJsonOutcome {
    let cursor = match native_realtime_generation(&input.cursor) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .realm_realtime_ack(LocalAppRealmRealtimeAckRequest {
                channel_id: input.channel_id,
                subscription_id: input.subscription_id,
                cursor,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmRealtimeSubscriptionClose")]
pub async fn local_app_realm_realtime_subscription_close(
    input: NativeRealmRealtimeSubscriptionInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_realtime_subscription_close(LocalAppRealmRealtimeSubscriptionRequest {
                channel_id: input.channel_id,
                subscription_id: input.subscription_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppRealmRealtimeChannelClose")]
pub async fn local_app_realm_realtime_channel_close(
    input: NativeRealmRealtimeChannelInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .realm_realtime_channel_close(LocalAppRealmRealtimeChannelRequest {
                channel_id: input.channel_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAiRealtimeAppendInput")]
pub async fn local_app_ai_realtime_append_input(
    input: NativeAiRealtimeAppendInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .ai_realtime_append_input(LocalAppAiRealtimeAppendInputRequest {
                realtime_session_id: input.realtime_session_id,
                generation,
                input: input.input,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAiRealtimeSubmitOwnerControl")]
pub async fn local_app_ai_realtime_submit_owner_control(
    input: NativeAiRealtimeOwnerControlInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .ai_realtime_submit_owner_control(LocalAppAiRealtimeOwnerControlRequest {
                realtime_session_id: input.realtime_session_id,
                generation,
                request_id: input.request_id,
                control: input.control,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAiRealtimeSubscribe")]
pub async fn local_app_ai_realtime_subscribe(
    input: NativeAiRealtimeSessionInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    subscribe_realtime("ai", |session| async move {
        session
            .ai_realtime_subscribe(LocalAppAiRealtimeSessionRequest {
                realtime_session_id: input.realtime_session_id,
                generation,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAiRealtimeInterruptOutput")]
pub async fn local_app_ai_realtime_interrupt_output(
    input: NativeAiRealtimeOutputInterruptInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .ai_realtime_interrupt_output(LocalAppAiRealtimeOutputInterruptRequest {
                realtime_session_id: input.realtime_session_id,
                generation,
                output_track_id: input.output_track_id,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAiRealtimeClose")]
pub async fn local_app_ai_realtime_close(input: NativeAiRealtimeSessionInput) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .ai_realtime_close(LocalAppAiRealtimeSessionRequest {
                realtime_session_id: input.realtime_session_id,
                generation,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentRealtimeOpen")]
pub async fn local_app_agent_realtime_open(
    input: NativeAgentRealtimeOpenInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_realtime_open(LocalAppAgentRealtimeOpenRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
                input_audio: input.input_audio,
                turn_detection: input.turn_detection,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentRealtimeAppendInput")]
pub async fn local_app_agent_realtime_append_input(
    input: NativeAgentRealtimeAppendInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .agent_realtime_append_input(LocalAppAgentRealtimeAppendInputRequest {
                agent_handle: input.agent_handle,
                realtime_session_id: input.realtime_session_id,
                generation,
                input: input.input,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentRealtimeSubscribe")]
pub async fn local_app_agent_realtime_subscribe(
    input: NativeAgentRealtimeSessionInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    subscribe_realtime("agent", |session| async move {
        session
            .agent_realtime_subscribe(LocalAppAgentRealtimeSessionRequest {
                agent_handle: input.agent_handle,
                realtime_session_id: input.realtime_session_id,
                generation,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentRealtimeStatus")]
pub async fn local_app_agent_realtime_status(
    input: NativeAgentRealtimeSessionInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .agent_realtime_status(LocalAppAgentRealtimeSessionRequest {
                agent_handle: input.agent_handle,
                realtime_session_id: input.realtime_session_id,
                generation,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentRealtimeInterruptOutput")]
pub async fn local_app_agent_realtime_interrupt_output(
    input: NativeAgentRealtimeOutputInterruptInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .agent_realtime_interrupt_output(LocalAppAgentRealtimeOutputInterruptRequest {
                agent_handle: input.agent_handle,
                realtime_session_id: input.realtime_session_id,
                generation,
                output_track_id: input.output_track_id,
                interrupt_agent_turn: input.interrupt_agent_turn,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppAgentRealtimeClose")]
pub async fn local_app_agent_realtime_close(
    input: NativeAgentRealtimeSessionInput,
) -> NativeJsonOutcome {
    let generation = match native_realtime_generation(&input.generation) {
        Ok(value) => value,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    invoke_agent(|session| async move {
        session
            .agent_realtime_close(LocalAppAgentRealtimeSessionRequest {
                agent_handle: input.agent_handle,
                realtime_session_id: input.realtime_session_id,
                generation,
            })
            .await
    })
    .await
}

async fn subscribe_realtime<F, Fut>(kind: &str, operation: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiLocalAppSession>) -> Fut,
    Fut: Future<Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>>,
{
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    if realtime_streams().lock().await.len() >= MAX_REALTIME_STREAMS {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let receiver = match operation(Arc::clone(&session)).await {
        Ok(receiver) => receiver,
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            return NativeJsonOutcome::error(error);
        }
    };
    let stream_id = format!(
        "realtime-{kind}-{}",
        REALTIME_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let (close_tx, _) = watch::channel(false);
    realtime_streams().lock().await.insert(
        stream_id.clone(),
        Arc::new(RealtimeStream {
            receiver: Mutex::new(Some(receiver)),
            close_tx,
        }),
    );
    NativeJsonOutcome::success(json!({"streamId":stream_id}))
}

#[napi(js_name = "localAppRealtimeStreamNext")]
pub async fn local_app_realtime_stream_next(input: NativeRealtimeStreamInput) -> NativeJsonOutcome {
    let stream = realtime_streams()
        .lock()
        .await
        .get(input.stream_id.as_str())
        .cloned();
    let Some(stream) = stream else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    };
    let mut close_rx = stream.close_tx.subscribe();
    let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    };
    let Some(receiver) = receiver_slot.as_mut() else {
        return NativeJsonOutcome::success(json!({"completed":true}));
    };
    let next = tokio::select! {
        biased;
        _ = close_rx.changed() => None,
        next = receiver.recv() => next,
    };
    match next {
        Some(Ok(event)) => NativeJsonOutcome::success(json!({"completed":false,"event":event})),
        Some(Err(error)) => {
            realtime_streams()
                .lock()
                .await
                .remove(input.stream_id.as_str());
            NativeJsonOutcome::error(error)
        }
        None => {
            realtime_streams()
                .lock()
                .await
                .remove(input.stream_id.as_str());
            NativeJsonOutcome::success(json!({"completed":true}))
        }
    }
}

#[napi(js_name = "localAppRealtimeStreamClose")]
pub async fn local_app_realtime_stream_close(
    input: NativeRealtimeStreamInput,
) -> NativeJsonOutcome {
    let stream = realtime_streams()
        .lock()
        .await
        .remove(input.stream_id.as_str());
    if let Some(stream) = stream.as_ref() {
        stream.close_tx.send_replace(true);
        stream.receiver.lock().await.take();
    }
    NativeJsonOutcome::success(json!({"closed":stream.is_some()}))
}

fn native_realtime_generation(value: &str) -> Result<u64, LocalAppOperationError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|generation| *generation > 0)
        .ok_or_else(native_invalid_payload)
}

fn project_conversation_event(event: LocalAppConversationEvent) -> JsonValue {
    let mut projection = match event.event {
        LocalAppConversationEventKind::TurnAccepted { turn_id } => json!({
            "type": "turn-accepted", "turnId": turn_id,
        }),
        LocalAppConversationEventKind::TurnStarted { turn_id } => json!({
            "type": "turn-started", "turnId": turn_id,
        }),
        LocalAppConversationEventKind::TextDelta { turn_id, delta } => json!({
            "type": "text-delta", "turnId": turn_id, "delta": delta,
        }),
        LocalAppConversationEventKind::ReasoningStatus { turn_id, state } => json!({
            "type": "reasoning-status", "turnId": turn_id, "state": state,
        }),
        LocalAppConversationEventKind::LiveAction { turn_id, action } => json!({
            "type": "live-action", "turnId": turn_id, "action": action,
        }),
        LocalAppConversationEventKind::LiveTool { turn_id, tool } => json!({
            "type": "live-tool", "turnId": turn_id, "tool": tool,
        }),
        LocalAppConversationEventKind::MessageCommitted { turn_id, message } => json!({
            "type": "message-committed", "turnId": turn_id, "message": message,
        }),
        LocalAppConversationEventKind::ActionPlanned { turn_id, action } => json!({
            "type": "action-planned", "turnId": turn_id, "action": action,
        }),
        LocalAppConversationEventKind::ActionStarted { turn_id, action } => json!({
            "type": "action-started", "turnId": turn_id, "action": action,
        }),
        LocalAppConversationEventKind::ArtifactReady {
            turn_id,
            action_id,
            capability_contract,
            projection_message_id,
            artifact_id,
        } => json!({
            "type": "artifact-ready", "turnId": turn_id, "actionId": action_id,
            "capabilityContract": capability_contract, "projectionMessageId": projection_message_id,
            "artifactId": artifact_id,
        }),
        LocalAppConversationEventKind::ActionCompleted { turn_id, action } => json!({
            "type": "action-completed", "turnId": turn_id, "action": action,
        }),
        LocalAppConversationEventKind::ActionFailed { turn_id, action } => json!({
            "type": "action-failed", "turnId": turn_id, "action": action,
        }),
        LocalAppConversationEventKind::VoiceReady { turn_id, voice } => json!({
            "type": "voice-ready", "turnId": turn_id, "voice": voice,
        }),
        LocalAppConversationEventKind::VoiceFailed { turn_id, voice } => json!({
            "type": "voice-failed", "turnId": turn_id, "voice": voice,
        }),
        LocalAppConversationEventKind::TurnCompleted {
            turn_id,
            terminal_reason,
        } => json!({
            "type": "turn-completed", "turnId": turn_id, "terminalReason": terminal_reason,
        }),
        LocalAppConversationEventKind::TurnFailed {
            turn_id,
            reason_code,
            message,
        } => json!({
            "type": "turn-failed", "turnId": turn_id, "reasonCode": reason_code, "message": message,
        }),
        LocalAppConversationEventKind::TurnInterrupted { turn_id, reason } => json!({
            "type": "turn-interrupted", "turnId": turn_id, "reason": reason,
        }),
    };
    if let Some(object) = projection.as_object_mut() {
        object.insert(
            "conversationAnchorId".to_string(),
            JsonValue::String(event.conversation_anchor_id),
        );
        object.insert(
            "sequence".to_string(),
            JsonValue::String(event.sequence.to_string()),
        );
    }
    projection
}

async fn invoke_agent<F, Fut>(operation: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiLocalAppSession>) -> Fut,
    Fut: std::future::Future<Output = Result<JsonValue, LocalAppOperationError>>,
{
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match operation(session.clone()).await {
        Ok(value) => NativeJsonOutcome::success(value),
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

fn decimal_revision(value: &str, allow_zero: bool) -> Result<u64, LocalAppOperationError> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || (!allow_zero && value == "0")
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    }
    value
        .parse::<u64>()
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false))
}

async fn current_or_open_session() -> Result<Arc<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let mut current = LOCAL_APP_SESSION.lock().await;
    if let Some(session) = current.as_ref() {
        return Ok(session.clone());
    }
    let opened = PlatformLocalAppCarrier::default()
        .open_local_app_session()
        .await?;
    let session = Arc::<dyn NimiLocalAppSession>::from(opened);
    *current = Some(session.clone());
    Ok(session)
}

fn invalidates_local_app_session(reason: LocalAppReasonCode) -> bool {
    // These channels have a one-shot connector: any transport-level failure is
    // unrecoverable in place, so the cached session must be dropped for the
    // next call to open a freshly verified channel. Unclassified covers the
    // abrupt-loss case (a mid-RPC/mid-stream Runtime death surfaces as an
    // unmapped transport error).
    matches!(
        reason,
        LocalAppReasonCode::RuntimeServiceUnavailable
            | LocalAppReasonCode::RuntimeServiceUntrusted
            | LocalAppReasonCode::RuntimeServiceErrorUnclassified
            | LocalAppReasonCode::ProcessReplaced
            | LocalAppReasonCode::RuntimeRestarted
    )
}

async fn clear_session_on_transport_failure(
    session: &Arc<dyn NimiLocalAppSession>,
    error: &LocalAppOperationError,
) {
    if !invalidates_local_app_session(error.reason_code()) {
        return;
    }
    let mut current = LOCAL_APP_SESSION.lock().await;
    if current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
    {
        *current = None;
    }
}

#[cfg(test)]
mod session_rebind_tests {
    use super::*;

    #[test]
    fn account_and_session_invalidation_preserve_same_host_rebind_carrier() {
        for reason in [
            LocalAppReasonCode::RuntimeUnauthenticated,
            LocalAppReasonCode::AccountChanged,
            LocalAppReasonCode::Revoked,
        ] {
            assert!(!invalidates_local_app_session(reason), "{reason:?}");
        }
        assert!(invalidates_local_app_session(
            LocalAppReasonCode::RuntimeServiceUnavailable
        ));
    }

    #[test]
    fn abrupt_loss_unclassified_failure_invalidates_one_shot_channel_session() {
        assert!(invalidates_local_app_session(
            LocalAppReasonCode::RuntimeServiceErrorUnclassified
        ));
    }

    #[test]
    fn configure_revisions_are_canonical_decimal_values() {
        assert_eq!(
            decimal_revision("0", true).expect("initial presentation"),
            0
        );
        assert!(decimal_revision("0", false).is_err());
        assert!(decimal_revision("01", true).is_err());
        assert_eq!(
            decimal_revision(&u64::MAX.to_string(), false).expect("u64 max"),
            u64::MAX,
        );
    }

    #[test]
    fn native_text_conversion_preserves_absent_and_explicit_zero() {
        let request = native_text_request(NativeTextCandidateInput {
            messages: vec![NativeTextCandidateMessage {
                role: "user".to_string(),
                text: "hello".to_string(),
            }],
            temperature: Some(0.0),
            top_p: None,
            max_tokens: Some(0.0),
            top_k: Some(0.0),
            presence_penalty: Some(-2.0),
            frequency_penalty: Some(2.0),
            stop: Some(vec!["END".to_string()]),
            seed: Some(0.0),
        })
        .expect("native optional parameters");
        assert_eq!(request.temperature, Some(0.0));
        assert_eq!(request.top_p, None);
        assert_eq!(request.max_tokens, Some(0));
        assert_eq!(request.top_k, Some(0));
        assert_eq!(request.seed, Some(0));
    }

    #[test]
    fn native_text_conversion_rejects_non_integer_or_unsafe_numbers() {
        assert!(optional_native_i32(Some(0.5)).is_err());
        assert!(optional_native_i64(Some(9_007_199_254_740_992.0)).is_err());
    }

    #[tokio::test]
    async fn conversation_voice_cancel_before_registration_is_consumed() {
        let request_id = "conversation-voice-cancel-before".to_string();
        let canceled = local_app_conversation_voice_transcribe_cancel(
            NativeConversationVoiceTranscriptionCancelInput {
                request_id: request_id.clone(),
            },
        )
        .await;
        assert_eq!(canceled.status, "ok");
        let outcome = run_conversation_voice_transcription(request_id, async {
            NativeJsonOutcome::success(json!({ "text": "late" }))
        })
        .await;
        assert_eq!(outcome.status, "error");
        assert_eq!(outcome.reason_code.as_deref(), Some("canceled"));
    }

    #[tokio::test]
    async fn conversation_voice_cancel_drops_active_operation() {
        let request_id = "conversation-voice-cancel-active".to_string();
        let entered = Arc::new(Notify::new());
        let operation_entered = Arc::clone(&entered);
        let task_request_id = request_id.clone();
        let task = tokio::spawn(async move {
            run_conversation_voice_transcription(task_request_id, async move {
                operation_entered.notify_one();
                std::future::pending::<NativeJsonOutcome>().await
            })
            .await
        });
        entered.notified().await;
        let canceled = local_app_conversation_voice_transcribe_cancel(
            NativeConversationVoiceTranscriptionCancelInput { request_id },
        )
        .await;
        assert_eq!(canceled.status, "ok");
        let outcome = task.await.expect("conversation voice operation must join");
        assert_eq!(outcome.status, "error");
        assert_eq!(outcome.reason_code.as_deref(), Some("canceled"));
    }
}
