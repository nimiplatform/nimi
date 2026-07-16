use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use tonic::transport::Channel;
use tonic::Streaming;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::{
    AgentVoiceStreamEvent, SubscribeAgentVoiceStreamRequest, TranscribeLocalAppAgentAudioRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentSubscribeVoiceStreamRequest, LocalAppAgentTranscribeVoiceRequest,
    LocalAppAgentVoiceStreamEvent, LocalAppAgentVoiceStreamPage, LocalAppAgentVoiceTranscription,
    LocalAppOperationError, LocalAppReasonCode,
};

use super::{invalid_payload, require_text, untrusted};

const MAX_TRANSCRIPTION_AUDIO_BYTES: usize = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES: usize = 64 * 1024;
const MAX_VOICE_CHUNK_BYTES: usize = 32 * 1024 * 1024;
const ADMITTED_AUDIO_MIME_TYPES: [&str; 6] = [
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/flac",
];

pub(super) struct VoiceStreamState {
    stream: Streaming<AgentVoiceStreamEvent>,
    last_cursor: u64,
    terminal: bool,
}

pub(super) type VoiceStreams = Mutex<HashMap<String, Arc<Mutex<VoiceStreamState>>>>;

pub(super) async fn transcribe_local_app_agent_voice(
    channel: Channel,
    request: LocalAppAgentTranscribeVoiceRequest,
) -> Result<LocalAppAgentVoiceTranscription, LocalAppOperationError> {
    require_text(&request.agent_id)?;
    require_text(&request.client_request_id)?;
    if request.audio.is_empty() || request.audio.len() > MAX_TRANSCRIPTION_AUDIO_BYTES {
        return Err(invalid_payload());
    }
    let mime_type = normalize_audio_mime(&request.mime_type)?;
    let expected_request_id = request.client_request_id.clone();
    let response = RuntimeAgentServiceClient::new(channel)
        .transcribe_local_app_agent_audio(TranscribeLocalAppAgentAudioRequest {
            agent_id: request.agent_id,
            client_request_id: request.client_request_id,
            audio: request.audio,
            mime_type,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.client_request_id != expected_request_id
        || response.transcript.as_bytes().len() > MAX_TRANSCRIPT_BYTES
    {
        return Err(untrusted());
    }
    Ok(LocalAppAgentVoiceTranscription {
        client_request_id: response.client_request_id,
        text: response.transcript,
    })
}

pub(super) async fn subscribe_local_app_agent_voice_stream(
    channel: Channel,
    voice_streams: &VoiceStreams,
    request: LocalAppAgentSubscribeVoiceStreamRequest,
) -> Result<LocalAppAgentVoiceStreamPage, LocalAppOperationError> {
    for value in [
        request.agent_id.as_str(),
        request.conversation_anchor_id.as_str(),
        request.turn_id.as_str(),
        request.voice_stream_id.as_str(),
    ] {
        require_text(value)?;
    }
    let expected_cursor = parse_cursor(&request.cursor)?;
    let key = format!(
        "{}\u{0}{}\u{0}{}\u{0}{}",
        request.agent_id, request.conversation_anchor_id, request.turn_id, request.voice_stream_id,
    );
    let state = {
        let mut streams = voice_streams.lock().await;
        if let Some(state) = streams.get(&key) {
            state.clone()
        } else {
            if expected_cursor.is_some() {
                return Err(invalid_payload());
            }
            let stream = RuntimeAgentServiceClient::new(channel)
                .subscribe_agent_voice_stream(SubscribeAgentVoiceStreamRequest {
                    context: None,
                    voice_stream_id: request.voice_stream_id.clone(),
                    conversation_anchor_id: request.conversation_anchor_id.clone(),
                    turn_id: request.turn_id.clone(),
                    agent_id: request.agent_id.clone(),
                })
                .await
                .map_err(local_app_error_from_status)?
                .into_inner();
            let state = Arc::new(Mutex::new(VoiceStreamState {
                stream,
                last_cursor: 0,
                terminal: false,
            }));
            streams.insert(key, state.clone());
            state
        }
    };
    let mut state = state.lock().await;
    if state.terminal {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::NotFound,
            false,
        ));
    }
    if expected_cursor.is_some_and(|cursor| cursor != state.last_cursor) {
        return Err(invalid_payload());
    }
    let event = state
        .stream
        .message()
        .await
        .map_err(local_app_error_from_status)?
        .ok_or_else(|| {
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
        })?;
    let projected = project_voice_event(event, &request)?;
    state.last_cursor = state.last_cursor.checked_add(1).ok_or_else(untrusted)?;
    state.terminal = projected.terminal;
    Ok(LocalAppAgentVoiceStreamPage {
        cursor: state.last_cursor.to_string(),
        events: vec![projected],
    })
}

fn project_voice_event(
    event: AgentVoiceStreamEvent,
    request: &LocalAppAgentSubscribeVoiceStreamRequest,
) -> Result<LocalAppAgentVoiceStreamEvent, LocalAppOperationError> {
    if event.voice_stream_id != request.voice_stream_id
        || event.conversation_anchor_id != request.conversation_anchor_id
        || event.turn_id != request.turn_id
    {
        return Err(untrusted());
    }
    require_text(&event.stream_id)?;
    require_text(&event.message_id)?;
    if event.replay_truncated {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    if event.chunk.len() > MAX_VOICE_CHUNK_BYTES
        || !matches!(event.voice_output_mode, 1..=4)
        || !matches!(event.voice_playback_state, 1..=5)
    {
        return Err(untrusted());
    }
    if event.terminal {
        if !event.chunk.is_empty() {
            return Err(untrusted());
        }
    } else if event.chunk.is_empty()
        || event.chunk_sequence == 0
        || normalize_audio_mime(&event.mime_type).is_err()
    {
        return Err(untrusted());
    }
    Ok(LocalAppAgentVoiceStreamEvent {
        voice_stream_id: event.voice_stream_id,
        conversation_anchor_id: event.conversation_anchor_id,
        turn_id: event.turn_id,
        stream_id: event.stream_id,
        message_id: event.message_id,
        chunk_sequence: event.chunk_sequence,
        chunk: event.chunk,
        mime_type: event.mime_type,
        voice_output_mode: event.voice_output_mode,
        playback_target: event.playback_target,
        terminal: event.terminal,
        voice_playback_state: event.voice_playback_state,
        terminal_reason: event.terminal_reason,
        replay_truncated: event.replay_truncated,
    })
}

fn parse_cursor(value: &str) -> Result<Option<u64>, LocalAppOperationError> {
    if value.is_empty() {
        return Ok(None);
    }
    if value.starts_with('+') || (value.starts_with('0') && value.len() > 1) {
        return Err(invalid_payload());
    }
    value
        .parse::<u64>()
        .map(Some)
        .map_err(|_| invalid_payload())
}

fn normalize_audio_mime(value: &str) -> Result<String, LocalAppOperationError> {
    if value.trim() != value || value.is_empty() {
        return Err(invalid_payload());
    }
    let base = value
        .split_once(';')
        .map(|(mime, _)| mime)
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase();
    if !ADMITTED_AUDIO_MIME_TYPES.contains(&base.as_str()) {
        return Err(invalid_payload());
    }
    Ok(base)
}
