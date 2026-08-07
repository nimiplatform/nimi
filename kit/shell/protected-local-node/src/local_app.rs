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

fn conversation_streams() -> &'static Mutex<ConversationStreamRegistry> {
    CONVERSATION_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
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

#[napi(js_name = "localAppTextGenerateCandidate")]
pub async fn local_app_text_generate_candidate(
    input: NativeTextCandidateInput,
) -> NativeJsonOutcome {
    if input.max_tokens > i32::MAX as u32 {
        return NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    }
    invoke_agent(|session| async move {
        session
            .generate_text_candidate(LocalAppTextCandidateRequest {
                messages: input
                    .messages
                    .into_iter()
                    .map(|message| LocalAppTextCandidateMessage {
                        role: message.role,
                        text: message.text,
                    })
                    .collect(),
                temperature: input.temperature as f32,
                top_p: input.top_p as f32,
                max_tokens: input.max_tokens as i32,
            })
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

#[napi(js_name = "localAppSharedAgentAIProfilePreview")]
pub async fn local_app_shared_agent_ai_profile_preview(
    input: NativeSharedAgentAIProfileInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .shared_agent_ai_profile_preview(LocalAppSharedAgentAIProfileRequest {
                profile_json: input.profile_json,
            })
            .await
    })
    .await
}

#[napi(js_name = "localAppSharedAgentAIProfileApply")]
pub async fn local_app_shared_agent_ai_profile_apply(
    input: NativeSharedAgentAIProfileInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .shared_agent_ai_profile_apply(LocalAppSharedAgentAIProfileRequest {
                profile_json: input.profile_json,
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

#[napi(js_name = "localAppArtifactPut")]
pub async fn local_app_artifact_put(input: NativeArtifactPutInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .artifact_put(LocalAppArtifactPutRequest {
                mime_type: input.mime_type,
                display_name: input.display_name,
                data: input.data.to_vec(),
            })
            .await
            .map(|result| json!({ "artifactId": result.artifact_id }))
    })
    .await
}

#[napi(js_name = "localAppArtifactReadBytes")]
pub async fn local_app_artifact_read_bytes(
    input: NativeArtifactReadInput,
) -> NativeArtifactReadOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeArtifactReadOutcome::error(error),
    };
    match session
        .artifact_read_bytes(LocalAppArtifactReadRequest {
            artifact_id: input.artifact_id,
        })
        .await
    {
        Ok(result) => NativeArtifactReadOutcome::success(NativeArtifactReadValue {
            bytes: result.bytes.into(),
            mime_type: result.mime_type,
        }),
        Err(error) => {
            clear_session_on_transport_failure(&session, &error).await;
            NativeArtifactReadOutcome::error(error)
        }
    }
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
        LocalAppConversationEventKind::TurnAccepted { turn_id, request_id } => json!({
            "type": "turn-accepted", "turnId": turn_id, "requestId": request_id,
        }),
        LocalAppConversationEventKind::TurnStarted { turn_id } => json!({
            "type": "turn-started", "turnId": turn_id,
        }),
        LocalAppConversationEventKind::TextDelta { turn_id, text } => json!({
            "type": "text-delta", "turnId": turn_id, "text": text,
        }),
        LocalAppConversationEventKind::MessageCommitted { turn_id, message_id, text } => json!({
            "type": "message-committed", "turnId": turn_id, "messageId": message_id, "text": text,
        }),
        LocalAppConversationEventKind::TurnCompleted { turn_id, terminal_reason } => json!({
            "type": "turn-completed", "turnId": turn_id, "terminalReason": terminal_reason,
        }),
        LocalAppConversationEventKind::TurnFailed { turn_id, reason_code, message } => json!({
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

fn decimal_revision(value: &str, allow_zero: bool) -> Result<u64, LocalAppOperationError> {
    if value.is_empty()
        || value.trim() != value
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    }
    let revision = value
        .parse::<u64>()
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false))?;
    if !allow_zero && revision == 0 {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPayload,
            false,
        ));
    }
    Ok(revision)
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

#[cfg(test)]
mod configure_revision_tests {
    use super::*;

    #[test]
    fn presentation_accepts_zero_but_other_mutations_require_positive_revisions() {
        assert_eq!(
            decimal_revision("0", true).expect("initial presentation"),
            0
        );
        assert!(decimal_revision("0", false).is_err());
        assert!(decimal_revision("01", true).is_err());
        assert_eq!(
            decimal_revision(&u64::MAX.to_string(), false).expect("u64 max"),
            u64::MAX
        );
    }
}

fn invalidates_local_app_session(reason: LocalAppReasonCode) -> bool {
    matches!(
        reason,
        LocalAppReasonCode::RuntimeServiceUnavailable
            | LocalAppReasonCode::RuntimeServiceUntrusted
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
}
