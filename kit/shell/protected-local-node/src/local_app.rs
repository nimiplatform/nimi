use super::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;

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

#[napi(js_name = "localAppPermissionPosture")]
pub async fn local_app_permission_posture(
    input: NativePermissionPostureInput,
) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .permission_posture(LocalAppPermissionPostureRequest {
            operation_id: input.operation_id,
            resource_ref: input.resource_ref,
        })
        .await
    {
        Ok(posture) => NativeJsonOutcome::success(project_permission_posture(posture)),
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
            operation_id: input.operation_id,
            resource_ref: input.resource_ref,
            purpose: input.purpose,
        })
        .await
    {
        Ok(posture) => NativeJsonOutcome::success(project_permission_posture(posture)),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppArtifactsReadRuntimeBytes")]
pub async fn local_app_artifacts_read_runtime_bytes(
    input: NativeArtifactReadInput,
) -> NativeArtifactOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeArtifactOutcome::error(error),
    };
    match session
        .artifacts_read_runtime_bytes(LocalAppArtifactReadRequest {
            artifact_id: input.artifact_id,
        })
        .await
    {
        Ok(artifact) => NativeArtifactOutcome::success(artifact),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeArtifactOutcome::error(error)
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

#[napi(js_name = "localAppAgentInventory")]
pub async fn local_app_agent_inventory() -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_inventory(LocalAppAgentInventoryRequest)
            .await
            .map(|projection| projection.value)
    })
    .await
}

#[napi(js_name = "localAppAgentOpenConversation")]
pub async fn local_app_agent_open_conversation(
    input: NativeAgentOpenConversationInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_open_conversation(LocalAppAgentOpenConversationRequest {
                agent_id: input.agent_id,
                requested_anchor_disposition: input.requested_anchor_disposition,
            })
            .await
            .map(|projection| projection.value)
    })
    .await
}

#[napi(js_name = "localAppAgentSendTurn")]
pub async fn local_app_agent_send_turn(input: NativeAgentSendTurnInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_send_turn(LocalAppAgentSendTurnRequest {
                agent_id: input.agent_id,
                conversation_anchor_id: input.conversation_anchor_id,
                client_turn_id: input.client_turn_id,
                user_text: input.user_text,
            })
            .await
            .map(|projection| projection.value)
    })
    .await
}

#[napi(js_name = "localAppAgentSubscribeTurn")]
pub async fn local_app_agent_subscribe_turn(
    input: NativeAgentSubscribeTurnInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_subscribe_turn(LocalAppAgentSubscribeTurnRequest {
                agent_id: input.agent_id,
                conversation_anchor_id: input.conversation_anchor_id,
                cursor: input.cursor,
            })
            .await
            .map(|projection| projection.value)
    })
    .await
}

#[napi(js_name = "localAppAgentGetConversationSnapshot")]
pub async fn local_app_agent_get_conversation_snapshot(
    input: NativeAgentConversationSnapshotInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_get_conversation_snapshot(LocalAppAgentConversationSnapshotRequest {
                agent_id: input.agent_id,
                conversation_anchor_id: input.conversation_anchor_id,
            })
            .await
            .map(|projection| projection.value)
    })
    .await
}

#[napi(js_name = "localAppAgentTranscribeVoice")]
pub async fn local_app_agent_transcribe_voice(
    input: NativeAgentTranscribeVoiceInput,
) -> NativeJsonOutcome {
    let audio = match BASE64_STANDARD.decode(input.audio_base64.as_bytes()) {
        Ok(audio) => audio,
        Err(_) => {
            return NativeJsonOutcome::error(LocalAppOperationError::new(
                LocalAppReasonCode::InvalidPayload,
                false,
            ))
        }
    };
    invoke_agent(|session| async move {
        session
            .agent_transcribe_voice(LocalAppAgentTranscribeVoiceRequest {
                agent_id: input.agent_id,
                client_request_id: input.client_request_id,
                audio,
                mime_type: input.mime_type,
            })
            .await
            .map(|result| {
                json!({
                    "clientRequestId": result.client_request_id,
                    "text": result.text,
                })
            })
    })
    .await
}

#[napi(js_name = "localAppAgentSubscribeVoiceStream")]
pub async fn local_app_agent_subscribe_voice_stream(
    input: NativeAgentSubscribeVoiceStreamInput,
) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .agent_subscribe_voice_stream(LocalAppAgentSubscribeVoiceStreamRequest {
                agent_id: input.agent_id,
                conversation_anchor_id: input.conversation_anchor_id,
                turn_id: input.turn_id,
                voice_stream_id: input.voice_stream_id,
                cursor: input.cursor,
            })
            .await
            .map(project_voice_stream_page)
    })
    .await
}

fn project_voice_stream_page(page: LocalAppAgentVoiceStreamPage) -> JsonValue {
    let events = page
        .events
        .into_iter()
        .map(|event| {
            json!({
                "voiceStreamId": event.voice_stream_id,
                "conversationAnchorId": event.conversation_anchor_id,
                "turnId": event.turn_id,
                "streamId": event.stream_id,
                "messageId": event.message_id,
                "chunkSequence": event.chunk_sequence.to_string(),
                "chunkBase64": BASE64_STANDARD.encode(event.chunk),
                "mimeType": event.mime_type,
                "voiceOutputMode": event.voice_output_mode,
                "playbackTarget": event.playback_target,
                "terminal": event.terminal,
                "voicePlaybackState": event.voice_playback_state,
                "terminalReason": event.terminal_reason,
                "replayTruncated": event.replay_truncated,
            })
        })
        .collect::<Vec<_>>();
    json!({"cursor": page.cursor, "events": events})
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
    let opened = WindowsLocalAppCarrier.open_local_app_session().await?;
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
