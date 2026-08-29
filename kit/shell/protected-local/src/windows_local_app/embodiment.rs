use serde_json::{json, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::local_app_embodiment_event::Payload;
use crate::generated::{
    GetLocalAppEmbodimentSnapshotRequest, LocalAppEmbodimentActivity, LocalAppEmbodimentEmotion,
    LocalAppEmbodimentEvent, LocalAppEmbodimentPosture, LocalAppEmbodimentSnapshot,
    LocalAppEmbodimentVoiceTiming, SubscribeLocalAppEmbodimentEventsRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppEmbodimentSnapshotRequest, LocalAppEmbodimentSubscribeRequest, LocalAppOperationError,
    LocalAppRealtimeSubscriptionReceiver,
};

use super::{invalid_payload, untrusted};

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-011a
// @nimi-authority: rule.nimi.runtime.agent-participation.r159
const MAX_SELECTOR_BYTES: usize = 256;
const MAX_TEXT_BYTES: usize = 256;
const MAX_TIMING_MILLIS: i64 = 24 * 60 * 60 * 1000;

pub(super) async fn snapshot(
    channel: Channel,
    request: LocalAppEmbodimentSnapshotRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_scope(&request.agent_handle, &request.conversation_anchor_id)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_embodiment_snapshot(GetLocalAppEmbodimentSnapshotRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_snapshot(response.snapshot.ok_or_else(untrusted)?)
}

pub(super) async fn subscribe(
    channel: Channel,
    request: LocalAppEmbodimentSubscribeRequest,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    require_scope(&request.agent_handle, &request.conversation_anchor_id)?;
    let mut stream = crate::grpc_limits::runtime_agent_client(channel)
        .subscribe_local_app_embodiment_events(SubscribeLocalAppEmbodimentEventsRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            after_sequence: request.after_sequence,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    if sender.send(project_event(event)).await.is_err() {
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

fn project_snapshot(
    value: LocalAppEmbodimentSnapshot,
) -> Result<JsonValue, LocalAppOperationError> {
    if value.sequence == 0 || value.provenance != "runtime_agent_owner" {
        return Err(untrusted());
    }
    Ok(json!({
        "sequence": value.sequence.to_string(),
        "observedAt": project_timestamp(value.observed_at)?,
        "provenance": "runtime_agent_owner",
        "activity": value.activity.map(project_activity).transpose()?,
        "emotion": value.emotion.map(project_emotion).transpose()?,
        "posture": value.posture.map(project_posture).transpose()?,
        "voiceTiming": value.voice_timing.map(project_voice_timing).transpose()?,
    }))
}

fn project_event(value: LocalAppEmbodimentEvent) -> Result<JsonValue, LocalAppOperationError> {
    if value.sequence == 0 || value.provenance != "runtime_agent_owner" {
        return Err(untrusted());
    }
    let (kind, payload) = match (value.kind, value.payload.ok_or_else(untrusted)?) {
        (1, Payload::Activity(payload)) => ("activity", project_activity(payload)?),
        (2, Payload::Emotion(payload)) => ("emotion", project_emotion(payload)?),
        (3, Payload::Posture(payload)) => ("posture", project_posture(payload)?),
        (4, Payload::VoiceTiming(payload)) => ("voice-timing", project_voice_timing(payload)?),
        _ => return Err(untrusted()),
    };
    Ok(json!({
        "sequence": value.sequence.to_string(),
        "observedAt": project_timestamp(value.observed_at)?,
        "provenance": "runtime_agent_owner",
        "kind": kind,
        "payload": payload,
    }))
}

fn project_activity(
    value: LocalAppEmbodimentActivity,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&value.name, false)?;
    require_text(&value.category, false)?;
    require_text(&value.intensity, true)?;
    require_selector(&value.turn_ref)?;
    if value.source != "runtime" {
        return Err(untrusted());
    }
    Ok(json!({
        "name": value.name,
        "category": value.category,
        "intensity": value.intensity,
        "source": "runtime",
        "turnRef": value.turn_ref,
    }))
}

fn project_emotion(value: LocalAppEmbodimentEmotion) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&value.name, false)?;
    require_text(&value.source, false)?;
    Ok(json!({ "name": value.name, "source": value.source }))
}

fn project_posture(value: LocalAppEmbodimentPosture) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&value.action_family, false)?;
    require_text(&value.interrupt_mode, false)?;
    Ok(json!({
        "actionFamily": value.action_family,
        "interruptMode": value.interrupt_mode,
    }))
}

fn project_voice_timing(
    value: LocalAppEmbodimentVoiceTiming,
) -> Result<JsonValue, LocalAppOperationError> {
    let phase = match value.phase {
        1 => "active",
        2 => "completed",
        3 => "failed",
        4 => "interrupted",
        5 => "canceled",
        _ => return Err(untrusted()),
    };
    if !(0..=MAX_TIMING_MILLIS).contains(&value.duration_ms)
        || !(0..=MAX_TIMING_MILLIS).contains(&value.deadline_offset_ms)
    {
        return Err(untrusted());
    }
    require_selector(&value.turn_ref)?;
    require_selector(&value.correlation_ref)?;
    Ok(json!({
        "phase": phase,
        "durationMillis": value.duration_ms,
        "deadlineOffsetMillis": value.deadline_offset_ms,
        "turnRef": value.turn_ref,
        "correlationRef": value.correlation_ref,
    }))
}

fn project_timestamp(
    value: Option<prost_types::Timestamp>,
) -> Result<JsonValue, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    if !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    Ok(json!({ "seconds": value.seconds.to_string(), "nanos": value.nanos }))
}

fn require_scope(
    agent_handle: &str,
    conversation_anchor_id: &str,
) -> Result<(), LocalAppOperationError> {
    if !agent_handle.starts_with("agent_ref_") {
        return Err(invalid_payload());
    }
    require_selector(agent_handle)?;
    require_selector(conversation_anchor_id)
}

fn require_selector(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.len() > MAX_SELECTOR_BYTES
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn require_text(value: &str, allow_empty: bool) -> Result<(), LocalAppOperationError> {
    if (!allow_empty && value.is_empty())
        || value.len() > MAX_TEXT_BYTES
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(untrusted());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_keeps_only_common_semantic_timing() {
        let projected = project_voice_timing(LocalAppEmbodimentVoiceTiming {
            phase: 1,
            duration_ms: 1200,
            deadline_offset_ms: 80,
            turn_ref: "turn-1".into(),
            correlation_ref: "voice-1".into(),
        })
        .expect("project semantic timing");
        assert_eq!(projected["phase"], "active");
        assert!(projected.get("audioClock").is_none());
        assert!(projected.get("viseme").is_none());
    }

    #[test]
    fn projection_rejects_renderer_or_unbounded_timing_values() {
        assert!(project_voice_timing(LocalAppEmbodimentVoiceTiming {
            phase: 1,
            duration_ms: MAX_TIMING_MILLIS + 1,
            deadline_offset_ms: 0,
            turn_ref: "turn-1".into(),
            correlation_ref: "voice-1".into(),
        })
        .is_err());
        assert!(project_activity(LocalAppEmbodimentActivity {
            name: "idle".into(),
            category: "state".into(),
            intensity: "".into(),
            source: "avatar-renderer".into(),
            turn_ref: "turn-1".into(),
        })
        .is_err());
    }
}
