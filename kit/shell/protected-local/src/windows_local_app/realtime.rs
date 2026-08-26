use serde_json::{json, Map, Value as JsonValue};
use std::collections::BTreeMap;
use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::ai_realtime_event::Event as AiEvent;
use crate::generated::append_local_app_agent_realtime_input_request::Input as AgentInput;
use crate::generated::append_realtime_input_request::Input as AiInput;
use crate::generated::local_app_agent_realtime_event::Event as AgentEvent;
use crate::generated::{
    Ack, AiRealtimeAudioFormat, AiRealtimeAudioFrameInput, AiRealtimeOwnerContextInput,
    AiRealtimeTextInput, AppendLocalAppAgentRealtimeInputRequest, AppendRealtimeInputRequest,
    CloseLocalAppAgentRealtimeRequest, CloseRealtimeSessionRequest,
    GetLocalAppAgentRealtimeStatusRequest, InterruptLocalAppAgentRealtimeOutputRequest,
    InterruptRealtimeOutputRequest, OpenLocalAppAgentRealtimeRequest, OpenRealtimeSessionRequest,
    ReadRealtimeEventsRequest, RealtimeControlStatus, ReasonCode,
    SubmitRealtimeOwnerControlRequest, SubscribeLocalAppAgentRealtimeEventsRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentRealtimeAppendInputRequest, LocalAppAgentRealtimeOpenRequest,
    LocalAppAgentRealtimeOutputInterruptRequest, LocalAppAgentRealtimeSessionRequest,
    LocalAppAiRealtimeAppendInputRequest, LocalAppAiRealtimeOpenRequest,
    LocalAppAiRealtimeOutputInterruptRequest, LocalAppAiRealtimeOwnerControlRequest,
    LocalAppAiRealtimeSessionRequest, LocalAppOperationError, LocalAppRealtimeSubscriptionReceiver,
};

use super::{invalid_payload, untrusted};

const MAX_SELECTOR_BYTES: usize = 256;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_INSTRUCTION_BYTES: usize = 16 * 1024;
const MAX_AUDIO_FRAME_BYTES: usize = 64 * 1024;

