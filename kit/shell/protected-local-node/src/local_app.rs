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
            clear_session_on_transport_failure(&session, error).await;
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
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppPermissionStatus")]
pub async fn local_app_permission_status(input: NativePermissionStatusInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .permission_status(LocalAppPermissionStatusRequest {
            permission_id: input.permission_id,
        })
        .await
    {
        Ok(status) => NativeJsonOutcome::success(project_permission_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppPermissionRequest")]
pub async fn local_app_permission_request(
    input: NativePermissionRequestInput,
) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .permission_request(LocalAppPermissionRequest {
            permission_id: input.permission_id,
            reason: input.reason,
        })
        .await
    {
        Ok(status) => NativeJsonOutcome::success(project_permission_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
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
                disposition: input.disposition,
            })
            .await
            .map(|result| {
                json!({
                    "conversationAnchorId": result.conversation_anchor_id,
                    "activeTurnId": result.active_turn_id,
                    "activeStreamId": result.active_stream_id,
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
            .map(|result| json!({ "messageId": result.message_id }))
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
            clear_session_on_transport_failure(&session, error).await;
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
    json!({
        "eventType": event.event_type,
        "sequence": event.sequence.to_string(),
        "messageId": event.message_id,
        "messageType": event.message_type,
        "payload": event.payload,
        "reasonCode": event.reason_code.as_str(),
        "traceId": event.trace_id,
        "timestampUnixMs": event.timestamp_unix_ms,
    })
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
            clear_session_on_transport_failure(&session, error).await;
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

async fn clear_session_on_transport_failure(
    session: &Arc<dyn NimiLocalAppSession>,
    error: LocalAppOperationError,
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
    let mut current = LOCAL_APP_SESSION.lock().await;
    if current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
    {
        *current = None;
    }
}
