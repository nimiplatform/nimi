use serde_json::{json, Map, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::{transport::Channel, Request};

use crate::generated::execute_local_app_scenario_request::Spec as ExecuteSpec;
use crate::generated::execute_local_app_scenario_response::Output as ExecuteOutput;
use crate::generated::speech_transcription_audio_source::Source as AudioSource;
use crate::generated::stream_local_app_text_turn_event::Payload as TextTurnPayload;
use crate::generated::submit_local_app_scenario_job_request::Spec as JobSpec;
use crate::generated::voice_reference::Reference as VoiceReferenceValue;
use crate::generated::{
    runtime_ai_service_client::RuntimeAiServiceClient,
    CancelLocalAppScenarioJobRequest as ProtoCancelJobRequest,
    ExecuteLocalAppScenarioRequest as ProtoExecuteRequest,
    GetLocalAppScenarioJobRequest as ProtoGetJobRequest,
    ListLocalAppVoiceAssetsRequest as ProtoListVoiceAssetsRequest,
    LocalAppImageGenerateScenarioSpec, LocalAppScenarioArtifact, LocalAppScenarioJob,
    LocalAppScenarioJobEvent, LocalAppSpeechSynthesizeJobSpec, LocalAppSpeechTranscribeJobSpec,
    LocalAppTextEmbedScenarioSpec, LocalAppTextTurnFailed, LocalAppVideoGenerateJobSpec,
    LocalAppVideoGenerationOptions, LocalAppVoiceAsset, LocalAppVoiceCloneJobSpec,
    LocalAppVoiceDesignJobSpec, ReadLocalAppArtifactRequest as ProtoReadArtifactRequest,
    ScenarioJobEventType, ScenarioJobStatus, ScenarioType, SpeechTimingMode,
    SpeechTranscriptionAudioSource, StreamLocalAppTextTurnRequest as ProtoTextTurnRequest,
    SubmitLocalAppScenarioJobRequest as ProtoSubmitJobRequest,
    SubscribeLocalAppScenarioJobEventsRequest,
    UploadLocalAppArtifactRequest as ProtoUploadArtifactRequest, VideoContentArtifactRef,
    VideoContentAudioUrl, VideoContentImageUrl, VideoContentItem, VideoContentRole,
    VideoContentType, VideoContentVideoUrl, VideoMode, VoiceAssetStatus, VoiceReference,
    VoiceReferenceKind, VoiceRenderHints, VoiceT2vInput, VoiceV2vInput, VoiceWorkflowType,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppScenarioCancelRequest, LocalAppScenarioExecuteRequest,
    LocalAppScenarioGetRequest, LocalAppScenarioJobSubscribeRequest,
    LocalAppScenarioListVoiceAssetsRequest, LocalAppScenarioReadArtifactRequest,
    LocalAppScenarioStreamReceiver, LocalAppScenarioSubmitRequest,
    LocalAppScenarioUploadArtifactRequest, LocalAppTextCandidateRequest,
};

use super::{invalid_payload, text_candidate, untrusted};

const UNARY_TIMEOUT_SECONDS: u64 = 120;
const MAX_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;
const MAX_ARTIFACTS: usize = 16;
const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_TRACE_BYTES: usize = 512;
const MAX_REASON_DETAIL_BYTES: usize = 1024;
const MAX_ACTION_HINT_BYTES: usize = 512;
const MAX_PROMPT_BYTES: usize = 32 * 1024;
const MAX_VIDEO_TEXT_BYTES: usize = 8 * 1024;
const MAX_URI_BYTES: usize = 2048;
const MAX_REFERENCE_AUDIO_BYTES: usize = 20 * 1024 * 1024;
const MAX_TRANSCRIPTION_TEXT_BYTES: usize = 256 * 1024;

pub(super) async fn execute(
    channel: Channel,
    request: LocalAppScenarioExecuteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let spec = parse_execute_spec(request.spec)?;
    let mut grpc_request = Request::new(ProtoExecuteRequest { spec: Some(spec) });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .execute_local_app_scenario(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    valid_runtime_text(&response.trace_id, MAX_TRACE_BYTES)?;
    let output = match response.output.ok_or_else(untrusted)? {
        ExecuteOutput::TextEmbed(value) => {
            if value.vectors.is_empty() || value.vectors.len() > 16 {
                return Err(untrusted());
            }
            let vectors = value
                .vectors
                .into_iter()
                .map(|vector| {
                    if vector.values.is_empty()
                        || vector.values.len() > 8192
                        || vector.values.iter().any(|entry| !entry.is_finite())
                    {
                        return Err(untrusted());
                    }
                    Ok(JsonValue::Array(
                        vector.values.into_iter().map(JsonValue::from).collect(),
                    ))
                })
                .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
            json!({"type": "text-embed", "vectors": vectors})
        }
        ExecuteOutput::ImageGenerate(value) => json!({
            "type": "image-generate",
            "artifacts": project_artifacts(value.artifacts)?,
        }),
    };
    Ok(json!({"output": output, "traceId": response.trace_id}))
}

pub(super) async fn submit_job(
    channel: Channel,
    request: LocalAppScenarioSubmitRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let spec = parse_job_spec(request.spec)?;
    let mut grpc_request = Request::new(ProtoSubmitJobRequest { spec: Some(spec) });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .submit_local_app_scenario_job(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.job.is_none() && response.asset.is_none() {
        return Err(untrusted());
    }
    Ok(json!({
        "job": response.job.map(project_job).transpose()?,
        "asset": response.asset.map(project_voice_asset).transpose()?,
    }))
}

pub(super) async fn get_job(
    channel: Channel,
    request: LocalAppScenarioGetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_identifier(&request.job_id)?;
    let mut grpc_request = Request::new(ProtoGetJobRequest {
        job_id: request.job_id,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .get_local_app_scenario_job(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"job": project_job(response.job.ok_or_else(untrusted)?)?}))
}

pub(super) async fn cancel_job(
    channel: Channel,
    request: LocalAppScenarioCancelRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_identifier(&request.job_id)?;
    require_optional_trimmed_text(&request.reason, MAX_ACTION_HINT_BYTES)?;
    let mut grpc_request = Request::new(ProtoCancelJobRequest {
        job_id: request.job_id,
        reason: request.reason,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .cancel_local_app_scenario_job(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"job": project_job(response.job.ok_or_else(untrusted)?)?}))
}

pub(super) async fn subscribe_job(
    channel: Channel,
    request: LocalAppScenarioJobSubscribeRequest,
) -> Result<LocalAppScenarioStreamReceiver, LocalAppOperationError> {
    require_identifier(&request.job_id)?;
    let mut stream = RuntimeAiServiceClient::new(channel)
        .subscribe_local_app_scenario_job_events(SubscribeLocalAppScenarioJobEventsRequest {
            job_id: request.job_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        let mut last_sequence = 0u64;
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    let projected = if event.sequence <= last_sequence {
                        Err(untrusted())
                    } else {
                        last_sequence = event.sequence;
                        project_job_event(event)
                    };
                    if sender.send(projected).await.is_err() {
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

pub(super) async fn stream_text_turn(
    channel: Channel,
    request: LocalAppTextCandidateRequest,
) -> Result<LocalAppScenarioStreamReceiver, LocalAppOperationError> {
    text_candidate::validate_request(&request)?;
    let mut stream = RuntimeAiServiceClient::new(channel)
        .stream_local_app_text_turn(ProtoTextTurnRequest {
            messages: request
                .messages
                .into_iter()
                .map(|message| crate::generated::LocalAppTextCandidateMessage {
                    role: message.role,
                    text: message.text,
                })
                .collect(),
            temperature: request.temperature,
            top_p: request.top_p,
            max_tokens: request.max_tokens,
            top_k: request.top_k,
            presence_penalty: request.presence_penalty,
            frequency_penalty: request.frequency_penalty,
            stop: request.stop,
            seed: request.seed,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        let mut expected_sequence = 1u64;
        let mut total_delta_bytes = 0usize;
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    let projected =
                        project_text_turn_event(event, expected_sequence, &mut total_delta_bytes);
                    if projected.is_ok() {
                        expected_sequence += 1;
                    }
                    if sender.send(projected).await.is_err() {
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

pub(super) async fn read_artifact(
    channel: Channel,
    request: LocalAppScenarioReadArtifactRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_identifier(&request.artifact_id)?;
    let mut grpc_request = Request::new(ProtoReadArtifactRequest {
        artifact_id: request.artifact_id,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .read_local_app_artifact(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.bytes.len() > MAX_ARTIFACT_BYTES
        || response.size_bytes < 0
        || response.size_bytes as usize != response.bytes.len()
        || !valid_mime(&response.mime_type)
    {
        return Err(untrusted());
    }
    Ok(
        json!({"bytes": response.bytes, "mimeType": response.mime_type, "sizeBytes": response.size_bytes}),
    )
}

pub(super) async fn upload_artifact(
    channel: Channel,
    request: LocalAppScenarioUploadArtifactRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    if request.bytes.is_empty()
        || request.bytes.len() > MAX_ARTIFACT_BYTES
        || !valid_image_mime(&request.mime_type)
    {
        return Err(invalid_payload());
    }
    let expected_size = request.bytes.len();
    let expected_mime = request.mime_type.clone();
    let mut grpc_request = Request::new(ProtoUploadArtifactRequest {
        bytes: request.bytes,
        mime_type: request.mime_type,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .upload_local_app_artifact(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_identifier(&response.artifact_id).map_err(|_| untrusted())?;
    if response.size_bytes != expected_size as i64
        || response.mime_type != expected_mime
        || !valid_image_mime(&response.mime_type)
    {
        return Err(untrusted());
    }
    Ok(json!({
        "artifactId": response.artifact_id,
        "sizeBytes": response.size_bytes,
        "mimeType": response.mime_type,
    }))
}

pub(super) async fn list_voice_assets(
    channel: Channel,
    request: LocalAppScenarioListVoiceAssetsRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    if !(0..=200).contains(&request.page_size) || !valid_page_token(&request.page_token) {
        return Err(invalid_payload());
    }
    let mut grpc_request = Request::new(ProtoListVoiceAssetsRequest {
        page_size: request.page_size,
        page_token: request.page_token,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = RuntimeAiServiceClient::new(channel)
        .list_local_app_voice_assets(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.assets.len() > 200 || !valid_page_token(&response.next_page_token) {
        return Err(untrusted());
    }
    Ok(json!({
        "assets": response.assets.into_iter().map(project_voice_asset).collect::<Result<Vec<_>, _>>()?,
        "nextPageToken": response.next_page_token,
    }))
}

fn parse_execute_spec(value: JsonValue) -> Result<ExecuteSpec, LocalAppOperationError> {
    let object = exact_object(value)?;
    match string_field(&object, "type")? {
        "text-embed" => {
            exact_keys(&object, &["type", "inputs"])?;
            let inputs = string_array(field(&object, "inputs")?, 16, MAX_PROMPT_BYTES, false)?;
            if inputs.is_empty() || inputs.iter().map(String::len).sum::<usize>() > 64 * 1024 {
                return Err(invalid_payload());
            }
            Ok(ExecuteSpec::TextEmbed(LocalAppTextEmbedScenarioSpec {
                inputs,
            }))
        }
        "image-generate" => Ok(ExecuteSpec::ImageGenerate(parse_image_spec(&object)?)),
        _ => Err(invalid_payload()),
    }
}

fn parse_job_spec(value: JsonValue) -> Result<JobSpec, LocalAppOperationError> {
    let object = exact_object(value)?;
    match string_field(&object, "type")? {
        "image-generate" => Ok(JobSpec::ImageGenerate(parse_image_spec(&object)?)),
        "video-generate" => Ok(JobSpec::VideoGenerate(parse_video_spec(&object)?)),
        "speech-synthesize" => Ok(JobSpec::SpeechSynthesize(parse_speech_synthesize_spec(
            &object,
        )?)),
        "speech-transcribe" => Ok(JobSpec::SpeechTranscribe(parse_speech_transcribe_spec(
            &object,
        )?)),
        "voice-clone" => Ok(JobSpec::VoiceClone(parse_voice_clone_spec(&object)?)),
        "voice-design" => Ok(JobSpec::VoiceDesign(parse_voice_design_spec(&object)?)),
        _ => Err(invalid_payload()),
    }
}

fn parse_image_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppImageGenerateScenarioSpec, LocalAppOperationError> {
    allowed_keys(
        object,
        &[
            "type",
            "prompt",
            "negativePrompt",
            "n",
            "size",
            "aspectRatio",
            "quality",
            "style",
            "seed",
            "referenceImages",
            "mask",
            "responseFormat",
        ],
        &[
            "type",
            "prompt",
            "negativePrompt",
            "size",
            "aspectRatio",
            "quality",
            "style",
            "referenceImages",
            "mask",
            "responseFormat",
        ],
    )?;
    let prompt = required_text_field(object, "prompt", MAX_PROMPT_BYTES)?;
    let negative_prompt = optional_text_field(object, "negativePrompt", MAX_PROMPT_BYTES)?;
    let n = optional_integer_field(object, "n")?;
    let seed = optional_integer_field(object, "seed")?;
    if n.is_some_and(|value| !(0..=4).contains(&value)) || seed.is_some_and(|value| value < 0) {
        return Err(invalid_payload());
    }
    let reference_images =
        string_array(field(object, "referenceImages")?, 1, MAX_URI_BYTES, false)?;
    if reference_images.iter().any(|value| !is_https_url(value)) {
        return Err(invalid_payload());
    }
    let mask = optional_text_field(object, "mask", MAX_URI_BYTES)?;
    if (!mask.is_empty() && !is_https_url(&mask))
        || !matches!(
            string_field(object, "responseFormat")?,
            "" | "b64_json" | "url"
        )
    {
        return Err(invalid_payload());
    }
    Ok(LocalAppImageGenerateScenarioSpec {
        prompt,
        negative_prompt,
        n: n.map(|value| i32::try_from(value).map_err(|_| invalid_payload()))
            .transpose()?,
        size: bounded_token_field(object, "size", 128)?,
        aspect_ratio: bounded_token_field(object, "aspectRatio", 128)?,
        quality: bounded_token_field(object, "quality", 128)?,
        style: bounded_token_field(object, "style", 128)?,
        seed,
        reference_images,
        mask,
        response_format: string_field(object, "responseFormat")?.to_string(),
    })
}

fn parse_video_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppVideoGenerateJobSpec, LocalAppOperationError> {
    exact_keys(
        object,
        &[
            "type",
            "prompt",
            "negativePrompt",
            "mode",
            "content",
            "options",
        ],
    )?;
    let prompt = optional_text_field(object, "prompt", MAX_PROMPT_BYTES)?;
    let negative_prompt = optional_text_field(object, "negativePrompt", MAX_PROMPT_BYTES)?;
    let mode = match string_field(object, "mode")? {
        "t2v" => VideoMode::T2v,
        "i2v-first-frame" => VideoMode::I2vFirstFrame,
        "i2v-first-last" => VideoMode::I2vFirstLast,
        "i2v-reference" => VideoMode::I2vReference,
        _ => return Err(invalid_payload()),
    } as i32;
    let content_values = field(object, "content")?
        .as_array()
        .ok_or_else(invalid_payload)?;
    if content_values.len() > 8 || (prompt.is_empty() && content_values.is_empty()) {
        return Err(invalid_payload());
    }
    let content = content_values
        .iter()
        .cloned()
        .map(parse_video_content)
        .collect::<Result<Vec<_>, _>>()?;
    let options_object = field(object, "options")?
        .as_object()
        .ok_or_else(invalid_payload)?;
    allowed_keys(
        options_object,
        &[
            "resolution",
            "ratio",
            "durationSec",
            "frames",
            "fps",
            "seed",
            "cameraFixed",
            "watermark",
            "generateAudio",
            "draft",
            "returnLastFrame",
        ],
        &["resolution", "ratio"],
    )?;
    let duration_sec = optional_integer_field(options_object, "durationSec")?;
    let frames = optional_integer_field(options_object, "frames")?;
    let fps = optional_integer_field(options_object, "fps")?;
    let seed = optional_integer_field(options_object, "seed")?;
    if duration_sec.is_some_and(|value| !(0..=600).contains(&value))
        || frames.is_some_and(|value| !(0..=100_000).contains(&value))
        || fps.is_some_and(|value| !(0..=120).contains(&value))
        || seed.is_some_and(|value| value < 0)
    {
        return Err(invalid_payload());
    }
    Ok(LocalAppVideoGenerateJobSpec {
        prompt,
        negative_prompt,
        mode,
        content,
        options: Some(LocalAppVideoGenerationOptions {
            resolution: bounded_token_field(options_object, "resolution", 64)?,
            ratio: bounded_token_field(options_object, "ratio", 64)?,
            duration_sec: optional_i32(duration_sec)?,
            frames: optional_i32(frames)?,
            fps: optional_i32(fps)?,
            seed,
            camera_fixed: optional_bool_field(options_object, "cameraFixed")?,
            watermark: optional_bool_field(options_object, "watermark")?,
            generate_audio: optional_bool_field(options_object, "generateAudio")?,
            draft: optional_bool_field(options_object, "draft")?,
            return_last_frame: optional_bool_field(options_object, "returnLastFrame")?,
        }),
    })
}

fn parse_video_content(value: JsonValue) -> Result<VideoContentItem, LocalAppOperationError> {
    let object = exact_object(value)?;
    let role = match string_field(&object, "role")? {
        "prompt" => VideoContentRole::Prompt,
        "first-frame" => VideoContentRole::FirstFrame,
        "last-frame" => VideoContentRole::LastFrame,
        "reference-image" => VideoContentRole::ReferenceImage,
        "reference-video" => VideoContentRole::ReferenceVideo,
        "reference-audio" => VideoContentRole::ReferenceAudio,
        _ => return Err(invalid_payload()),
    } as i32;
    let mut item = VideoContentItem {
        role,
        ..Default::default()
    };
    match string_field(&object, "type")? {
        "text" => {
            exact_keys(&object, &["type", "role", "text"])?;
            item.r#type = VideoContentType::Text as i32;
            item.text = required_text_field(&object, "text", MAX_VIDEO_TEXT_BYTES)?;
        }
        "image-url" | "video-url" | "audio-url" => {
            exact_keys(&object, &["type", "role", "url"])?;
            let url = https_url_field(&object, "url")?;
            match string_field(&object, "type")? {
                "image-url" => {
                    item.r#type = VideoContentType::ImageUrl as i32;
                    item.image_url = Some(VideoContentImageUrl { url });
                }
                "video-url" => {
                    item.r#type = VideoContentType::VideoUrl as i32;
                    item.video_url = Some(VideoContentVideoUrl { url });
                }
                _ => {
                    item.r#type = VideoContentType::AudioUrl as i32;
                    item.audio_url = Some(VideoContentAudioUrl { url });
                }
            }
        }
        "artifact-ref" => {
            exact_keys(&object, &["type", "role", "artifactId"])?;
            let artifact_id = required_text_field(&object, "artifactId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&artifact_id)?;
            item.r#type = VideoContentType::ArtifactRef as i32;
            item.artifact_ref = Some(VideoContentArtifactRef { artifact_id });
        }
        _ => return Err(invalid_payload()),
    }
    Ok(item)
}

fn parse_speech_synthesize_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppSpeechSynthesizeJobSpec, LocalAppOperationError> {
    allowed_keys(
        object,
        &[
            "type",
            "text",
            "language",
            "audioFormat",
            "sampleRateHz",
            "speed",
            "pitch",
            "volume",
            "emotion",
            "voiceRef",
            "timingMode",
            "voiceRenderHints",
        ],
        &[
            "type",
            "text",
            "language",
            "audioFormat",
            "emotion",
            "voiceRef",
            "timingMode",
            "voiceRenderHints",
        ],
    )?;
    let sample_rate_hz = optional_integer_field(object, "sampleRateHz")?;
    if sample_rate_hz.is_some_and(|value| !(0..=192_000).contains(&value)) {
        return Err(invalid_payload());
    }
    let speed = optional_float_field(object, "speed", 0.0, 4.0)?;
    let pitch = optional_float_field(object, "pitch", -24.0, 24.0)?;
    let volume = optional_float_field(object, "volume", 0.0, 4.0)?;
    let timing_mode = match string_field(object, "timingMode")? {
        "none" => SpeechTimingMode::None,
        "word" => SpeechTimingMode::Word,
        "char" => SpeechTimingMode::Char,
        _ => return Err(invalid_payload()),
    } as i32;
    Ok(LocalAppSpeechSynthesizeJobSpec {
        text: required_text_field(object, "text", MAX_PROMPT_BYTES)?,
        language: bounded_token_field(object, "language", 64)?,
        audio_format: bounded_token_field(object, "audioFormat", 64)?,
        sample_rate_hz: optional_i32(sample_rate_hz)?,
        speed,
        pitch,
        volume,
        emotion: bounded_token_field(object, "emotion", 128)?,
        voice_ref: parse_voice_ref(field(object, "voiceRef")?)?,
        timing_mode,
        voice_render_hints: parse_voice_hints(field(object, "voiceRenderHints")?)?,
    })
}

fn parse_voice_ref(value: &JsonValue) -> Result<Option<VoiceReference>, LocalAppOperationError> {
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or_else(invalid_payload)?;
    exact_keys(object, &["type", "id"])?;
    let id = required_text_field(object, "id", MAX_IDENTIFIER_BYTES)?;
    let (kind, reference) = match string_field(object, "type")? {
        "preset" => (
            VoiceReferenceKind::Preset,
            VoiceReferenceValue::PresetVoiceId(id),
        ),
        "voice-asset" => (
            VoiceReferenceKind::VoiceAsset,
            VoiceReferenceValue::VoiceAssetId(id),
        ),
        _ => return Err(invalid_payload()),
    };
    Ok(Some(VoiceReference {
        kind: kind as i32,
        reference: Some(reference),
    }))
}

fn parse_voice_hints(
    value: &JsonValue,
) -> Result<Option<VoiceRenderHints>, LocalAppOperationError> {
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or_else(invalid_payload)?;
    exact_keys(
        object,
        &[
            "stability",
            "similarityBoost",
            "style",
            "useSpeakerBoost",
            "speed",
        ],
    )?;
    Ok(Some(VoiceRenderHints {
        stability: float_field(object, "stability", 0.0, 10.0)?,
        similarity_boost: float_field(object, "similarityBoost", 0.0, 10.0)?,
        style: float_field(object, "style", 0.0, 10.0)?,
        use_speaker_boost: bool_field(object, "useSpeakerBoost")?,
        speed: float_field(object, "speed", 0.0, 10.0)?,
    }))
}

fn parse_speech_transcribe_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppSpeechTranscribeJobSpec, LocalAppOperationError> {
    allowed_keys(
        object,
        &[
            "type",
            "mimeType",
            "language",
            "timestamps",
            "diarization",
            "speakerCount",
            "prompt",
            "audioSource",
            "responseFormat",
        ],
        &[
            "type",
            "mimeType",
            "language",
            "prompt",
            "audioSource",
            "responseFormat",
        ],
    )?;
    let speaker_count = optional_integer_field(object, "speakerCount")?;
    if speaker_count.is_some_and(|value| !(0..=32).contains(&value)) {
        return Err(invalid_payload());
    }
    let audio_object = field(object, "audioSource")?
        .as_object()
        .ok_or_else(invalid_payload)?;
    let (source, bytes_source) = match string_field(audio_object, "type")? {
        "bytes" => {
            exact_keys(audio_object, &["type", "bytes"])?;
            (
                AudioSource::AudioBytes(byte_array(
                    field(audio_object, "bytes")?,
                    MAX_ARTIFACT_BYTES,
                )?),
                true,
            )
        }
        "uri" => {
            exact_keys(audio_object, &["type", "uri"])?;
            (
                AudioSource::AudioUri(https_url_field(audio_object, "uri")?),
                false,
            )
        }
        _ => return Err(invalid_payload()),
    };
    let mime_type = bounded_token_field(object, "mimeType", 128)?;
    if bytes_source && mime_type.is_empty() {
        return Err(invalid_payload());
    }
    Ok(LocalAppSpeechTranscribeJobSpec {
        mime_type,
        language: bounded_token_field(object, "language", 64)?,
        timestamps: optional_bool_field(object, "timestamps")?,
        diarization: optional_bool_field(object, "diarization")?,
        speaker_count: optional_i32(speaker_count)?,
        prompt: optional_text_field(object, "prompt", 4 * 1024)?,
        audio_source: Some(SpeechTranscriptionAudioSource {
            source: Some(source),
        }),
        response_format: bounded_token_field(object, "responseFormat", 64)?,
    })
}

fn parse_voice_clone_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppVoiceCloneJobSpec, LocalAppOperationError> {
    exact_keys(
        object,
        &[
            "type",
            "referenceAudio",
            "referenceAudioMime",
            "languageHints",
            "preferredName",
            "text",
        ],
    )?;
    let reference = field(object, "referenceAudio")?
        .as_object()
        .ok_or_else(invalid_payload)?;
    let (reference_audio_bytes, reference_audio_uri) = match string_field(reference, "type")? {
        "bytes" => {
            exact_keys(reference, &["type", "bytes"])?;
            (
                byte_array(field(reference, "bytes")?, MAX_REFERENCE_AUDIO_BYTES)?,
                String::new(),
            )
        }
        "uri" => {
            exact_keys(reference, &["type", "uri"])?;
            (Vec::new(), https_url_field(reference, "uri")?)
        }
        _ => return Err(invalid_payload()),
    };
    let reference_audio_mime = bounded_token_field(object, "referenceAudioMime", 128)?;
    if !reference_audio_bytes.is_empty() && reference_audio_mime.is_empty() {
        return Err(invalid_payload());
    }
    Ok(LocalAppVoiceCloneJobSpec {
        input: Some(VoiceV2vInput {
            reference_audio_bytes,
            reference_audio_uri,
            reference_audio_mime,
            language_hints: string_array(field(object, "languageHints")?, 8, 64, false)?,
            preferred_name: bounded_token_field(object, "preferredName", 256)?,
            text: optional_text_field(object, "text", MAX_PROMPT_BYTES)?,
        }),
    })
}

fn parse_voice_design_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppVoiceDesignJobSpec, LocalAppOperationError> {
    exact_keys(
        object,
        &[
            "type",
            "instructionText",
            "previewText",
            "language",
            "preferredName",
        ],
    )?;
    Ok(LocalAppVoiceDesignJobSpec {
        input: Some(VoiceT2vInput {
            instruction_text: required_text_field(object, "instructionText", 8 * 1024)?,
            preview_text: optional_text_field(object, "previewText", 8 * 1024)?,
            language: bounded_token_field(object, "language", 64)?,
            preferred_name: bounded_token_field(object, "preferredName", 256)?,
        }),
    })
}

fn project_job(job: LocalAppScenarioJob) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&job.job_id)?;
    let scenario_type = match ScenarioType::try_from(job.scenario_type).map_err(|_| untrusted())? {
        ScenarioType::ImageGenerate => "image-generate",
        ScenarioType::VideoGenerate => "video-generate",
        ScenarioType::SpeechSynthesize => "speech-synthesize",
        ScenarioType::SpeechTranscribe => "speech-transcribe",
        ScenarioType::VoiceClone => "voice-clone",
        ScenarioType::VoiceDesign => "voice-design",
        _ => return Err(untrusted()),
    };
    let status = match ScenarioJobStatus::try_from(job.status).map_err(|_| untrusted())? {
        ScenarioJobStatus::Submitted => "submitted",
        ScenarioJobStatus::Queued => "queued",
        ScenarioJobStatus::Running => "running",
        ScenarioJobStatus::Completed => "completed",
        ScenarioJobStatus::Failed => "failed",
        ScenarioJobStatus::Canceled => "canceled",
        ScenarioJobStatus::Timeout => "timeout",
        ScenarioJobStatus::Unspecified => return Err(untrusted()),
    };
    if !(0..=100).contains(&job.progress_percent)
        || job.progress_current_step < 0
        || job.progress_total_steps < 0
        || job.progress_current_step > job.progress_total_steps
        || job.reason_detail.len() > MAX_REASON_DETAIL_BYTES
        || (!job.reason_detail.is_empty() && job.reason_detail.trim() != job.reason_detail)
        || job.transcription_text.len() > MAX_TRANSCRIPTION_TEXT_BYTES
        || (scenario_type != "speech-transcribe" && !job.transcription_text.is_empty())
    {
        return Err(untrusted());
    }
    let reason_code = enum_token(
        crate::generated::ReasonCode::try_from(job.reason_code)
            .map_err(|_| untrusted())?
            .as_str_name(),
        "REASON_CODE_",
    );
    valid_optional_runtime_text(&job.trace_id, MAX_TRACE_BYTES)?;
    Ok(json!({
        "jobId": job.job_id,
        "scenarioType": scenario_type,
        "status": status,
        "progressPercent": job.progress_percent,
        "progressCurrentStep": job.progress_current_step,
        "progressTotalSteps": job.progress_total_steps,
        "reasonCode": reason_code,
        "reasonDetail": job.reason_detail,
        "artifacts": project_artifacts(job.artifacts)?,
        "traceId": job.trace_id,
        "createdAt": project_timestamp(job.created_at)?,
        "updatedAt": project_timestamp(job.updated_at)?,
        "transcriptionText": job.transcription_text,
    }))
}

fn project_artifacts(
    artifacts: Vec<LocalAppScenarioArtifact>,
) -> Result<Vec<JsonValue>, LocalAppOperationError> {
    if artifacts.len() > MAX_ARTIFACTS {
        return Err(untrusted());
    }
    artifacts
        .into_iter()
        .map(|artifact| {
            require_runtime_identifier(&artifact.artifact_id)?;
            if !valid_mime(&artifact.mime_type)
                || artifact.bytes.len() > MAX_ARTIFACT_BYTES
                || artifact.size_bytes < 0
                || artifact.duration_ms < 0
                || artifact.width < 0
                || artifact.height < 0
                || artifact.sample_rate_hz < 0
                || artifact.channels < 0
                || artifact.sha256.len() > 128
                || artifact.sha256.trim() != artifact.sha256
                || (!artifact.bytes.is_empty()
                    && artifact.size_bytes as usize != artifact.bytes.len())
            {
                return Err(untrusted());
            }
            Ok(json!({
                "artifactId": artifact.artifact_id,
                "mimeType": artifact.mime_type,
                "bytes": artifact.bytes,
                "sizeBytes": artifact.size_bytes,
                "sha256": artifact.sha256,
                "durationMs": artifact.duration_ms,
                "width": artifact.width,
                "height": artifact.height,
                "sampleRateHz": artifact.sample_rate_hz,
                "channels": artifact.channels,
            }))
        })
        .collect()
}

fn project_voice_asset(asset: LocalAppVoiceAsset) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&asset.voice_asset_id)?;
    let workflow_type =
        match VoiceWorkflowType::try_from(asset.workflow_type).map_err(|_| untrusted())? {
            VoiceWorkflowType::VoiceClone => "voice-clone",
            VoiceWorkflowType::VoiceDesign => "voice-design",
            VoiceWorkflowType::Unspecified => return Err(untrusted()),
        };
    let status = match VoiceAssetStatus::try_from(asset.status).map_err(|_| untrusted())? {
        VoiceAssetStatus::Active => "active",
        VoiceAssetStatus::Expired => "expired",
        VoiceAssetStatus::Deleted => "deleted",
        VoiceAssetStatus::Failed => "failed",
        VoiceAssetStatus::Unspecified => return Err(untrusted()),
    };
    Ok(json!({
        "voiceAssetId": asset.voice_asset_id,
        "workflowType": workflow_type,
        "status": status,
        "createdAt": project_timestamp(asset.created_at)?,
        "updatedAt": project_timestamp(asset.updated_at)?,
        "expiresAt": project_timestamp(asset.expires_at)?,
    }))
}

fn project_job_event(event: LocalAppScenarioJobEvent) -> Result<JsonValue, LocalAppOperationError> {
    if event.sequence == 0 {
        return Err(untrusted());
    }
    valid_optional_runtime_text(&event.trace_id, MAX_TRACE_BYTES)?;
    let event_type =
        match ScenarioJobEventType::try_from(event.event_type).map_err(|_| untrusted())? {
            ScenarioJobEventType::ScenarioJobEventSubmitted => "submitted",
            ScenarioJobEventType::ScenarioJobEventQueued => "queued",
            ScenarioJobEventType::ScenarioJobEventRunning => "running",
            ScenarioJobEventType::ScenarioJobEventCompleted => "completed",
            ScenarioJobEventType::ScenarioJobEventFailed => "failed",
            ScenarioJobEventType::ScenarioJobEventCanceled => "canceled",
            ScenarioJobEventType::ScenarioJobEventTimeout => "timeout",
            ScenarioJobEventType::Unspecified => return Err(untrusted()),
        };
    Ok(json!({
        "eventType": event_type,
        "sequence": event.sequence.to_string(),
        "traceId": event.trace_id,
        "timestamp": project_timestamp(event.timestamp)?,
        "job": project_job(event.job.ok_or_else(untrusted)?)?,
    }))
}

fn project_text_turn_event(
    event: crate::generated::StreamLocalAppTextTurnEvent,
    expected_sequence: u64,
    total_delta_bytes: &mut usize,
) -> Result<JsonValue, LocalAppOperationError> {
    if event.sequence != expected_sequence {
        return Err(untrusted());
    }
    valid_runtime_text(&event.trace_id, MAX_TRACE_BYTES)?;
    match event.payload.ok_or_else(untrusted)? {
        TextTurnPayload::Delta(value) => {
            if value.text.is_empty() || value.text.len() > 64 * 1024 {
                return Err(untrusted());
            }
            *total_delta_bytes = total_delta_bytes
                .checked_add(value.text.len())
                .filter(|total| *total <= 256 * 1024)
                .ok_or_else(untrusted)?;
            Ok(
                json!({"type": "delta", "sequence": event.sequence.to_string(), "traceId": event.trace_id, "text": value.text}),
            )
        }
        TextTurnPayload::Completed(value) => {
            let finish_reason = match value.finish_reason {
                1 => "stop",
                2 => "length",
                4 => "content-filter",
                _ => return Err(untrusted()),
            };
            Ok(
                json!({"type": "completed", "sequence": event.sequence.to_string(), "traceId": event.trace_id, "finishReason": finish_reason}),
            )
        }
        TextTurnPayload::Failed(LocalAppTextTurnFailed {
            reason_code,
            action_hint,
        }) => {
            let reason =
                crate::generated::ReasonCode::try_from(reason_code).map_err(|_| untrusted())?;
            if reason == crate::generated::ReasonCode::Unspecified {
                return Err(untrusted());
            }
            valid_optional_runtime_text(&action_hint, MAX_ACTION_HINT_BYTES)?;
            Ok(
                json!({"type": "failed", "sequence": event.sequence.to_string(), "traceId": event.trace_id,
                "reasonCode": enum_token(reason.as_str_name(), "REASON_CODE_"), "actionHint": action_hint}),
            )
        }
    }
}

fn project_timestamp(
    value: Option<prost_types::Timestamp>,
) -> Result<JsonValue, LocalAppOperationError> {
    let Some(value) = value else {
        return Ok(JsonValue::Null);
    };
    if !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    Ok(json!({"seconds": value.seconds.to_string(), "nanos": value.nanos}))
}

fn enum_token(value: &str, prefix: &str) -> String {
    value
        .strip_prefix(prefix)
        .unwrap_or(value)
        .to_ascii_lowercase()
        .replace('_', "-")
}

fn exact_object(value: JsonValue) -> Result<Map<String, JsonValue>, LocalAppOperationError> {
    value.as_object().cloned().ok_or_else(invalid_payload)
}

fn exact_keys(
    object: &Map<String, JsonValue>,
    keys: &[&str],
) -> Result<(), LocalAppOperationError> {
    allowed_keys(object, keys, keys)
}

fn allowed_keys(
    object: &Map<String, JsonValue>,
    allowed: &[&str],
    required: &[&str],
) -> Result<(), LocalAppOperationError> {
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || required.iter().any(|key| !object.contains_key(*key))
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn field<'a>(
    object: &'a Map<String, JsonValue>,
    key: &str,
) -> Result<&'a JsonValue, LocalAppOperationError> {
    object.get(key).ok_or_else(invalid_payload)
}

fn string_field<'a>(
    object: &'a Map<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    field(object, key)?.as_str().ok_or_else(invalid_payload)
}

fn required_text_field(
    object: &Map<String, JsonValue>,
    key: &str,
    maximum: usize,
) -> Result<String, LocalAppOperationError> {
    let value = string_field(object, key)?;
    if value.is_empty() || value.trim() != value || value.len() > maximum || value.contains('\0') {
        return Err(invalid_payload());
    }
    Ok(value.to_string())
}

fn optional_text_field(
    object: &Map<String, JsonValue>,
    key: &str,
    maximum: usize,
) -> Result<String, LocalAppOperationError> {
    let value = string_field(object, key)?;
    require_optional_trimmed_text(value, maximum)?;
    Ok(value.to_string())
}

fn bounded_token_field(
    object: &Map<String, JsonValue>,
    key: &str,
    maximum: usize,
) -> Result<String, LocalAppOperationError> {
    optional_text_field(object, key, maximum)
}

fn optional_integer_field(
    object: &Map<String, JsonValue>,
    key: &str,
) -> Result<Option<i64>, LocalAppOperationError> {
    object
        .get(key)
        .map(|value| value.as_i64().ok_or_else(invalid_payload))
        .transpose()
}

fn optional_i32(value: Option<i64>) -> Result<Option<i32>, LocalAppOperationError> {
    value
        .map(|entry| i32::try_from(entry).map_err(|_| invalid_payload()))
        .transpose()
}

fn bool_field(object: &Map<String, JsonValue>, key: &str) -> Result<bool, LocalAppOperationError> {
    field(object, key)?.as_bool().ok_or_else(invalid_payload)
}

fn optional_bool_field(
    object: &Map<String, JsonValue>,
    key: &str,
) -> Result<Option<bool>, LocalAppOperationError> {
    object
        .get(key)
        .map(|value| value.as_bool().ok_or_else(invalid_payload))
        .transpose()
}

fn float_field(
    object: &Map<String, JsonValue>,
    key: &str,
    minimum: f32,
    maximum: f32,
) -> Result<f32, LocalAppOperationError> {
    let value = field(object, key)?.as_f64().ok_or_else(invalid_payload)?;
    if !value.is_finite() || value < minimum as f64 || value > maximum as f64 {
        return Err(invalid_payload());
    }
    Ok(value as f32)
}

fn optional_float_field(
    object: &Map<String, JsonValue>,
    key: &str,
    minimum: f32,
    maximum: f32,
) -> Result<Option<f32>, LocalAppOperationError> {
    object
        .get(key)
        .map(|_| float_field(object, key, minimum, maximum))
        .transpose()
}

fn string_array(
    value: &JsonValue,
    max_items: usize,
    max_bytes: usize,
    allow_empty: bool,
) -> Result<Vec<String>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.len() > max_items {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            let text = value.as_str().ok_or_else(invalid_payload)?;
            if text.len() > max_bytes
                || text.trim() != text
                || text.contains('\0')
                || (!allow_empty && text.is_empty())
            {
                return Err(invalid_payload());
            }
            Ok(text.to_string())
        })
        .collect()
}

fn byte_array(value: &JsonValue, maximum: usize) -> Result<Vec<u8>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.is_empty() || values.len() > maximum {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            value
                .as_u64()
                .filter(|byte| *byte <= 255)
                .map(|byte| byte as u8)
                .ok_or_else(invalid_payload)
        })
        .collect()
}

fn https_url_field(
    object: &Map<String, JsonValue>,
    key: &str,
) -> Result<String, LocalAppOperationError> {
    let value = required_text_field(object, key, MAX_URI_BYTES)?;
    if !is_https_url(&value) {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn is_https_url(value: &str) -> bool {
    url::Url::parse(value)
        .ok()
        .is_some_and(|parsed| parsed.scheme() == "https" && parsed.host_str().is_some())
}

fn require_identifier(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn require_runtime_identifier(value: &str) -> Result<(), LocalAppOperationError> {
    require_identifier(value).map_err(|_| untrusted())
}

fn require_optional_trimmed_text(
    value: &str,
    maximum: usize,
) -> Result<(), LocalAppOperationError> {
    if value.len() > maximum || value.contains('\0') || (!value.is_empty() && value.trim() != value)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn valid_runtime_text(value: &str, maximum: usize) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.len() > maximum
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(untrusted());
    }
    Ok(())
}

fn valid_optional_runtime_text(value: &str, maximum: usize) -> Result<(), LocalAppOperationError> {
    if value.len() > maximum
        || (!value.is_empty() && (value.trim() != value || value.chars().any(char::is_control)))
    {
        return Err(untrusted());
    }
    Ok(())
}

fn valid_mime(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.trim() == value
        && value.contains('/')
        && !value.chars().any(char::is_control)
}

fn valid_image_mime(value: &str) -> bool {
    matches!(
        value,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}

fn valid_page_token(value: &str) -> bool {
    value.len() <= 10 && value.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_spec_rejects_unknown_fields_and_unbounded_embed_inputs() {
        assert!(parse_execute_spec(json!({"type": "text-embed", "inputs": ["hello"]})).is_ok());
        assert!(parse_execute_spec(
            json!({"type": "text-embed", "inputs": ["hello"], "modelId": "forbidden"})
        )
        .is_err());
        assert!(parse_execute_spec(json!({"type": "text-embed", "inputs": []})).is_err());
    }

    #[test]
    fn job_spec_rejects_route_selection_and_oversized_inline_audio() {
        let image = json!({
            "type": "image-generate", "prompt": "portrait", "negativePrompt": "", "n": 1,
            "size": "1024x1024", "aspectRatio": "1:1", "quality": "", "style": "", "seed": 0,
            "referenceImages": ["https://example.com/reference.png"],
            "mask": "https://example.com/mask.png", "responseFormat": "b64_json"
        });
        assert!(parse_job_spec(image.clone()).is_ok());
        let mut injected = image.as_object().unwrap().clone();
        injected.insert("provider".to_string(), json!("private"));
        assert!(parse_job_spec(JsonValue::Object(injected)).is_err());
        assert!(byte_array(&json!(vec![0u8; 32]), 16).is_err());
    }

    #[test]
    fn optional_scalar_presence_and_owner_clamps_are_preserved() {
        let image = parse_execute_spec(json!({
            "type": "image-generate", "prompt": "portrait", "negativePrompt": "",
            "n": 0, "size": "", "aspectRatio": "", "quality": "", "style": "", "seed": 0,
            "referenceImages": [], "mask": "", "responseFormat": ""
        }))
        .expect("explicit zero image options");
        let ExecuteSpec::ImageGenerate(image) = image else {
            panic!("image spec");
        };
        assert_eq!(image.n, Some(0));
        assert_eq!(image.seed, Some(0));

        let omitted = parse_execute_spec(json!({
            "type": "image-generate", "prompt": "portrait", "negativePrompt": "",
            "size": "", "aspectRatio": "", "quality": "", "style": "",
            "referenceImages": [], "mask": "", "responseFormat": ""
        }))
        .expect("omitted image options");
        let ExecuteSpec::ImageGenerate(omitted) = omitted else {
            panic!("image spec");
        };
        assert_eq!(omitted.n, None);
        assert_eq!(omitted.seed, None);

        let speech = json!({
            "type": "speech-synthesize", "text": "hello", "language": "", "audioFormat": "",
            "sampleRateHz": 0, "speed": 0, "pitch": -24, "volume": 4, "emotion": "",
            "voiceRef": null, "timingMode": "none", "voiceRenderHints": null
        });
        assert!(parse_job_spec(speech.clone()).is_ok());
        let mut invalid_pitch = speech.as_object().unwrap().clone();
        invalid_pitch.insert("pitch".to_string(), json!(-24.1));
        assert!(parse_job_spec(JsonValue::Object(invalid_pitch)).is_err());
        let mut invalid_speed = speech.as_object().unwrap().clone();
        invalid_speed.insert("speed".to_string(), json!(4.1));
        assert!(parse_job_spec(JsonValue::Object(invalid_speed)).is_err());
    }

    #[test]
    fn upload_artifact_mime_is_a_closed_image_set() {
        for mime in ["image/png", "image/jpeg", "image/webp", "image/gif"] {
            assert!(valid_image_mime(mime));
        }
        assert!(!valid_image_mime("video/mp4"));
        assert!(!valid_image_mime(" IMAGE/PNG "));
    }

    #[test]
    fn artifact_projection_rejects_inline_size_mismatch_and_excess_bytes() {
        let artifact = LocalAppScenarioArtifact {
            artifact_id: "artifact-1".to_string(),
            mime_type: "image/png".to_string(),
            bytes: vec![1, 2],
            size_bytes: 3,
            sha256: "abc".to_string(),
            ..Default::default()
        };
        assert!(project_artifacts(vec![artifact]).is_err());
    }

    #[test]
    fn job_projection_is_a_closed_scenario_and_status_whitelist() {
        let mut job = LocalAppScenarioJob {
            job_id: "job-1".to_string(),
            scenario_type: ScenarioType::ImageGenerate as i32,
            status: ScenarioJobStatus::Running as i32,
            progress_total_steps: 1,
            reason_code: crate::generated::ReasonCode::Unspecified as i32,
            ..Default::default()
        };
        assert!(project_job(job.clone()).is_ok());
        job.scenario_type = ScenarioType::MusicGenerate as i32;
        assert!(project_job(job).is_err());
    }
}
