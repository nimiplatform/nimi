use super::*;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};
use tokio::sync::watch;

type ConversationStreamRegistry = HashMap<String, Arc<ConversationStream>>;
struct ConversationStream {
    receiver: Mutex<Option<LocalAppConversationSubscriptionReceiver>>,
    close_tx: watch::Sender<bool>,
}
static CONVERSATION_STREAMS: OnceLock<Mutex<ConversationStreamRegistry>> = OnceLock::new();
static CONVERSATION_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_CONVERSATION_STREAMS: usize = 8;

type ScenarioStreamRegistry = HashMap<String, Arc<ScenarioStream>>;
struct ScenarioStream {
    receiver: Mutex<Option<LocalAppScenarioStreamReceiver>>,
    close_tx: watch::Sender<bool>,
}
static SCENARIO_JOB_STREAMS: OnceLock<Mutex<ScenarioStreamRegistry>> = OnceLock::new();
static TEXT_TURN_STREAMS: OnceLock<Mutex<ScenarioStreamRegistry>> = OnceLock::new();
static SCENARIO_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_SCENARIO_STREAMS: usize = 8;

fn conversation_streams() -> &'static Mutex<ConversationStreamRegistry> {
    CONVERSATION_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
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
    input: NativeAIConfigOverwriteInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .app_ai_config_overwrite(LocalAppAIConfigOverwriteRequest {
                capabilities: input.capabilities,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppModelConfigLocalSelectionsGet")]
pub async fn local_app_model_config_local_selections_get() -> NativeJsonOutcome {
    invoke_agent(|session| async move { session.model_config_local_selections_get().await }).await
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
pub async fn local_app_scenario_job_submit(input: NativeScenarioSpecInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .submit_scenario_job(LocalAppScenarioSubmitRequest { spec: input.spec })
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
    input: NativeAIConfigOverwriteInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .shared_agent_ai_config_overwrite(LocalAppSharedAgentAIConfigOverwriteRequest {
                capabilities: input.capabilities,
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
    invoke_agent(|session| async move {
        session
            .conversation_send_turn(LocalAppConversationSendRequest {
                agent_handle: input.agent_handle,
                conversation_anchor_id: input.conversation_anchor_id,
                request_id: input.request_id,
                text: input.text,
            })
            .await
            .map(|result| json!({ "turnId": result.turn_id }))
    })
    .await
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
                    "activeTurnId": snapshot.active_turn_id,
                    "messages": snapshot.messages.into_iter().map(|message| json!({
                        "turnId": message.turn_id,
                        "role": match message.role {
                            LocalAppConversationMessageRole::User => "user",
                            LocalAppConversationMessageRole::Assistant => "assistant",
                        },
                        "text": message.text,
                    })).collect::<Vec<_>>(),
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

fn project_conversation_event(event: LocalAppConversationEvent) -> JsonValue {
    let mut projection = match event.event {
        LocalAppConversationEventKind::TurnAccepted {
            turn_id,
            request_id,
        } => json!({
            "type": "turn-accepted", "turnId": turn_id, "requestId": request_id,
        }),
        LocalAppConversationEventKind::TurnStarted { turn_id } => json!({
            "type": "turn-started", "turnId": turn_id,
        }),
        LocalAppConversationEventKind::TextDelta { turn_id, text } => json!({
            "type": "text-delta", "turnId": turn_id, "text": text,
        }),
        LocalAppConversationEventKind::MessageCommitted {
            turn_id,
            message_id,
            text,
        } => json!({
            "type": "message-committed", "turnId": turn_id, "messageId": message_id, "text": text,
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
}
