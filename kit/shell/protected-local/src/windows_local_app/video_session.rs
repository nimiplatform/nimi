use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tonic::transport::Channel;
use crate::generated::{AiVideoPixelFormat, AiVideoSessionFormat, AiVideoFrameDisposition, OpenVideoSessionRequest, SubmitVideoSessionFrameRequest, ReadVideoSessionResultRequest, CloseVideoSessionRequest};
use crate::generated::ai_video_session_result::Result as VideoResult;
use crate::{LocalAppVideoSessionOpenRequest, LocalAppVideoSessionFrameRequest, LocalAppVideoSessionScopeRequest, LocalAppOperationError};
use crate::grpc_status::local_app_error_from_status;
use super::{invalid_payload, untrusted};

const FRAME_BYTES: usize = 1280 * 720 * 3;

fn identifier(value: &str) -> bool { !value.is_empty() && value.len() <= 128 && value.trim() == value && !value.chars().any(char::is_control) }
fn scope(id: &str, generation: u64) -> Result<(), LocalAppOperationError> { if !identifier(id) || generation == 0 { Err(invalid_payload()) } else { Ok(()) } }

// @nimi-authority: rule.nimi.sdks.feature-clients.face-swap-video-session
pub(super) async fn open(channel: Channel, input: LocalAppVideoSessionOpenRequest) -> Result<Value, LocalAppOperationError> {
    if !identifier(&input.reference_image_artifact_id) || input.width != 1280 || input.height != 720 || input.pixel_format != "rgb8" { return Err(invalid_payload()); }
    let response = crate::grpc_limits::runtime_ai_video_session_client(channel).open_video_session(OpenVideoSessionRequest {
        reference_image_artifact_id: input.reference_image_artifact_id,
        format: Some(AiVideoSessionFormat { width: input.width, height: input.height, pixel_format: AiVideoPixelFormat::Rgb8 as i32 }),
    }).await.map_err(local_app_error_from_status)?.into_inner();
    let format = response.format.ok_or_else(untrusted)?;
    if !identifier(&response.video_session_id) || response.generation == 0 || format.width != 1280 || format.height != 720 || format.pixel_format != AiVideoPixelFormat::Rgb8 as i32 || response.maximum_in_flight_submissions != 2 { return Err(untrusted()); }
    Ok(json!({"videoSessionId": response.video_session_id, "generation": response.generation.to_string(), "format": {"width":format.width,"height":format.height,"pixelFormat":"rgb8"}, "maximumInFlightSubmissions":2}))
}

pub(super) async fn submit(channel: Channel, input: LocalAppVideoSessionFrameRequest) -> Result<Value, LocalAppOperationError> {
    scope(&input.video_session_id, input.generation)?;
    if input.sequence == 0 || input.frame_base64.len() != 4 * FRAME_BYTES.div_ceil(3) { return Err(invalid_payload()); }
    let frame = STANDARD.decode(&input.frame_base64).map_err(|_| invalid_payload())?;
    if frame.len() != FRAME_BYTES { return Err(invalid_payload()); }
    let response = crate::grpc_limits::runtime_ai_video_session_client(channel).submit_video_session_frame(SubmitVideoSessionFrameRequest {
        video_session_id: input.video_session_id, generation: input.generation, sequence: input.sequence, timestamp_us: input.timestamp_us, frame,
    }).await.map_err(local_app_error_from_status)?.into_inner();
    if !response.accepted || response.sequence != input.sequence { return Err(untrusted()); }
    Ok(json!({"accepted":true,"sequence":response.sequence.to_string()}))
}

pub(super) async fn read(channel: Channel, input: LocalAppVideoSessionScopeRequest) -> Result<Value, LocalAppOperationError> {
    scope(&input.video_session_id, input.generation)?;
    let response = crate::grpc_limits::runtime_ai_video_session_client(channel).read_video_session_result(ReadVideoSessionResultRequest { video_session_id: input.video_session_id.clone(), generation: input.generation }).await.map_err(local_app_error_from_status)?.into_inner();
    let Some(result) = response.result else { return Ok(json!({"result":null})); };
    if result.video_session_id != input.video_session_id || result.generation != input.generation { return Err(untrusted()); }
    let mut projection = json!({"videoSessionId":result.video_session_id,"generation":result.generation.to_string()});
    let fields = projection.as_object_mut().ok_or_else(untrusted)?;
    match result.result.ok_or_else(untrusted)? {
        VideoResult::Transformed(frame) => {
            if frame.sequence == 0 || frame.frame.len() != FRAME_BYTES { return Err(untrusted()); }
            fields.insert("type".into(), json!("transformed")); fields.insert("sequence".into(),json!(frame.sequence.to_string())); fields.insert("timestampUs".into(),json!(frame.timestamp_us.to_string())); fields.insert("frameBase64".into(),json!(STANDARD.encode(frame.frame)));
        }
        VideoResult::NoTargetFace(value) => disposition(fields, "no-target-face", value)?,
        VideoResult::InputDropped(value) => disposition(fields, "input-dropped", value)?,
        VideoResult::InputRejected(value) => disposition(fields, "input-rejected", value)?,
        VideoResult::SessionTerminal(value) => {
            let reason = crate::generated::ReasonCode::try_from(value.reason_code).map_err(|_| untrusted())?;
            fields.insert("type".into(),json!("session-terminal"));fields.insert("reasonCode".into(),json!(reason.as_str_name().to_lowercase().replace('_',"-")));
        }
    }
    Ok(json!({"result":projection}))
}

fn disposition(fields: &mut serde_json::Map<String, Value>, kind: &str, value: AiVideoFrameDisposition) -> Result<(), LocalAppOperationError> {
    use crate::generated::ReasonCode;
    let reason = ReasonCode::try_from(value.reason_code).map_err(|_| untrusted())?;
    let valid = match kind {
        "no-target-face" => reason == ReasonCode::AiFaceTargetMissing,
        "input-dropped" => reason == ReasonCode::AiVideoSessionOverloaded,
        "input-rejected" => reason == ReasonCode::AiFaceTargetAmbiguous || reason == ReasonCode::AiInputInvalid,
        _ => false,
    };
    if !valid || value.sequence == 0 { return Err(untrusted()); }
    fields.insert("type".into(),json!(kind)); fields.insert("sequence".into(),json!(value.sequence.to_string())); fields.insert("timestampUs".into(),json!(value.timestamp_us.to_string())); fields.insert("reasonCode".into(),json!(reason.as_str_name().to_lowercase().replace('_',"-")));
    Ok(())
}

pub(super) async fn close(channel: Channel, input: LocalAppVideoSessionScopeRequest) -> Result<Value, LocalAppOperationError> {
    scope(&input.video_session_id, input.generation)?;
    let response = crate::grpc_limits::runtime_ai_video_session_client(channel).close_video_session(CloseVideoSessionRequest { video_session_id: input.video_session_id, generation: input.generation }).await.map_err(local_app_error_from_status)?.into_inner();
    if !response.closed { return Err(untrusted()); }
    Ok(json!({"closed":true}))
}
