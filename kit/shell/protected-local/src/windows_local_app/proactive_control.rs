use super::{invalid_payload, untrusted};
use crate::generated as wire;
use crate::grpc_status::local_app_error_from_status;
use crate::{

    LocalAppConversationFollowUpCancelRequest,
    LocalAppOperationError,
};
use serde_json::{json, Value};
use tonic::transport::Channel;

fn selector(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}
fn handle(value: &str) -> bool {
    value.strip_prefix("agent_ref_").is_some_and(|v| {
        v.len() == 43
            && v.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    })
}
fn timestamp(value: prost_types::Timestamp) -> Result<Value, LocalAppOperationError> {
    if !(-62135596800..=253402300799).contains(&value.seconds)
        || !(0..1_000_000_000).contains(&value.nanos)
    {
        return Err(untrusted());
    }
    Ok(json!({"seconds": value.seconds.to_string(), "nanos": value.nanos}))
}
pub(super) fn state(
    input: wire::LocalAppConversationState,
) -> Result<Value, LocalAppOperationError> {
    if input.max_follow_up_turns == 0 || input.text_turn_id.as_deref().is_some_and(|v| !selector(v))
    {
        return Err(untrusted());
    }
    let pending = match input.pending_follow_up {
        None => Value::Null,
        Some(task) => {
            if !selector(&task.task_id) || !selector(&task.source_turn_id) || task.revision == 0 {
                return Err(untrusted());
            }
            json!({"taskId":task.task_id,"revision":task.revision.to_string(),"scheduledFor":timestamp(task.scheduled_for.ok_or_else(untrusted)?)?,"sourceTurnId":task.source_turn_id})
        }
    };
    Ok(
        json!({"freeContactEnabled":input.free_contact_enabled,"maxFollowUpTurns":input.max_follow_up_turns,"pendingFollowUp":pending,"textTurnId":input.text_turn_id}),
    )
}
pub(super) async fn follow_up(
    channel: Channel,
    request: LocalAppConversationFollowUpCancelRequest,
) -> Result<Value, LocalAppOperationError> {
    if !handle(&request.agent_handle)
        || !selector(&request.conversation_anchor_id)
        || !selector(&request.task_id)
        || request.expected_revision == 0
    {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .cancel_local_app_conversation_follow_up(wire::CancelLocalAppConversationFollowUpRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            task_id: request.task_id,
            expected_revision: request.expected_revision,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    state(response.state.ok_or_else(untrusted)?)
}

fn frame(value: wire::LocalAppAgentLifeFrame) -> Result<Value, LocalAppOperationError> {
    if !selector(&value.frame_id)
        || (!value.interaction && !selector(&value.activity_ref))
        || value.title.is_empty()
        || value.title.chars().count() > 160
        || value.progress.is_some_and(|v| v > 100) || (value.interaction && value.progress.is_some()) || (!value.interaction && value.progress.is_none())
    {
        return Err(untrusted());
    }
    let phase = match value.phase {
        1 => "planned",
        2 => "active",
        3 => "paused",
        4 => "completed",
        5 => "interrupted",
        6 => "canceled",
        _ => return Err(untrusted()),
    };
    Ok(
        json!({"frameId":value.frame_id,"activityRef":value.activity_ref,"title":value.title,"phase":phase,"startsAt":timestamp(value.starts_at.ok_or_else(untrusted)?)?,"endsAt":value.ends_at.map(timestamp).transpose()?,"progress":value.progress,"interaction":value.interaction}),
    )
}
pub(super) fn life(
    value: wire::LocalAppAgentLifeProjection,
) -> Result<Value, LocalAppOperationError> {
    if value.revision == 0
        || value.recent.len() > 12
        || value.future.len() > 6
        || value.activities.len() > 24
        || value.wait_reason.len() > 128
    {
        return Err(untrusted());
    }
    let recent = value
        .recent
        .into_iter()
        .map(frame)
        .collect::<Result<Vec<_>, _>>()?;
    let future = value
        .future
        .into_iter()
        .map(frame)
        .collect::<Result<Vec<_>, _>>()?;
    let activities=value.activities.into_iter().map(|a| {
        if !selector(&a.activity_ref)||a.title.is_empty()||a.title.chars().count()>160||!matches!(a.kind.as_str(),"routine"|"project")||a.progress>100 { return Err(untrusted()); }
        let phase=match a.phase {1=>"planned",2=>"active",3=>"paused",_=>return Err(untrusted())};
        Ok(json!({"activityRef":a.activity_ref,"title":a.title,"kind":a.kind,"phase":phase,"progress":a.progress}))
    }).collect::<Result<Vec<_>,LocalAppOperationError>>()?;
    Ok(
        json!({"activities":activities,"revision":value.revision.to_string(),"current":value.current.map(frame).transpose()?,"recent":recent,"future":future,"nextCheckAt":value.next_check_at.map(timestamp).transpose()?,"waitReason":value.wait_reason}),
    )
}


#[cfg(test)]
mod audit9_projection_tests {
    use super::*;

    #[test]
    fn retained_activity_projection_does_not_require_a_frame() {
        let value = life(wire::LocalAppAgentLifeProjection {
            revision: 1,
            activities: vec![wire::LocalAppAgentLifeActivity {
                activity_ref: "paused-book".into(), title: "Book A".into(), kind: "project".into(),
                phase: 3, progress: 20,
            }],
            ..Default::default()
        }).unwrap();
        assert_eq!(value["activities"][0]["activityRef"], "paused-book");
        assert_eq!(value["activities"][0]["progress"], 20);
    }


}
