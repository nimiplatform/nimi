mod music;
use serde_json::{json, Map, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::{transport::Channel, Request};

use crate::generated::execute_local_app_scenario_request::Spec as ExecuteSpec;
use crate::generated::execute_local_app_scenario_response::Output as ExecuteOutput;
use crate::generated::local_app_voice_create_job_spec::Source as VoiceCreateSource;
use crate::generated::speech_transcription_audio_source::Source as AudioSource;
use crate::generated::stream_local_app_text_turn_event::Payload as TextTurnPayload;
use crate::generated::submit_local_app_scenario_job_request::Spec as JobSpec;
use crate::generated::voice_reference::Reference as VoiceReferenceValue;
use crate::generated::{
    CancelLocalAppScenarioJobRequest as ProtoCancelJobRequest,
    ExecuteLocalAppScenarioRequest as ProtoExecuteRequest, ExecutionInterruption,
    ExecutionInterruptionCause, ExecutionResubmitDisposition,
    GetLocalAppScenarioJobRequest as ProtoGetJobRequest,
    ImageFaceSwapScenarioSpec,
    VideoFaceSwapScenarioSpec, FaceSwapNoFacePolicy,
    ListLocalAppVoiceAssetsRequest as ProtoListVoiceAssetsRequest,
    LocalAppImageGenerateScenarioSpec, LocalAppMusicGenerateJobSpec, LocalAppScenarioArtifact,
    LocalAppScenarioJob, LocalAppScenarioJobEvent, LocalAppSpeechSynthesizeJobSpec,
    LocalAppSpeechTranscribeJobSpec, LocalAppTextEmbedScenarioSpec, LocalAppTextTurnFailed,
    LocalAppVideoGenerateJobSpec, LocalAppVideoGenerationOptions, LocalAppVoiceAsset,
    LocalAppVoiceCreateJobSpec, LocalAppWorldGenerateJobSpec,
    ReadLocalAppArtifactRequest as ProtoReadArtifactRequest, ScenarioJobEventType,
    ScenarioJobStatus, ScenarioType, SpeechTimingMode, SpeechTranscriptionAudioSource,
    SubmitLocalAppScenarioJobRequest as ProtoSubmitJobRequest,
    SubscribeLocalAppScenarioJobEventsRequest,
    UploadLocalAppArtifactRequest as ProtoUploadArtifactRequest, VideoContentArtifactRef,
    VideoContentAudioUrl, VideoContentImageUrl, VideoContentItem, VideoContentRole,
    VideoContentType, VideoContentVideoUrl, VideoMode, VisionLocateGeometry, VisionLocateResult,
    VisionLocateScenarioSpec, VoiceAssetStatus, VoiceCreationSource, VoiceReference,
    VoiceReferenceKind, VoiceRenderHints, VoiceT2vInput, VoiceV2vInput,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppScenarioCancelRequest, LocalAppScenarioExecuteRequest,
    LocalAppScenarioGetRequest, LocalAppScenarioJobSubscribeRequest,
    LocalAppScenarioListVoiceAssetsRequest, LocalAppScenarioReadArtifactRequest,
    LocalAppScenarioStreamReceiver, LocalAppScenarioSubmitRequest,
    LocalAppScenarioUploadArtifactRequest, LocalAppArtifactUploadSource, LocalAppTextTurnRequest,
};

use super::{invalid_payload, text_behavior, untrusted};

const UNARY_TIMEOUT_SECONDS: u64 = 120;
const MAX_ARTIFACT_BYTES: usize = crate::RUNTIME_MAX_INLINE_PAYLOAD_BYTES;
const MAX_ARTIFACTS: usize = 16;
const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_TRACE_BYTES: usize = 512;
const MAX_REASON_DETAIL_BYTES: usize = 1024;
const MAX_ACTION_HINT_BYTES: usize = 512;
const MAX_PROMPT_BYTES: usize = 32 * 1024;
const MAX_VIDEO_TEXT_BYTES: usize = 8 * 1024;
const MAX_URI_BYTES: usize = 2048;
const MAX_REFERENCE_AUDIO_BYTES: usize = 20 * 1024 * 1024;
const MAX_TRANSCRIPTION_TEXT_BYTES: usize = 1024 * 1024;

pub(super) async fn execute(
    channel: Channel,
    request: LocalAppScenarioExecuteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let spec = parse_execute_spec(request.spec)?;
    let mut grpc_request = Request::new(ProtoExecuteRequest { spec: Some(spec) });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = crate::grpc_limits::runtime_ai_client(channel)
        .execute_local_app_scenario(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    valid_runtime_text(&response.trace_id, MAX_TRACE_BYTES)?;
    let output = match response.output.ok_or_else(untrusted)? {
        ExecuteOutput::TextEmbed(value) => {
            valid_runtime_text(&value.space_id, MAX_IDENTIFIER_BYTES)?;
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
            json!({"type": "text-embed", "vectors": vectors, "spaceId": value.space_id})
        }
        ExecuteOutput::TextGenerate(value) => text_behavior::project_output(value)?,
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
    if !request.client_submission_id.is_empty() {
        require_submission_id(&request.client_submission_id)?;
        if !matches!(spec, JobSpec::MusicGenerate(_)) { return Err(invalid_payload()); }
    }
    let mut grpc_request = Request::new(ProtoSubmitJobRequest {
        spec: Some(spec),
        timeout_ms: request.timeout_ms,
        client_submission_id: request.client_submission_id,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = crate::grpc_limits::runtime_ai_client(channel)
        .submit_local_app_scenario_job(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"job": project_job(response.job.ok_or_else(untrusted)?)?}))
}

pub(super) async fn get_job(
    channel: Channel,
    request: LocalAppScenarioGetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    if request.client_submission_id.is_empty() {
        require_identifier(&request.job_id)?;
    } else {
        require_submission_id(&request.client_submission_id)?;
        if !request.job_id.is_empty() { return Err(invalid_payload()); }
    }
    let mut grpc_request = Request::new(ProtoGetJobRequest {
        job_id: request.job_id,
        client_submission_id: request.client_submission_id,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = crate::grpc_limits::runtime_ai_client(channel)
        .get_local_app_scenario_job(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let job = response.job.ok_or_else(untrusted)?;
    validate_voice_job_result(
        &job,
        response.asset.as_ref(),
        response.voice_reference.as_ref(),
    )?;
    let expects_locate = job.scenario_type == ScenarioType::VisionLocate as i32
        && job.status == ScenarioJobStatus::Completed as i32;
    if expects_locate != response.vision_locate.is_some()
        || (expects_locate && !job.artifacts.is_empty())
    {
        return Err(untrusted());
    }
    let mut result = json!({
        "job": project_job(job)?,
        "asset": response.asset.map(project_voice_asset).transpose()?,
        "voiceReference": response.voice_reference.map(project_voice_asset_reference).transpose()?,
    });
    if let Some(vision) = response.vision_locate {
        result
            .as_object_mut()
            .ok_or_else(untrusted)?
            .insert("visionLocate".to_string(), project_vision_locate(vision)?);
    }
    Ok(result)
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
    let response = crate::grpc_limits::runtime_ai_client(channel)
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
    let mut stream = crate::grpc_limits::runtime_ai_client(channel)
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
    request: LocalAppTextTurnRequest,
) -> Result<LocalAppScenarioStreamReceiver, LocalAppOperationError> {
    let request = text_behavior::request(request)?;
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        let mut client = crate::grpc_limits::runtime_ai_client(channel);
        let opened = tokio::select! {
            _ = sender.closed() => return,
            opened = client.stream_local_app_text_turn(request) => opened,
        };
        let mut stream = match opened {
            Ok(response) => response.into_inner(),
            Err(status) => {
                let _ = sender.send(Err(local_app_error_from_status(status))).await;
                return;
            }
        };
        let mut expected_sequence = 1u64;
        let mut total_delta_bytes = 0usize;
        loop {
            let next = tokio::select! {
                _ = sender.closed() => break,
                next = stream.message() => next,
            };
            match next {
                Ok(Some(event)) => {
                    let projected =
                        project_text_turn_event(event, expected_sequence, &mut total_delta_bytes);
                    let terminal = projected.as_ref().map(|value| matches!(value.get("type").and_then(JsonValue::as_str), Some("completed" | "failed"))).unwrap_or(true);
                    if projected.is_ok() {
                        expected_sequence += 1;
                    }
                    if sender.send(projected).await.is_err() || terminal {
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
    let response = crate::grpc_limits::runtime_ai_client(channel)
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
    if request.bytes.is_empty() == request.source.is_none()
        || request.bytes.len() > MAX_ARTIFACT_BYTES
        || !valid_upload_mime(&request.mime_type)
    {
        return Err(invalid_payload());
    }
    if request.mime_type == "text/vnd.abc" && (request.bytes.is_empty() || request.bytes.len() > 1048576 || request.source.is_some() || request.audio_preparation.is_some()) { return Err(invalid_payload()); }
    let expected_size = request.bytes.len();
    let expected_mime = request.mime_type.clone();
    let canonical = request.audio_preparation.is_some();
    if (request.source.is_some() || expected_mime == "audio/flac") && !canonical {
        return Err(invalid_payload());
    }
    let mut target_rate = 0;
    let preparation = match request.audio_preparation {
        Some(value) => {
            if value.profile != "canonical-pcm-v1"
                || !matches!(expected_mime.as_str(), "audio/wav" | "audio/mpeg" | "audio/flac")
                || value.target_sample_rate_hz.is_some_and(|rate| !(8000..=96000).contains(&rate) || expected_mime != "audio/wav")
            {
                return Err(invalid_payload());
            }
            target_rate = value.target_sample_rate_hz.unwrap_or(0);
            Some(crate::generated::LocalAppCanonicalAudioPreparation {
                target_sample_rate_hz: target_rate,
            })
        }
        None => None,
    };
    let (app_asset_relative_path, source_artifact_id) = match request.source {
        Some(LocalAppArtifactUploadSource::AppAsset { relative_path }) => {
            if relative_path.is_empty() || relative_path.len() > 4096 || relative_path.contains('\0') {
                return Err(invalid_payload());
            }
            (relative_path, String::new())
        }
        Some(LocalAppArtifactUploadSource::Artifact { artifact_id }) => {
            require_identifier(&artifact_id).map_err(|_| invalid_payload())?;
            if expected_mime != "audio/wav" {
                return Err(invalid_payload());
            }
            (String::new(), artifact_id)
        }
        None => (String::new(), String::new()),
    };
    let mut grpc_request = Request::new(ProtoUploadArtifactRequest {
        bytes: request.bytes,
        mime_type: request.mime_type,
        app_asset_relative_path,
        source_artifact_id,
        audio_preparation: preparation,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(UNARY_TIMEOUT_SECONDS));
    let response = crate::grpc_limits::runtime_ai_client(channel)
        .upload_local_app_artifact(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_identifier(&response.artifact_id).map_err(|_| untrusted())?;
    let mut projected = json!({
        "artifactId": response.artifact_id,
        "sizeBytes": response.size_bytes,
        "mimeType": response.mime_type,
    });
    if canonical {
        if response.expires_at.is_none() { return Err(untrusted()); }
        projected["expiresAt"] = project_timestamp(response.expires_at)?;
        let info = response.audio_info.ok_or_else(untrusted)?;
        if response.mime_type != "audio/wav"
            || !(1..=512 * 1024 * 1024).contains(&response.size_bytes)
            || !(8000..=96000).contains(&info.sample_rate_hz)
            || !(1..=2).contains(&info.channels)
            || info.frame_count == 0
            || info.frame_count > u64::from(info.sample_rate_hz) * 600
            || info.duration_ms != (info.frame_count * 1000 / u64::from(info.sample_rate_hz)) as i64
            || response.size_bytes < (info.frame_count * u64::from(info.channels) * 4 + 44) as i64
            || (target_rate != 0 && target_rate != info.sample_rate_hz)
        {
            return Err(untrusted());
        }
        projected["audioInfo"] = json!({"sampleRateHz": info.sample_rate_hz, "channels": info.channels,
            "frameCount": info.frame_count, "durationMs": info.duration_ms});
    } else if expected_mime == "text/vnd.abc" {
        if response.size_bytes != expected_size as i64 || response.mime_type != expected_mime || response.audio_info.is_some() || response.expires_at.is_none() { return Err(untrusted()); }
        projected["expiresAt"] = project_timestamp(response.expires_at)?;
    } else if response.size_bytes != expected_size as i64
        || response.mime_type != expected_mime || response.audio_info.is_some() || response.expires_at.is_some()
    {
        return Err(untrusted());
    }
    Ok(projected)
}

fn require_submission_id(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|ch| ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_') {
        return Err(invalid_payload());
    }
    Ok(())
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
    let response = crate::grpc_limits::runtime_ai_client(channel)
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
    let mut object = exact_object(value)?;
    let kind = string_field(&object, "type")?.to_string();
    match kind.as_str() {
        "text-generate" => {
            object.remove("type");
            let input: LocalAppTextTurnRequest = serde_json::from_value(JsonValue::Object(object)).map_err(|_| invalid_payload())?;
            Ok(ExecuteSpec::TextGenerate(text_behavior::request(input)?))
        }
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
        "text-annotate" => {
            exact_keys(&object, &["type", "language", "texts"])?;
            let language = string_field(&object, "language")?;
            if !(2..=16).contains(&language.len()) || !language.bytes().all(|c| c.is_ascii_lowercase() || c == b'-') {
                return Err(invalid_payload());
            }
            let values = field(&object, "texts")?.as_array().ok_or_else(invalid_payload)?;
            if values.is_empty() || values.len() > 64 { return Err(invalid_payload()); }
            let texts: Vec<String> = values.iter().map(|v| v.as_str().map(String::from).ok_or_else(invalid_payload)).collect::<Result<_, _>>()?;
            if texts.iter().map(String::len).sum::<usize>() > 524288 { return Err(invalid_payload()); }
            Ok(JobSpec::TextAnnotate(crate::generated::TextAnnotateScenarioSpec { language: language.into(), texts }))
        }
        "video-face-swap" => {
            exact_keys(&object, &["type", "referenceImageArtifactId", "targetVideoArtifactId", "noFacePolicy"])?;
            let reference_image_artifact_id = required_text_field(&object, "referenceImageArtifactId", MAX_IDENTIFIER_BYTES)?;
            let target_video_artifact_id = required_text_field(&object, "targetVideoArtifactId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&reference_image_artifact_id)?;
            require_identifier(&target_video_artifact_id)?;
            let no_face_policy = match string_field(&object, "noFacePolicy")? {
                "fail" => FaceSwapNoFacePolicy::Fail,
                "preserve-frame" => FaceSwapNoFacePolicy::PreserveFrame,
                _ => return Err(invalid_payload()),
            };
            Ok(JobSpec::VideoFaceSwap(VideoFaceSwapScenarioSpec { reference_image_artifact_id, target_video_artifact_id, no_face_policy: no_face_policy as i32 }))
        }
        "image-face-swap" => {
            exact_keys(&object, &["type", "referenceImageArtifactId", "targetImageArtifactId"])?;
            let reference_image_artifact_id = required_text_field(&object, "referenceImageArtifactId", MAX_IDENTIFIER_BYTES)?;
            let target_image_artifact_id = required_text_field(&object, "targetImageArtifactId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&reference_image_artifact_id)?;
            require_identifier(&target_image_artifact_id)?;
            Ok(JobSpec::ImageFaceSwap(ImageFaceSwapScenarioSpec { reference_image_artifact_id, target_image_artifact_id }))
        }
        "image-generate" => Ok(JobSpec::ImageGenerate(parse_image_spec(&object)?)),
        "vision-locate" => {
            exact_keys(&object, &["type", "imageArtifactId", "query", "geometry"])?;
            let image_artifact_id =
                required_text_field(&object, "imageArtifactId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&image_artifact_id)?;
            let geometry = match string_field(&object, "geometry")? {
                "box" => VisionLocateGeometry::Box,
                "point" => VisionLocateGeometry::Point,
                _ => return Err(invalid_payload()),
            };
            Ok(JobSpec::VisionLocate(VisionLocateScenarioSpec {
                image_artifact_id,
                query: required_text_field(&object, "query", 8 * 1024)?,
                geometry: geometry as i32,
            }))
        }
        "video-generate" => Ok(JobSpec::VideoGenerate(parse_video_spec(&object)?)),
        "speech-synthesize" => Ok(JobSpec::SpeechSynthesize(parse_speech_synthesize_spec(
            &object,
        )?)),
        "speech-transcribe" => Ok(JobSpec::SpeechTranscribe(parse_speech_transcribe_spec(
            &object,
        )?)),
        "audio-separate" => {
            exact_keys(&object, &["type", "mimeType", "audioSource"])?;
            let mut audio_input = object.clone();
            for key in ["language", "prompt", "responseFormat"] {
                audio_input.insert(key.into(), JsonValue::String(String::new()));
            }
            let audio = parse_speech_transcribe_spec(&audio_input)?;
            Ok(JobSpec::AudioSeparate(crate::generated::AudioSeparateScenarioSpec {
                mime_type: audio.mime_type, audio_source: audio.audio_source,
            }))
        }
        "voice-create" => Ok(JobSpec::VoiceCreate(parse_voice_create_spec(&object)?)),
        "music-generate" => Ok(JobSpec::MusicGenerate(music::parse(&object)?)),
        "world-generate" => {
            exact_keys(&object, &["type", "prompt", "displayName"])?;
            Ok(JobSpec::WorldGenerate(LocalAppWorldGenerateJobSpec {
                prompt: required_text_field(&object, "prompt", MAX_PROMPT_BYTES)?,
                display_name: optional_text_field(&object, "displayName", 256)?,
            }))
        }
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
            "referenceImageArtifactId",
            "mask",
            "maskArtifactId",
            "strength",
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
            "referenceImageArtifactId",
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
    let reference_image_artifact_id =
        optional_text_field(object, "referenceImageArtifactId", MAX_IDENTIFIER_BYTES)?;
    if !reference_images.is_empty() && !reference_image_artifact_id.is_empty() {
        return Err(invalid_payload());
    }
    let mask = optional_text_field(object, "mask", MAX_URI_BYTES)?;
    let mask_artifact_id =
        optional_present_text_field(object, "maskArtifactId", MAX_IDENTIFIER_BYTES)?;
    let strength = optional_float_field(object, "strength", f32::MIN, f32::MAX)?;
    if (!mask.is_empty() && !mask_artifact_id.is_empty())
        || (!mask_artifact_id.is_empty() && reference_image_artifact_id.is_empty())
        || (strength.is_some() && reference_image_artifact_id.is_empty())
    {
        return Err(invalid_payload());
    }
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
        reference_image_artifact_id,
        mask,
        mask_artifact_id,
        strength,
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
        || seed.is_some_and(|value| !(-1..=4_294_967_295).contains(&value))
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

fn parse_voice_create_spec(
    object: &Map<String, JsonValue>,
) -> Result<LocalAppVoiceCreateJobSpec, LocalAppOperationError> {
    let source = match string_field(object, "creationSource")? {
        "reference-audio" => {
            VoiceCreateSource::ReferenceAudio(parse_voice_reference_audio_source(object)?)
        }
        "text-description" => {
            VoiceCreateSource::TextDescription(parse_voice_text_description_source(object)?)
        }
        _ => return Err(invalid_payload()),
    };
    Ok(LocalAppVoiceCreateJobSpec {
        source: Some(source),
    })
}

fn parse_voice_reference_audio_source(
    object: &Map<String, JsonValue>,
) -> Result<VoiceV2vInput, LocalAppOperationError> {
    exact_keys(
        object,
        &[
            "type",
            "creationSource",
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
    Ok(VoiceV2vInput {
        reference_audio_bytes,
        reference_audio_uri,
        reference_audio_mime,
        language_hints: string_array(field(object, "languageHints")?, 8, 64, false)?,
        preferred_name: bounded_token_field(object, "preferredName", 256)?,
        text: optional_text_field(object, "text", MAX_PROMPT_BYTES)?,
    })
}

fn parse_voice_text_description_source(
    object: &Map<String, JsonValue>,
) -> Result<VoiceT2vInput, LocalAppOperationError> {
    exact_keys(
        object,
        &[
            "type",
            "creationSource",
            "instructionText",
            "previewText",
            "language",
            "preferredName",
        ],
    )?;
    Ok(VoiceT2vInput {
        instruction_text: required_text_field(object, "instructionText", 8 * 1024)?,
        preview_text: optional_text_field(object, "previewText", 8 * 1024)?,
        language: bounded_token_field(object, "language", 64)?,
        preferred_name: bounded_token_field(object, "preferredName", 256)?,
    })
}

fn project_job(job: LocalAppScenarioJob) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&job.job_id)?;
    let scenario_type = match ScenarioType::try_from(job.scenario_type).map_err(|_| untrusted())? {
        ScenarioType::ImageGenerate => "image-generate",
        ScenarioType::ImageFaceSwap => "image-face-swap",
        ScenarioType::VideoFaceSwap => "video-face-swap",
        ScenarioType::VisionLocate => "vision-locate",
        ScenarioType::VideoGenerate => "video-generate",
        ScenarioType::SpeechSynthesize => "speech-synthesize",
        ScenarioType::SpeechTranscribe => "speech-transcribe",
        ScenarioType::AudioSeparate => "audio-separate",
        ScenarioType::TextAnnotate => "text-annotate",
        ScenarioType::VoiceCreate => "voice-create",
        ScenarioType::MusicGenerate => "music-generate",
        ScenarioType::WorldGenerate => "world-generate",
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
    let interruption = project_execution_interruption(job.interruption)?;
    if (reason_code == "ai-execution-interrupted") != !interruption.is_null()
        || (!interruption.is_null() && status != "failed")
    {
        return Err(untrusted());
    }
    let transcription = if let Some(value) = &job.transcription {
        if scenario_type != "speech-transcribe"
            || status != "completed"
            || value.text != job.transcription_text
        {
            return Err(untrusted());
        }
        Some(project_transcription(value)?)
    } else {
        None
    };
    let text_annotation = if scenario_type == "text-annotate" && status == "completed" {
        Some(project_text_annotation(job.text_annotation.as_ref().ok_or_else(untrusted)?)?)
    } else {
        if job.text_annotation.is_some() { return Err(untrusted()); }
        None
    };
    let audio_separation = if scenario_type == "audio-separate" && status == "completed" {
        Some(project_audio_separation(job.audio_separation.as_ref().ok_or_else(untrusted)?, &job.artifacts)?)
    } else {
        if job.audio_separation.is_some() { return Err(untrusted()); }
        None
    };
    let music_generation = if scenario_type == "music-generate" && status == "completed" {
        Some(music::project(job.music_generation.as_ref().ok_or_else(untrusted)?, &job.artifacts)?)
    } else {
        if job.music_generation.is_some() { return Err(untrusted()); }
        None
    };
    let mut projected = json!({
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
    });
    if let Some(value) = transcription {
        projected
            .as_object_mut()
            .ok_or_else(untrusted)?
            .insert("transcription".to_string(), value);
    }
    if let Some(value) = text_annotation {
        projected.as_object_mut().ok_or_else(untrusted)?.insert("textAnnotation".into(), value);
    }
    if let Some(value) = music_generation { projected["musicGeneration"] = value; }
    if let Some(value) = audio_separation {
        projected.as_object_mut().ok_or_else(untrusted)?.insert("audioSeparation".into(), value);
    }
    if job.recovery_expires_at.is_some() {
        if scenario_type != "music-generate" || !matches!(status, "completed" | "failed" | "canceled" | "timeout") { return Err(untrusted()); }
        projected["recoveryExpiresAt"] = project_timestamp(job.recovery_expires_at)?;
    }
    if job.video_face_swap_summary.is_some() != (scenario_type == "video-face-swap" && status == "completed") { return Err(untrusted()); }
    if let Some(summary) = job.video_face_swap_summary {
        if summary.total_frames == 0 || summary.total_frames > 9000 || summary.transformed_frames > summary.total_frames || summary.preserved_frames > summary.total_frames || summary.transformed_frames + summary.preserved_frames != summary.total_frames || summary.duration_us == 0 || summary.duration_us > 300000000 || ![24, 25, 30].contains(&summary.frame_rate) { return Err(untrusted()); }
        projected.as_object_mut().ok_or_else(untrusted)?.insert("videoFaceSwapSummary".to_string(), json!({
            "totalFrames": summary.total_frames, "transformedFrames": summary.transformed_frames,
            "preservedFrames": summary.preserved_frames, "durationUs": summary.duration_us,
            "frameRate": summary.frame_rate, "audioPreserved": summary.audio_preserved,
        }));
    }
    if !interruption.is_null() {
        projected
            .as_object_mut()
            .ok_or_else(untrusted)?
            .insert("interruption".to_string(), interruption);
    }
    Ok(projected)
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
fn project_vision_locate(result: VisionLocateResult) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&result.image_artifact_id)?;
    if result.width == 0 || result.height == 0 || prost::Message::encoded_len(&result) > 256 * 1024
    {
        return Err(untrusted());
    }
    let mut locations = Vec::with_capacity(result.locations.len());
    for location in result.locations {
        let mut value = match location.geometry.ok_or_else(untrusted)? {
            crate::generated::vision_location::Geometry::Box(b) => {
                if ![b.x1, b.y1, b.x2, b.y2]
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
                    || b.x1 >= b.x2
                    || b.y1 >= b.y2
                {
                    return Err(untrusted());
                }
                json!({"type":"box", "x1":b.x1, "y1":b.y1, "x2":b.x2, "y2":b.y2})
            }
            crate::generated::vision_location::Geometry::Point(p) => {
                if ![p.x, p.y]
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
                {
                    return Err(untrusted());
                }
                json!({"type":"point", "x":p.x, "y":p.y})
            }
        };
        if let Some(label) = location.label {
            value
                .as_object_mut()
                .ok_or_else(untrusted)?
                .insert("label".to_string(), json!(label));
        }
        locations.push(value);
    }
    let projected = json!({"imageArtifactId":result.image_artifact_id, "width":result.width, "height":result.height, "locations":locations});
    Ok(projected)
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
                || (artifact.frame_count > 0 && (!artifact.mime_type.starts_with("audio/") || artifact.sample_rate_hz <= 0 || artifact.channels <= 0 || artifact.frame_count > 9_007_199_254_740_991))
                || artifact.sha256.len() > 128
                || artifact.sha256.trim() != artifact.sha256
                || (artifact.seed.is_some() && !artifact.mime_type.starts_with("image/"))
                || (!artifact.bytes.is_empty()
                    && artifact.size_bytes as usize != artifact.bytes.len())
            {
                return Err(untrusted());
            }
            let mut projected = json!({
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
            });
            if let Some(seed) = artifact.seed {
                projected
                    .as_object_mut()
                    .ok_or_else(untrusted)?
                    .insert("seed".to_string(), json!(seed));
            }
            if artifact.frame_count > 0 {
                projected["frameCount"] = json!(artifact.frame_count);
            }
            Ok(projected)
        })
        .collect()
}

fn project_voice_asset(asset: LocalAppVoiceAsset) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&asset.voice_asset_id)?;
    let creation_source =
        match VoiceCreationSource::try_from(asset.creation_source).map_err(|_| untrusted())? {
            VoiceCreationSource::ReferenceAudio => "reference-audio",
            VoiceCreationSource::TextDescription => "text-description",
            VoiceCreationSource::Unspecified => return Err(untrusted()),
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
        "creationSource": creation_source,
        "status": status,
        "createdAt": project_timestamp(asset.created_at)?,
        "updatedAt": project_timestamp(asset.updated_at)?,
        "expiresAt": project_timestamp(asset.expires_at)?,
    }))
}

fn project_voice_asset_reference(
    reference: VoiceReference,
) -> Result<JsonValue, LocalAppOperationError> {
    if VoiceReferenceKind::try_from(reference.kind).map_err(|_| untrusted())?
        != VoiceReferenceKind::VoiceAsset
    {
        return Err(untrusted());
    }
    let voice_asset_id = match reference.reference.ok_or_else(untrusted)? {
        VoiceReferenceValue::VoiceAssetId(value) => value,
        _ => return Err(untrusted()),
    };
    require_runtime_identifier(&voice_asset_id)?;
    Ok(json!({
        "kind": "voice_asset_id",
        "voiceAssetId": voice_asset_id,
    }))
}

fn validate_voice_asset_reference_pair(
    asset: Option<&LocalAppVoiceAsset>,
    reference: Option<&VoiceReference>,
) -> Result<(), LocalAppOperationError> {
    match (asset, reference) {
        (None, None) => Ok(()),
        (Some(asset), Some(reference)) => {
            if VoiceReferenceKind::try_from(reference.kind).map_err(|_| untrusted())?
                != VoiceReferenceKind::VoiceAsset
            {
                return Err(untrusted());
            }
            match reference.reference.as_ref() {
                Some(VoiceReferenceValue::VoiceAssetId(value))
                    if value == &asset.voice_asset_id =>
                {
                    Ok(())
                }
                _ => Err(untrusted()),
            }
        }
        _ => Err(untrusted()),
    }
}

fn validate_voice_job_result(
    job: &LocalAppScenarioJob,
    asset: Option<&LocalAppVoiceAsset>,
    reference: Option<&VoiceReference>,
) -> Result<(), LocalAppOperationError> {
    validate_voice_asset_reference_pair(asset, reference)?;
    if asset.is_some_and(|value| value.status != VoiceAssetStatus::Active as i32) {
        return Err(untrusted());
    }
    let completed_voice = job.scenario_type == ScenarioType::VoiceCreate as i32
        && job.status == ScenarioJobStatus::Completed as i32;
    if completed_voice != asset.is_some() {
        return Err(untrusted());
    }
    Ok(())
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
                json!({"type": "delta", "sequence": event.sequence.to_string(), "traceId": event.trace_id, "text": value.text, "itemIndex": value.item_index}),
            )
        }
        TextTurnPayload::ToolCall(value) => {
            let call = value.tool_call.ok_or_else(untrusted)?;
            let bytes = prost::Message::encoded_len(&call);
            let call = text_behavior::project_tool_call(call)?;
            *total_delta_bytes = total_delta_bytes.checked_add(bytes).filter(|total| *total <= 256 * 1024).ok_or_else(untrusted)?;
            Ok(json!({"type": "tool-call", "sequence": event.sequence.to_string(), "traceId": event.trace_id, "itemIndex": value.item_index, "toolCall": call}))
        }
        TextTurnPayload::ReasoningContinuity(value) => {
            let carrier = value.carrier.ok_or_else(untrusted)?;
            let bytes = prost::Message::encoded_len(&carrier);
            let carrier = text_behavior::project_continuity(carrier)?;
            *total_delta_bytes = total_delta_bytes.checked_add(bytes).filter(|total| *total <= 256 * 1024).ok_or_else(untrusted)?;
            Ok(json!({"type": "reasoning-continuity", "sequence": event.sequence.to_string(), "traceId": event.trace_id, "itemIndex": value.item_index, "carrier": carrier}))
        }
        TextTurnPayload::Completed(value) => {
            let finish_reason = text_behavior::finish_reason(value.finish_reason)?;
            Ok(
                json!({"type": "completed", "sequence": event.sequence.to_string(), "traceId": event.trace_id, "finishReason": finish_reason}),
            )
        }
        TextTurnPayload::Failed(LocalAppTextTurnFailed {
            reason_code,
            action_hint,
            interruption,
        }) => {
            let reason =
                crate::generated::ReasonCode::try_from(reason_code).map_err(|_| untrusted())?;
            if reason == crate::generated::ReasonCode::Unspecified {
                return Err(untrusted());
            }
            valid_optional_runtime_text(&action_hint, MAX_ACTION_HINT_BYTES)?;
            let interruption = project_execution_interruption(interruption)?;
            if (reason == crate::generated::ReasonCode::AiExecutionInterrupted)
                != !interruption.is_null()
            {
                return Err(untrusted());
            }
            Ok(
                json!({"type": "failed", "sequence": event.sequence.to_string(), "traceId": event.trace_id,
                "reasonCode": enum_token(reason.as_str_name(), "REASON_CODE_"), "actionHint": action_hint,
                "interruption": interruption}),
            )
        }
    }
}

fn project_execution_interruption(
    value: Option<ExecutionInterruption>,
) -> Result<JsonValue, LocalAppOperationError> {
    let Some(value) = value else {
        return Ok(JsonValue::Null);
    };
    let cause = ExecutionInterruptionCause::try_from(value.cause).map_err(|_| untrusted())?;
    let disposition = ExecutionResubmitDisposition::try_from(value.resubmit_disposition)
        .map_err(|_| untrusted())?;
    if cause != ExecutionInterruptionCause::RuntimeRestart
        || disposition != ExecutionResubmitDisposition::CallerMayResubmit
    {
        return Err(untrusted());
    }
    Ok(json!({"cause": "runtime-restart", "resubmitDisposition": "caller-may-resubmit"}))
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

fn optional_present_text_field(
    object: &Map<String, JsonValue>,
    key: &str,
    maximum: usize,
) -> Result<String, LocalAppOperationError> {
    object
        .get(key)
        .map(|_| optional_text_field(object, key, maximum))
        .transpose()
        .map(|value| value.unwrap_or_default())
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

fn valid_upload_mime(value: &str) -> bool {
    matches!(
        value,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "audio/wav" | "audio/mpeg" | "audio/flac" | "video/mp4" | "text/vnd.abc"
    )
}

fn valid_page_token(value: &str) -> bool {
    value.len() <= 10 && value.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_audio_source_is_a_closed_owned_reference() {
        let parsed: crate::LocalAppArtifactUploadSource = serde_json::from_value(json!({
            "kind": "app-asset", "relativePath": "sources/原曲.mp3"
        })).unwrap();
        assert!(matches!(parsed, crate::LocalAppArtifactUploadSource::AppAsset { relative_path } if relative_path == "sources/原曲.mp3"));
        for value in [
            json!({"kind": "host-path", "path": "C:/private.wav"}),
            json!({"kind": "artifact", "artifactId": "a", "accountId": "another-owner"}),
            json!({"kind": "app-asset", "relativePath": "a.wav", "modelId": "override"}),
        ] {
            assert!(serde_json::from_value::<crate::LocalAppArtifactUploadSource>(value).is_err());
        }
        assert!(serde_json::from_value::<crate::LocalAppCanonicalAudioPreparation>(json!({
            "profile": "canonical-pcm-v1", "targetSampleRateHz": 48000, "decoderPath": "private"
        })).is_err());
    }

    #[tokio::test]
    async fn invalid_audio_preparation_is_rejected_before_transport() {
        let channel = Channel::from_static("http://127.0.0.1:9").connect_lazy();
        for (bytes, preparation) in [
            (vec![1], Some(crate::LocalAppCanonicalAudioPreparation { profile: "canonical-pcm-v1".into(), target_sample_rate_hz: None })),
            (vec![], None),
            (vec![], Some(crate::LocalAppCanonicalAudioPreparation { profile: "other".into(), target_sample_rate_hz: None })),
        ] {
            let error = upload_artifact(channel.clone(), LocalAppScenarioUploadArtifactRequest {
                bytes, mime_type: "audio/wav".into(),
                source: Some(crate::LocalAppArtifactUploadSource::Artifact { artifact_id: "source-1".into() }),
                audio_preparation: preparation,
            }).await.unwrap_err();
            assert_eq!(error.reason_code(), invalid_payload().reason_code());
        }
    }

    #[test]
    fn text_stream_budget_counts_content_before_json_expansion() {
        use crate::generated::{LocalAppTextTurnContinuity, LocalAppTextTurnDelta, LocalAppTextTurnToolCall, ReasoningContinuityCarrier, StreamLocalAppTextTurnEvent, ToolCall};
        let carrier = ReasoningContinuityCarrier {
            kind: "openai_codex.responses.encrypted-reasoning".into(), version: 1,
            payload: serde_json::to_vec(&json!({
                "type": "reasoning", "id": "rs_budget", "encrypted_content": "A".repeat(60 * 1024), "summary": []
            })).unwrap(),
        };
        let call = ToolCall {
            id: "call-budget".into(), name: "search".into(),
            arguments_json: format!("{{\"values\":[{}]}}", vec!["1e20"; 16 * 1024].join(",")),
            ..Default::default()
        };
        let mut total_bytes = 0;
        let mut sequence = 0;
        let mut send = |payload| {
            sequence += 1;
            project_text_turn_event(StreamLocalAppTextTurnEvent {
                sequence, trace_id: "trace-budget".into(), payload: Some(payload),
            }, sequence, &mut total_bytes)
        };
        send(TextTurnPayload::ReasoningContinuity(LocalAppTextTurnContinuity { item_index: 0, carrier: Some(carrier.clone()) })).unwrap();
        send(TextTurnPayload::ToolCall(LocalAppTextTurnToolCall { item_index: 1, tool_call: Some(call.clone()) })).unwrap();
        let remaining = 256 * 1024 - prost::Message::encoded_len(&carrier) - prost::Message::encoded_len(&call);
        let mut sent = 0;
        while sent < remaining {
            let bytes = (remaining - sent).min(50 * 1024);
            send(TextTurnPayload::Delta(LocalAppTextTurnDelta { item_index: 2, text: "x".repeat(bytes) })).unwrap();
            sent += bytes;
        }
        assert!(send(TextTurnPayload::Delta(LocalAppTextTurnDelta { item_index: 2, text: "x".into() })).is_err());
    }

    #[test]
    fn t2v_reference_audio_preserves_the_existing_carrier() {
        let JobSpec::VideoGenerate(spec) = parse_job_spec(json!({
            "type": "video-generate", "mode": "t2v", "prompt": "A harbor.", "negativePrompt": "",
            "content": [{ "type": "audio-url", "role": "reference-audio", "url": "https://media.example.test/reference.mp3" }],
            "options": { "resolution": "720p", "ratio": "16:9", "durationSec": 4 }
        })).expect("T2V reference audio") else {
            panic!("expected the existing video Job spec");
        };
        assert_eq!(spec.mode, VideoMode::T2v as i32);
        assert_eq!(spec.content.len(), 1);
        assert_eq!(spec.content[0].role, VideoContentRole::ReferenceAudio as i32);
        assert_eq!(spec.content[0].audio_url.as_ref().unwrap().url, "https://media.example.test/reference.mp3");
    }

    #[test]
    fn local_upload_audio_mime_set_is_closed() {
        assert!(valid_upload_mime("audio/wav"));
        assert!(valid_upload_mime("audio/mpeg"));
        assert!(!valid_upload_mime("audio/ogg"));
        assert!(!valid_upload_mime("application/octet-stream"));
    }

    #[test]
    fn face_replacement_job_has_two_owned_references_and_no_sync_alias() {
        let input = json!({
            "type": "image-face-swap",
            "referenceImageArtifactId": "reference-1",
            "targetImageArtifactId": "target-1"
        });
        match parse_job_spec(input.clone()).unwrap() {
            JobSpec::ImageFaceSwap(spec) => {
                assert_eq!(spec.reference_image_artifact_id, "reference-1");
                assert_eq!(spec.target_image_artifact_id, "target-1");
            }
            _ => panic!("wrong face replacement wire spec"),
        }
        assert!(parse_execute_spec(input.clone()).is_err());
        let mut expanded = input.clone();
        expanded["provider"] = json!("local");
        assert!(parse_job_spec(expanded).is_err());
        let mut missing = input;
        missing["targetImageArtifactId"] = json!("");
        assert!(parse_job_spec(missing).is_err());
    }

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
            "referenceImageArtifactId": "",
            "mask": "https://example.com/mask.png", "responseFormat": "b64_json"
        });
        assert!(parse_job_spec(image.clone()).is_ok());
        let artifact_image = json!({
            "type": "image-generate", "prompt": "edit portrait", "negativePrompt": "",
            "size": "1024x1024", "aspectRatio": "", "quality": "", "style": "",
            "referenceImages": [], "referenceImageArtifactId": "artifact-image-source-1",
            "mask": "", "responseFormat": ""
        });
        assert!(parse_job_spec(artifact_image).is_ok());
        let inpaint_contract = json!({
            "type": "image-generate", "prompt": "inpaint portrait", "negativePrompt": "",
            "size": "1024x1024", "aspectRatio": "", "quality": "", "style": "",
            "referenceImages": [], "referenceImageArtifactId": "artifact-image-source-1",
            "mask": "", "maskArtifactId": "artifact-image-mask-1", "strength": 0.6,
            "responseFormat": ""
        });
        assert!(parse_job_spec(inpaint_contract).is_ok());
        let mut conflicting = image.as_object().unwrap().clone();
        conflicting.insert(
            "referenceImageArtifactId".to_string(),
            json!("artifact-image-source-1"),
        );
        assert!(parse_job_spec(JsonValue::Object(conflicting)).is_err());
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
            "referenceImages": [], "referenceImageArtifactId": "", "mask": "", "responseFormat": ""
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
            "referenceImages": [], "referenceImageArtifactId": "", "mask": "", "responseFormat": ""
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
    fn video_seed_uses_the_canonical_unsigned_32_bit_range_with_random_sentinel() {
        let video = |seed| {
            json!({
                "type": "video-generate", "prompt": "draw a moon", "negativePrompt": "",
                "mode": "t2v", "content": [],
                "options": { "resolution": "720p", "ratio": "16:9", "seed": seed }
            })
        };

        assert!(parse_job_spec(video(-1)).is_ok());
        assert!(parse_job_spec(video(4_294_967_295_i64)).is_ok());
        assert!(parse_job_spec(video(4_294_967_296_i64)).is_err());
    }

    #[test]
    fn upload_artifact_mime_is_a_closed_image_set() {
        for mime in ["image/png", "image/jpeg", "image/webp", "image/gif"] {
            assert!(valid_upload_mime(mime));
        }
        assert!(valid_upload_mime("video/mp4"));
        assert!(!valid_upload_mime("video/webm"));
        assert!(!valid_upload_mime(" IMAGE/PNG "));
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
    fn image_artifact_projection_preserves_only_the_typed_seed() {
        let artifact = LocalAppScenarioArtifact {
            artifact_id: "artifact-seeded".to_string(),
            mime_type: "image/png".to_string(),
            size_bytes: 1,
            seed: Some(41),
            ..Default::default()
        };
        let projected = project_artifacts(vec![artifact]).expect("project image seed");
        assert_eq!(projected[0].get("seed"), Some(&json!(41)));

        let non_image = LocalAppScenarioArtifact {
            artifact_id: "artifact-audio".to_string(),
            mime_type: "audio/wav".to_string(),
            size_bytes: 1,
            seed: Some(41),
            ..Default::default()
        };
        assert!(project_artifacts(vec![non_image]).is_err());
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
        assert!(project_job(job.clone()).is_ok());
        job.scenario_type = ScenarioType::WorldGenerate as i32;
        assert!(project_job(job).is_ok());

        assert!(parse_job_spec(json!({
            "type": "world-generate", "prompt": "a botanical conservatory", "displayName": "Garden"
        }))
        .is_ok());
        assert!(parse_job_spec(json!({
            "type": "world-generate", "prompt": "a botanical conservatory", "displayName": "Garden", "provider": "forbidden"
        })).is_err());

        assert!(parse_job_spec(json!({
            "type": "music-generate",
            "prompt": "bright synth-pop",
            "lyrics": "[Verse]\nCity lights are waking."
        }))
        .is_ok());
        assert!(parse_job_spec(json!({
            "type": "music-generate",
            "prompt": "bright synth-pop",
            "lyrics": "[Verse]\nCity lights are waking.",
            "model": "forbidden"
        }))
        .is_err());
    }

    #[test]
    fn music_duration_is_optional_bounded_and_preserved_in_the_typed_request() {
        for duration in [None, Some(1), Some(120), Some(600)] {
            let mut input = json!({
                "type": "music-generate", "prompt": "bright synth-pop", "lyrics": "City lights"
            });
            if let Some(seconds) = duration {
                input["durationSeconds"] = json!(seconds);
            }
            let JobSpec::MusicGenerate(spec) = parse_job_spec(input).expect("valid music input") else {
                panic!("expected music spec");
            };
            assert_eq!(spec.duration_seconds, duration.unwrap_or(0));
        }
        for duration in [json!(0), json!(-1), json!(601), json!(1.5), json!(null)] {
            assert!(parse_job_spec(json!({
                "type": "music-generate", "prompt": "bright synth-pop", "lyrics": "City lights",
                "durationSeconds": duration
            }))
            .is_err());
        }
    }

    #[test]
    fn interrupted_job_keeps_typed_cause_with_the_public_reason_token() {
        let timestamp = prost_types::Timestamp {
            seconds: 1_800_000_000,
            nanos: 0,
        };
        let mut job = LocalAppScenarioJob {
            job_id: "job-locate-interrupted".to_string(),
            scenario_type: ScenarioType::VisionLocate as i32,
            status: ScenarioJobStatus::Failed as i32,
            reason_code: crate::generated::ReasonCode::AiExecutionInterrupted as i32,
            trace_id: "trace-locate".to_string(),
            created_at: Some(timestamp.clone()),
            updated_at: Some(timestamp),
            interruption: Some(ExecutionInterruption {
                cause: ExecutionInterruptionCause::RuntimeRestart as i32,
                resubmit_disposition: ExecutionResubmitDisposition::CallerMayResubmit as i32,
            }),
            ..Default::default()
        };
        let projected = project_job(job.clone()).expect("interrupted Job");
        assert_eq!(projected["reasonCode"], "ai-execution-interrupted");
        assert_eq!(
            projected["interruption"],
            json!({"cause":"runtime-restart", "resubmitDisposition":"caller-may-resubmit"})
        );
        job.interruption = None;
        assert!(project_job(job).is_err());
    }

    #[test]
    fn music_running_job_event_projects_through_the_protected_stream_contract() {
        let timestamp = prost_types::Timestamp {
            seconds: 1_800_000_000,
            nanos: 0,
        };
        let job = LocalAppScenarioJob {
            job_id: "job-music-1".to_string(),
            scenario_type: ScenarioType::MusicGenerate as i32,
            status: ScenarioJobStatus::Running as i32,
            reason_code: crate::generated::ReasonCode::ActionExecuted as i32,
            trace_id: "trace-music-1".to_string(),
            created_at: Some(timestamp.clone()),
            updated_at: Some(timestamp.clone()),
            ..Default::default()
        };
        let event = LocalAppScenarioJobEvent {
            event_type: ScenarioJobEventType::ScenarioJobEventRunning as i32,
            sequence: 1,
            trace_id: "trace-music-1".to_string(),
            timestamp: Some(timestamp),
            job: Some(job),
        };

        assert!(project_job_event(event).is_ok());
    }

    #[test]
    fn voice_create_result_is_published_only_for_terminal_success() {
        let timestamp = prost_types::Timestamp {
            seconds: 1_800_000_000,
            nanos: 0,
        };
        let job = LocalAppScenarioJob {
            job_id: "job-voice-create".to_string(),
            scenario_type: ScenarioType::VoiceCreate as i32,
            status: ScenarioJobStatus::Submitted as i32,
            reason_code: crate::generated::ReasonCode::ActionExecuted as i32,
            trace_id: "trace-voice-create".to_string(),
            created_at: Some(timestamp.clone()),
            updated_at: Some(timestamp.clone()),
            ..Default::default()
        };
        let asset = LocalAppVoiceAsset {
            voice_asset_id: "voice-asset-1".to_string(),
            creation_source: VoiceCreationSource::ReferenceAudio as i32,
            status: VoiceAssetStatus::Active as i32,
            created_at: Some(timestamp.clone()),
            updated_at: Some(timestamp),
            expires_at: None,
        };
        let reference = VoiceReference {
            kind: VoiceReferenceKind::VoiceAsset as i32,
            reference: Some(VoiceReferenceValue::VoiceAssetId(
                "voice-asset-1".to_string(),
            )),
        };

        assert!(validate_voice_job_result(&job, None, None).is_ok());
        assert!(validate_voice_job_result(&job, Some(&asset), Some(&reference)).is_err());
        let mut completed = job.clone();
        completed.status = ScenarioJobStatus::Completed as i32;
        assert!(validate_voice_job_result(&completed, None, None).is_err());
        assert!(validate_voice_job_result(&completed, Some(&asset), Some(&reference)).is_ok());
        let mut inactive = asset.clone();
        inactive.status = VoiceAssetStatus::Failed as i32;
        assert!(validate_voice_job_result(&completed, Some(&inactive), Some(&reference)).is_err());
        let mut failed = job.clone();
        failed.status = ScenarioJobStatus::Failed as i32;
        assert!(validate_voice_job_result(&failed, None, None).is_ok());
        assert!(project_job(job).is_ok());
        assert!(project_voice_asset(asset.clone()).is_ok());
        assert!(project_voice_asset_reference(reference.clone()).is_ok());
        assert!(validate_voice_asset_reference_pair(Some(&asset), Some(&reference)).is_ok());
    }
}

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
// @nimi-authority: rule.nimi.runtime.ai-provider.text-annotation
fn project_text_annotation(value: &crate::generated::TextAnnotationResult) -> Result<JsonValue, LocalAppOperationError> {
    if value.documents.is_empty() || value.documents.len() > 64 { return Err(untrusted()); }
    let mut bytes = 0usize;
    let mut count = 0usize;
    let language = &value.documents[0].language;
    if !(2..=16).contains(&language.len()) || !language.bytes().all(|c| c.is_ascii_lowercase() || c == b'-') { return Err(untrusted()); }
    let mut documents = Vec::new();
    for doc in &value.documents {
        bytes += doc.text.len();
        count += doc.tokens.len();
        if bytes > 524288 || count > 65536 || &doc.language != language || (!doc.text.is_empty() && doc.tokens.is_empty()) { return Err(untrusted()); }
        let source: Vec<char> = doc.text.chars().collect();
        let mut end = 0usize;
        let mut tokens = Vec::new();
        for token in &doc.tokens {
            let start = token.start as usize;
            let stop = token.end as usize;
            if start < end || stop <= start || stop > source.len() || token.head_index as usize >= doc.tokens.len()
                || token.part_of_speech.is_empty() || token.part_of_speech.len() > 128 || token.part_of_speech.trim() != token.part_of_speech
                || token.dependency.is_empty() || token.dependency.len() > 128 || token.dependency.trim() != token.dependency {
                return Err(untrusted());
            }
            if source[start..stop].iter().collect::<String>() != token.text || !source[end..start].iter().all(|c| c.is_whitespace()) { return Err(untrusted()); }
            end = stop;
            tokens.push(json!({"text": token.text, "start": token.start, "end": token.end, "headIndex": token.head_index,
                "partOfSpeech": token.part_of_speech, "dependency": token.dependency, "isPunctuation": token.is_punctuation}));
        }
        if !source[end..].iter().all(|c| c.is_whitespace()) { return Err(untrusted()); }
        let mut end = 0u32;
        let mut sentences = Vec::new();
        for sentence in &doc.sentences {
            if sentence.start_token != end || sentence.end_token <= sentence.start_token || sentence.end_token as usize > doc.tokens.len() { return Err(untrusted()); }
            end = sentence.end_token;
            sentences.push(json!({"startToken": sentence.start_token, "endToken": sentence.end_token}));
        }
        if end as usize != doc.tokens.len() { return Err(untrusted()); }
        documents.push(json!({"text": doc.text, "language": doc.language, "tokens": tokens, "sentences": sentences}));
    }
    let result = json!({"documents": documents});
    if serde_json::to_vec(&result).map_err(|_| untrusted())?.len() > 16*1024*1024 { return Err(untrusted()); }
    Ok(result)
}

#[cfg(test)]
mod text_annotation_tests {
    use super::*;

    #[test]
    fn long_annotation_document_is_not_cut_at_the_former_limits() {
        let tokens: Vec<crate::generated::TextAnnotationToken> = (0..9000).map(|i| crate::generated::TextAnnotationToken {
            text: "annotation".into(), start: i*11, end: i*11+10, head_index: 0,
            part_of_speech: "NOUN".into(), dependency: "dep".into(), is_punctuation: false,
        }).collect();
        let text = vec!["annotation"; tokens.len()].join(" ");
        let input = json!({"type":"text-annotate","language":"en","texts":[text]});
        assert!(parse_job_spec(input).is_ok());
        let result = crate::generated::TextAnnotationResult { documents: vec![crate::generated::TextAnnotationDocument {
            text, language: "en".into(), sentences: vec![crate::generated::TextAnnotationSentence { start_token: 0, end_token: tokens.len() as u32 }], tokens,
        }] };
        assert!(project_text_annotation(&result).is_ok());
    }

    #[test]
    fn text_annotation_keeps_unicode_source_and_validates_heads() {
        let input = json!({"type": "text-annotate", "language": "en", "texts": [" 😀 hi ", ""]});
        let JobSpec::TextAnnotate(spec) = parse_job_spec(input).unwrap() else { panic!("wrong spec"); };
        assert_eq!(spec.texts, vec![" 😀 hi ", ""]);
        let mut result = crate::generated::TextAnnotationResult { documents: vec![crate::generated::TextAnnotationDocument {
            text: " 😀 hi ".into(), language: "en".into(),
            tokens: vec![
                crate::generated::TextAnnotationToken { text: "😀".into(), start: 1, end: 2, head_index: 1, part_of_speech: "INTJ".into(), dependency: "intj".into(), is_punctuation: false },
                crate::generated::TextAnnotationToken { text: "hi".into(), start: 3, end: 5, head_index: 1, part_of_speech: "INTJ".into(), dependency: "ROOT".into(), is_punctuation: false },
            ], sentences: vec![crate::generated::TextAnnotationSentence { start_token: 0, end_token: 2 }],
        }] };
        assert_eq!(project_text_annotation(&result).unwrap()["documents"][0]["text"], " 😀 hi ");
        result.documents[0].tokens[0].head_index = 3;
        assert!(project_text_annotation(&result).is_err());
    }
}

fn project_audio_separation(value: &crate::generated::AudioSeparation, artifacts: &[LocalAppScenarioArtifact]) -> Result<JsonValue, LocalAppOperationError> {
    if artifacts.len() != 2 || value.vocals_artifact_id.is_empty() || value.background_artifact_id.is_empty()
        || value.vocals_artifact_id == value.background_artifact_id
        || value.vocals_artifact_id != artifacts[0].artifact_id || value.background_artifact_id != artifacts[1].artifact_id {
        return Err(untrusted());
    }
    for artifact in artifacts {
        if !artifact.mime_type.starts_with("audio/") || artifact.size_bytes <= 0 || artifact.sample_rate_hz <= 0
            || artifact.channels <= 0 || artifact.duration_ms < 0 { return Err(untrusted()); }
    }
    if artifacts[0].sample_rate_hz != artifacts[1].sample_rate_hz || artifacts[0].channels != artifacts[1].channels
        || artifacts[0].duration_ms != artifacts[1].duration_ms { return Err(untrusted()); }
    Ok(json!({"vocalsArtifactId": value.vocals_artifact_id, "backgroundArtifactId": value.background_artifact_id}))
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
fn project_transcription(
    value: &crate::generated::SpeechTranscript,
) -> Result<JsonValue, LocalAppOperationError> {
    let status = match crate::generated::SpeechTranscriptStatus::try_from(value.status)
        .map_err(|_| untrusted())?
    {
        crate::generated::SpeechTranscriptStatus::Transcribed => "transcribed",
        crate::generated::SpeechTranscriptStatus::NoSpeech => "no-speech",
        _ => return Err(untrusted()),
    };
    if value.text.trim() != value.text
        || value.language.trim() != value.language
        || value.language.len() > 64
        || value.words.len() > 16384
    {
        return Err(untrusted());
    }
    if status == "no-speech" {
        if !value.text.is_empty() || !value.language.is_empty() || !value.words.is_empty() {
            return Err(untrusted());
        }
    } else if value.text.is_empty() {
        return Err(untrusted());
    }
    let mut previous_start = 0.0;
    let mut words = Vec::with_capacity(value.words.len());
    for word in &value.words {
        if word.text.trim().is_empty()
            || !word.start_seconds.is_finite()
            || !word.end_seconds.is_finite()
            || word.start_seconds < previous_start
            || word.end_seconds < word.start_seconds
        {
            return Err(untrusted());
        }
        previous_start = word.start_seconds;
        words.push(json!({"text": word.text, "startSeconds": word.start_seconds, "endSeconds": word.end_seconds}));
    }
    let result =
        json!({"status": status, "text": value.text, "language": value.language, "words": words});
    if serde_json::to_vec(&result).map_err(|_| untrusted())?.len() > MAX_TRANSCRIPTION_TEXT_BYTES {
        return Err(untrusted());
    }
    Ok(result)
}

#[cfg(test)]
mod transcription_tests {
    use super::*;
    #[test]
    fn separation_input_and_pair_keep_only_their_admitted_shape() {
        let input = json!({"type": "audio-separate", "mimeType": "audio/wav", "audioSource": {"type": "bytes", "bytes": [1, 2, 3]}});
        assert!(matches!(parse_job_spec(input.clone()).unwrap(), JobSpec::AudioSeparate(_)));
        let mut invalid_input = input;
        invalid_input["provider"] = json!("private-provider");
        assert!(parse_job_spec(invalid_input).is_err());
        let mut artifacts: Vec<LocalAppScenarioArtifact> = ["vocals-1", "background-1"].into_iter().map(|id| LocalAppScenarioArtifact {
            artifact_id: id.into(), mime_type: "audio/wav".into(), size_bytes: 192044, sample_rate_hz: 48000,
            channels: 1, duration_ms: 1000, ..Default::default()
        }).collect();
        let value = crate::generated::AudioSeparation { vocals_artifact_id: "vocals-1".into(), background_artifact_id: "background-1".into() };
        assert_eq!(project_audio_separation(&value, &artifacts).unwrap()["backgroundArtifactId"], "background-1");
        artifacts[1].duration_ms = 900;
        assert!(project_audio_separation(&value, &artifacts).is_err());
    }
    #[test]
    fn typed_transcription_projects_real_seconds_and_rejects_invalid_timing() {
        let mut value = crate::generated::SpeechTranscript {
            status: crate::generated::SpeechTranscriptStatus::Transcribed as i32,
            text: "hello".into(),
            language: "en".into(),
            words: vec![crate::generated::SpeechTranscriptWord {
                text: "hello".into(),
                start_seconds: 0.2,
                end_seconds: 0.8,
            }],
        };
        let result = project_transcription(&value).expect("typed transcript");
        assert_eq!(result["words"][0]["startSeconds"], 0.2);
        value.words[0].end_seconds = 0.1;
        assert!(project_transcription(&value).is_err());
        value = crate::generated::SpeechTranscript {
            status: crate::generated::SpeechTranscriptStatus::NoSpeech as i32,
            ..Default::default()
        };
        assert_eq!(
            project_transcription(&value).unwrap()["status"],
            "no-speech"
        );
    }
}