pub(super) async fn ai_open(
    channel: Channel,
    request: LocalAppAiRealtimeOpenRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let input_audio = parse_audio_format(&request.input_audio)?;
    let turn_detection = parse_turn_detection(&request.turn_detection)?;
    require_text(&request.initial_instruction, MAX_INSTRUCTION_BYTES, true)?;
    let response = crate::grpc_limits::runtime_ai_realtime_client(channel)
        .open_realtime_session(OpenRealtimeSessionRequest {
            input_audio: Some(input_audio),
            audio_output_enabled: request.audio_output_enabled,
            turn_detection,
            initial_instruction: request.initial_instruction,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_open(
        None,
        response.realtime_session_id,
        response.channel_id,
        response.generation,
        response.negotiated_input_audio,
        response.negotiated_output_audio,
        response.control,
    )
}

pub(super) async fn ai_append_input(
    channel: Channel,
    request: LocalAppAiRealtimeAppendInputRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_session(&request.realtime_session_id, request.generation)?;
    let response = crate::grpc_limits::runtime_ai_realtime_client(channel)
        .append_realtime_input(AppendRealtimeInputRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            input: Some(parse_ai_input(request.input)?),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

pub(super) async fn ai_submit_owner_control(
    channel: Channel,
    request: LocalAppAiRealtimeOwnerControlRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_session(&request.realtime_session_id, request.generation)?;
    require_text(&request.request_id, MAX_SELECTOR_BYTES, false)?;
    let response = crate::grpc_limits::runtime_ai_realtime_client(channel)
        .submit_realtime_owner_control(SubmitRealtimeOwnerControlRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            request_id: request.request_id,
            control: parse_owner_control(&request.control)?,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

pub(super) async fn ai_subscribe(
    channel: Channel,
    request: LocalAppAiRealtimeSessionRequest,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    require_session(&request.realtime_session_id, request.generation)?;
    let mut stream = crate::grpc_limits::runtime_ai_realtime_client(channel)
        .read_realtime_events(ReadRealtimeEventsRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    if sender.send(project_ai_event(event)).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(local_app_error_from_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

pub(super) async fn ai_interrupt_output(
    channel: Channel,
    request: LocalAppAiRealtimeOutputInterruptRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_session(&request.realtime_session_id, request.generation)?;
    require_selector(&request.output_track_id)?;
    let response = crate::grpc_limits::runtime_ai_realtime_client(channel)
        .interrupt_realtime_output(InterruptRealtimeOutputRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            output_track_id: request.output_track_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

pub(super) async fn ai_close(
    channel: Channel,
    request: LocalAppAiRealtimeSessionRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_session(&request.realtime_session_id, request.generation)?;
    let response = crate::grpc_limits::runtime_ai_realtime_client(channel)
        .close_realtime_session(CloseRealtimeSessionRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

pub(super) async fn agent_open(
    channel: Channel,
    request: LocalAppAgentRealtimeOpenRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    if let Some(anchor) = request.conversation_anchor_id.as_deref() {
        require_selector(anchor)?;
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .open_local_app_agent_realtime(OpenLocalAppAgentRealtimeRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            input_audio: Some(parse_audio_format(&request.input_audio)?),
            turn_detection: parse_turn_detection(&request.turn_detection)?,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_open(
        Some(response.conversation_anchor_id),
        response.realtime_session_id,
        response.channel_id,
        response.generation,
        response.negotiated_input_audio,
        response.negotiated_output_audio,
        response.control,
    )
}

pub(super) async fn agent_append_input(
    channel: Channel,
    request: LocalAppAgentRealtimeAppendInputRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_session(&request.realtime_session_id, request.generation)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .append_local_app_agent_realtime_input(AppendLocalAppAgentRealtimeInputRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            agent_handle: request.agent_handle,
            input: Some(parse_agent_input(request.input)?),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

pub(super) async fn agent_subscribe(
    channel: Channel,
    request: LocalAppAgentRealtimeSessionRequest,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_session(&request.realtime_session_id, request.generation)?;
    let mut stream = crate::grpc_limits::runtime_agent_client(channel)
        .subscribe_local_app_agent_realtime_events(SubscribeLocalAppAgentRealtimeEventsRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    if sender.send(project_agent_event(event)).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(local_app_error_from_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

pub(super) async fn agent_status(
    channel: Channel,
    request: LocalAppAgentRealtimeSessionRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_session(&request.realtime_session_id, request.generation)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_realtime_status(GetLocalAppAgentRealtimeStatusRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({ "control": project_control(response.control)? }))
}

pub(super) async fn agent_interrupt_output(
    channel: Channel,
    request: LocalAppAgentRealtimeOutputInterruptRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_session(&request.realtime_session_id, request.generation)?;
    require_selector(&request.output_track_id)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .interrupt_local_app_agent_realtime_output(InterruptLocalAppAgentRealtimeOutputRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            output_track_id: request.output_track_id,
            interrupt_agent_turn: request.interrupt_agent_turn,
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

pub(super) async fn agent_close(
    channel: Channel,
    request: LocalAppAgentRealtimeSessionRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_session(&request.realtime_session_id, request.generation)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .close_local_app_agent_realtime(CloseLocalAppAgentRealtimeRequest {
            realtime_session_id: request.realtime_session_id,
            generation: request.generation,
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_operation(response.ack, response.control)
}

fn parse_audio_format(value: &JsonValue) -> Result<AiRealtimeAudioFormat, LocalAppOperationError> {
    let record = exact_object(
        value,
        &[
            "codec",
            "sampleRateHz",
            "channelCount",
            "frameDurationMs",
            "maximumFrameBytes",
        ],
    )?;
    if record.get("codec").and_then(JsonValue::as_str) != Some("pcm-s16le") {
        return Err(invalid_payload());
    }
    Ok(AiRealtimeAudioFormat {
        codec: 1,
        sample_rate_hz: json_u32(record, "sampleRateHz")?,
        channel_count: json_u32(record, "channelCount")?,
        frame_duration_ms: json_u32(record, "frameDurationMs")?,
        maximum_frame_bytes: json_u32(record, "maximumFrameBytes")?,
    })
}

fn parse_ai_input(value: JsonValue) -> Result<AiInput, LocalAppOperationError> {
    let record = value.as_object().ok_or_else(invalid_payload)?;
    match record.get("type").and_then(JsonValue::as_str) {
        Some("text") if exact_keys(record, &["type", "requestId", "text"]) => {
            Ok(AiInput::Text(AiRealtimeTextInput {
                request_id: json_text(record, "requestId", MAX_SELECTOR_BYTES, false)?,
                text: json_text(record, "text", MAX_TEXT_BYTES, false)?,
            }))
        }
        Some("audio-frame")
            if exact_keys(
                record,
                &[
                    "type",
                    "inputTrackId",
                    "utteranceId",
                    "frameSequence",
                    "frame",
                ],
            ) =>
        {
            Ok(AiInput::AudioFrame(AiRealtimeAudioFrameInput {
                input_track_id: json_text(record, "inputTrackId", MAX_SELECTOR_BYTES, false)?,
                utterance_id: json_text(record, "utteranceId", MAX_SELECTOR_BYTES, false)?,
                frame_sequence: json_u64_string(record, "frameSequence")?,
                frame: json_bytes(record, "frame")?,
            }))
        }
        Some("owner-context") if exact_keys(record, &["type", "requestId", "kind", "text"]) => {
            Ok(AiInput::OwnerContext(AiRealtimeOwnerContextInput {
                request_id: json_text(record, "requestId", MAX_SELECTOR_BYTES, false)?,
                kind: match record.get("kind").and_then(JsonValue::as_str) {
                    Some("instruction") => 1,
                    Some("context") => 2,
                    Some("sanitized-result") => 3,
                    _ => return Err(invalid_payload()),
                },
                text: json_text(record, "text", MAX_TEXT_BYTES, false)?,
            }))
        }
        _ => Err(invalid_payload()),
    }
}

fn parse_agent_input(value: JsonValue) -> Result<AgentInput, LocalAppOperationError> {
    let record = value.as_object().ok_or_else(invalid_payload)?;
    match record.get("type").and_then(JsonValue::as_str) {
        Some("text") if exact_keys(record, &["type", "requestId", "text"]) => Ok(AgentInput::Text(
            crate::generated::LocalAppAgentRealtimeTextInput {
                request_id: json_text(record, "requestId", MAX_SELECTOR_BYTES, false)?,
                text: json_text(record, "text", MAX_TEXT_BYTES, false)?,
            },
        )),
        Some("audio-frame")
            if exact_keys(
                record,
                &[
                    "type",
                    "inputTrackId",
                    "utteranceId",
                    "frameSequence",
                    "frame",
                ],
            ) =>
        {
            Ok(AgentInput::AudioFrame(
                crate::generated::LocalAppAgentRealtimeAudioFrameInput {
                    input_track_id: json_text(record, "inputTrackId", MAX_SELECTOR_BYTES, false)?,
                    utterance_id: json_text(record, "utteranceId", MAX_SELECTOR_BYTES, false)?,
                    frame_sequence: json_u64_string(record, "frameSequence")?,
                    frame: json_bytes(record, "frame")?,
                },
            ))
        }
        Some("capture-stopped") if exact_keys(record, &["type", "inputTrackId", "utteranceId"]) => {
            Ok(AgentInput::CaptureStopped(
                crate::generated::LocalAppAgentRealtimeCaptureStopped {
                    input_track_id: json_text(record, "inputTrackId", MAX_SELECTOR_BYTES, false)?,
                    utterance_id: json_text(record, "utteranceId", MAX_SELECTOR_BYTES, false)?,
                },
            ))
        }
        _ => Err(invalid_payload()),
    }
}

fn project_ai_event(
    event: crate::generated::AiRealtimeEvent,
) -> Result<JsonValue, LocalAppOperationError> {
    let control = project_control(event.control)
        .map_err(|error| realtime_projection_error(error, "ai_realtime_event_control"))?;
    let event = match event.event.ok_or_else(untrusted)? {
        AiEvent::Opened(value) => json!({
            "type":"opened",
            "inputAudio":project_audio_format(value.input_audio).map_err(|error| realtime_projection_error(error, "ai_realtime_opened_input_audio"))?,
            "outputAudio":project_optional_audio_format(value.output_audio).map_err(|error| realtime_projection_error(error, "ai_realtime_opened_output_audio"))?,
            "turnDetection":turn_detection_name(value.turn_detection).map_err(|error| realtime_projection_error(error, "ai_realtime_opened_turn_detection"))?,
        }),
        AiEvent::InputAccepted(value) => {
            json!({"type":"input-accepted","inputTrackId":value.input_track_id,"utteranceId":value.utterance_id,"frameSequence":value.frame_sequence.to_string(),"requestId":value.request_id})
        }
        AiEvent::SpeechStatus(value) => {
            json!({"type":"speech-status","inputTrackId":value.input_track_id,"utteranceId":value.utterance_id,"state":speech_state_name(value.state)?})
        }
        AiEvent::Transcript(value) => {
            json!({"type":"transcript","inputTrackId":value.input_track_id,"utteranceId":value.utterance_id,"text":value.text,"final":value.r#final})
        }
        AiEvent::TextOutput(value) => {
            json!({"type":"text-output","requestId":value.request_id,"outputTrackId":value.output_track_id,"text":value.text,"final":value.r#final})
        }
        AiEvent::AudioFrame(value) => {
            json!({"type":"audio-frame","requestId":value.request_id,"outputTrackId":value.output_track_id,"frameSequence":value.frame_sequence.to_string(),"frame":value.frame,"format":project_audio_format(value.format)?})
        }
        AiEvent::OutputTrack(value) => {
            json!({"type":"output-track","requestId":value.request_id,"outputTrackId":value.output_track_id,"lifecycle":output_lifecycle_name(value.lifecycle)?,"reasonCode":reason_name(value.reason_code)?})
        }
        AiEvent::RequestTerminal(value) => {
            json!({"type":"request-terminal","requestId":value.request_id,"finishReason":finish_reason_name(value.finish_reason)?,"usage":project_usage(value.usage),"reasonCode":reason_name(value.reason_code)?})
        }
        AiEvent::SessionTerminal(value) => {
            json!({"type":"session-terminal","reasonCode":reason_name(value.reason_code)?})
        }
        AiEvent::Failure(value) => {
            json!({"type":"failure","requestId":value.request_id,"outputTrackId":value.output_track_id,"reasonCode":reason_name(value.reason_code)?})
        }
    };
    Ok(json!({"control":control,"event":event}))
}

fn project_agent_event(
    event: crate::generated::LocalAppAgentRealtimeEvent,
) -> Result<JsonValue, LocalAppOperationError> {
    let control = project_control(event.control)
        .map_err(|error| realtime_projection_error(error, "agent_realtime_event_control"))?;
    let event = match event.event.ok_or_else(untrusted)? {
        AgentEvent::InputAccepted(value) => {
            json!({"type":"input-accepted","inputTrackId":value.input_track_id,"utteranceId":value.utterance_id,"frameSequence":value.frame_sequence.to_string(),"requestId":value.request_id})
        }
        AgentEvent::SpeechStatus(value) => {
            json!({"type":"speech-status","inputTrackId":value.input_track_id,"utteranceId":value.utterance_id,"state":speech_state_name(value.state)?})
        }
        AgentEvent::Transcript(value) => {
            json!({"type":"transcript","inputTrackId":value.input_track_id,"utteranceId":value.utterance_id,"text":value.text,"final":value.r#final})
        }
        AgentEvent::TextOutput(value) => {
            json!({"type":"text-output","requestId":value.request_id,"outputTrackId":value.output_track_id,"text":value.text,"final":value.r#final})
        }
        AgentEvent::AudioFrame(value) => {
            json!({"type":"audio-frame","requestId":value.request_id,"outputTrackId":value.output_track_id,"frameSequence":value.frame_sequence.to_string(),"frame":value.frame,"format":project_audio_format(value.format)?})
        }
        AgentEvent::OutputTrack(value) => {
            json!({"type":"output-track","requestId":value.request_id,"outputTrackId":value.output_track_id,"lifecycle":output_lifecycle_name(value.lifecycle)?,"reasonCode":reason_name(value.reason_code)?})
        }
        AgentEvent::Terminal(value) => {
            json!({"type":"terminal","reasonCode":reason_name(value.reason_code)?})
        }
    };
    Ok(json!({"control":control,"event":event}))
}

fn project_open(
    conversation_anchor_id: Option<String>,
    realtime_session_id: String,
    channel_id: String,
    generation: u64,
    input_audio: Option<AiRealtimeAudioFormat>,
    output_audio: Option<AiRealtimeAudioFormat>,
    control: Option<RealtimeControlStatus>,
) -> Result<JsonValue, LocalAppOperationError> {
    require_selector(&realtime_session_id)?;
    require_selector(&channel_id)?;
    if generation == 0 {
        return Err(untrusted());
    }
    if let Some(anchor) = conversation_anchor_id.as_deref() {
        require_selector(anchor)?;
    }
    let mut result = Map::new();
    if let Some(anchor) = conversation_anchor_id {
        result.insert("conversationAnchorId".into(), JsonValue::String(anchor));
    }
    result.insert(
        "realtimeSessionId".into(),
        JsonValue::String(realtime_session_id),
    );
    result.insert("channelId".into(), JsonValue::String(channel_id));
    result.insert(
        "generation".into(),
        JsonValue::String(generation.to_string()),
    );
    result.insert(
        "negotiatedInputAudio".into(),
        project_audio_format(input_audio)?,
    );
    result.insert(
        "negotiatedOutputAudio".into(),
        project_optional_audio_format(output_audio)?,
    );
    result.insert("control".into(), project_control(control)?);
    Ok(JsonValue::Object(result))
}

fn project_operation(
    ack: Option<Ack>,
    control: Option<RealtimeControlStatus>,
) -> Result<JsonValue, LocalAppOperationError> {
    let ack = ack.ok_or_else(untrusted)?;
    Ok(json!({
        "ack": {"ok":ack.ok,"reasonCode":reason_name(ack.reason_code)?,"actionHint":ack.action_hint},
        "control": project_control(control)?,
    }))
}

pub(super) fn project_control(
    value: Option<RealtimeControlStatus>,
) -> Result<JsonValue, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    Ok(json!({
        "realtimeSessionId":value.realtime_session_id,
        "channelId":value.channel_id,
        "subscriptionId":value.subscription_id,
        "adapterKind":match value.adapter_kind {1=>"realm",2=>"local-agent",3=>"ai",_=>return Err(untrusted())},
        "lifecycle":match value.lifecycle {1=>"opening",2=>"ready",3=>"degraded",4=>"reconnecting",5=>"closed",6=>"failed",_=>return Err(untrusted())},
        "generation":value.generation.to_string(),
        "sequence":value.sequence.to_string(),
        "correlationId":value.correlation_id,
        "backpressure":match value.backpressure {1=>"normal",2=>"pressured",3=>"blocked",_=>return Err(untrusted())},
        "bufferedItems":value.buffered_items,
        "bufferCapacity":value.buffer_capacity,
        "terminalReason":match value.terminal_reason {0=>"",1=>"cancelled",2=>"unauthenticated",3=>"permission-denied",4=>"not-found",5=>"unavailable",6=>"protocol-failure",7=>"resource-exhausted",8=>"slow-consumer",9=>"runtime-shutdown",10=>"stale-generation",11=>"owner-failed",_=>return Err(untrusted())},
        "actionHint":value.action_hint,
        "occurredAt":value.occurred_at.map(|time|json!({"seconds":time.seconds.to_string(),"nanos":time.nanos})),
    }))
}

fn project_audio_format(
    value: Option<AiRealtimeAudioFormat>,
) -> Result<JsonValue, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    if value.codec != 1
        || value.sample_rate_hz == 0
        || value.channel_count == 0
        || value.maximum_frame_bytes == 0
    {
        return Err(untrusted());
    }
    Ok(
        json!({"codec":"pcm-s16le","sampleRateHz":value.sample_rate_hz,"channelCount":value.channel_count,"frameDurationMs":value.frame_duration_ms,"maximumFrameBytes":value.maximum_frame_bytes}),
    )
}

fn project_optional_audio_format(
    value: Option<AiRealtimeAudioFormat>,
) -> Result<JsonValue, LocalAppOperationError> {
    match value {
        Some(format) => project_audio_format(Some(format)),
        None => Ok(JsonValue::Null),
    }
}

fn project_usage(value: Option<crate::generated::UsageStats>) -> JsonValue {
    value.map_or(JsonValue::Null, |usage| json!({
        "inputTokens":usage.input_tokens.to_string(),"outputTokens":usage.output_tokens.to_string(),"computeMs":usage.compute_ms.to_string(),
        "cachedInputTokens":usage.cached_input_tokens.to_string(),"reasoningOutputTokens":usage.reasoning_output_tokens.to_string(),
    }))
}

fn reason_name(value: i32) -> Result<String, LocalAppOperationError> {
    ReasonCode::try_from(value)
        .map(|reason| reason.as_str_name().to_string())
        .map_err(|_| untrusted())
}

fn turn_detection_name(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match value {
        1 => Ok("server-vad"),
        2 => Ok("manual"),
        _ => Err(untrusted()),
    }
}
fn speech_state_name(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match value {
        1 => Ok("started"),
        2 => Ok("stopped"),
        _ => Err(untrusted()),
    }
}
fn output_lifecycle_name(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match value {
        1 => Ok("active"),
        2 => Ok("interrupted"),
        3 => Ok("completed"),
        4 => Ok("failed"),
        _ => Err(untrusted()),
    }
}
fn finish_reason_name(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match value {
        0 => Ok("unspecified"),
        1 => Ok("stop"),
        2 => Ok("length"),
        3 => Ok("tool-call"),
        4 => Ok("content-filter"),
        5 => Ok("error"),
        _ => Err(untrusted()),
    }
}
fn parse_turn_detection(value: &str) -> Result<i32, LocalAppOperationError> {
    match value {
        "server-vad" => Ok(1),
        "manual" => Ok(2),
        _ => Err(invalid_payload()),
    }
}
fn parse_owner_control(value: &str) -> Result<i32, LocalAppOperationError> {
    match value {
        "commit-input" => Ok(1),
        "start-response" => Ok(2),
        "continue-response" => Ok(3),
        "pause-response" => Ok(4),
        "cancel-response" => Ok(5),
        _ => Err(invalid_payload()),
    }
}

fn require_session(session_id: &str, generation: u64) -> Result<(), LocalAppOperationError> {
    require_selector(session_id)?;
    if generation == 0 {
        return Err(invalid_payload());
    }
    Ok(())
}
fn require_agent_handle(value: &str) -> Result<(), LocalAppOperationError> {
    if !value.starts_with("agent_ref_") {
        return Err(invalid_payload());
    }
    require_selector(value)
}
fn require_selector(value: &str) -> Result<(), LocalAppOperationError> {
    require_text(value, MAX_SELECTOR_BYTES, false)
}
fn require_text(
    value: &str,
    maximum: usize,
    allow_empty: bool,
) -> Result<(), LocalAppOperationError> {
    if (!allow_empty && value.is_empty())
        || value.len() > maximum
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    Ok(())
}
fn exact_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a Map<String, JsonValue>, LocalAppOperationError> {
    let record = value.as_object().ok_or_else(invalid_payload)?;
    if !exact_keys(record, keys) {
        return Err(invalid_payload());
    }
    Ok(record)
}
fn exact_keys(record: &Map<String, JsonValue>, keys: &[&str]) -> bool {
    record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
}
fn json_text(
    record: &Map<String, JsonValue>,
    key: &str,
    maximum: usize,
    allow_empty: bool,
) -> Result<String, LocalAppOperationError> {
    let value = record
        .get(key)
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    require_text(value, maximum, allow_empty)?;
    Ok(value.to_string())
}
fn json_u32(record: &Map<String, JsonValue>, key: &str) -> Result<u32, LocalAppOperationError> {
    record
        .get(key)
        .and_then(JsonValue::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(invalid_payload)
}
fn json_u64_string(
    record: &Map<String, JsonValue>,
    key: &str,
) -> Result<u64, LocalAppOperationError> {
    record
        .get(key)
        .and_then(JsonValue::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(invalid_payload)
}
fn json_bytes(
    record: &Map<String, JsonValue>,
    key: &str,
) -> Result<Vec<u8>, LocalAppOperationError> {
    let values = record
        .get(key)
        .and_then(JsonValue::as_array)
        .ok_or_else(invalid_payload)?;
    if values.is_empty() || values.len() > MAX_AUDIO_FRAME_BYTES {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            value
                .as_u64()
                .and_then(|byte| u8::try_from(byte).ok())
                .ok_or_else(invalid_payload)
        })
        .collect()
}

fn realtime_projection_error(
    error: LocalAppOperationError,
    stage: &'static str,
) -> LocalAppOperationError {
    let mut metadata = BTreeMap::new();
    metadata.insert("diagnostic_stage".to_string(), stage.to_string());
    error.with_reason_metadata(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_the_exact_neutral_opened_event() {
        let format = AiRealtimeAudioFormat {
            codec: 1,
            sample_rate_hz: 16_000,
            channel_count: 1,
            frame_duration_ms: 20,
            maximum_frame_bytes: 640,
        };
        let projected = project_ai_event(crate::generated::AiRealtimeEvent {
            control: Some(RealtimeControlStatus {
                realtime_session_id: "realtime-1".into(),
                channel_id: "channel-1".into(),
                adapter_kind: 3,
                lifecycle: 2,
                generation: 1,
                sequence: 1,
                correlation_id: "correlation-1".into(),
                backpressure: 1,
                buffer_capacity: 64,
                occurred_at: Some(prost_types::Timestamp {
                    seconds: 1,
                    nanos: 0,
                }),
                ..Default::default()
            }),
            event: Some(AiEvent::Opened(crate::generated::AiRealtimeSessionOpened {
                input_audio: Some(format.clone()),
                output_audio: Some(AiRealtimeAudioFormat {
                    sample_rate_hz: 24_000,
                    maximum_frame_bytes: 960,
                    ..format
                }),
                turn_detection: 2,
            })),
        })
        .expect("project opened event");
        assert_eq!(projected["event"]["type"], "opened");
        assert_eq!(projected["control"]["adapterKind"], "ai");
    }

    #[test]
    fn parses_agent_capture_stop_as_one_typed_input_variant() {
        let input = parse_agent_input(json!({
            "type": "capture-stopped",
            "inputTrackId": "input-track-1",
            "utteranceId": "utterance-1",
        }))
        .expect("parse capture stop");
        match input {
            AgentInput::CaptureStopped(value) => {
                assert_eq!(value.input_track_id, "input-track-1");
                assert_eq!(value.utterance_id, "utterance-1");
            }
            _ => panic!("capture stop mapped to the wrong Agent input variant"),
        }
    }
}
