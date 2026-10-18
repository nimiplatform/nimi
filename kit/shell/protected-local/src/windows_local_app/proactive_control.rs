use super::{invalid_payload, untrusted};
use crate::generated as wire;
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentHandleRequest, LocalAppAgentPendingHookUpdateRequest,
    LocalAppConversationFollowUpUpdateRequest, LocalAppConversationPolicyRequest,
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
    Ok(json!({"seconds":value.seconds.to_string(),"nanos":value.nanos}))
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
        json!({"followUpEnabled":input.follow_up_enabled,"followUpPolicyRevision":input.follow_up_policy_revision.to_string(),"maxFollowUpTurns":input.max_follow_up_turns,"pendingFollowUp":pending,"textTurnId":input.text_turn_id}),
    )
}
fn task_action(
    action: &str,
    due: Option<crate::LocalAppScheduledTime>,
) -> Result<(i32, Option<prost_types::Timestamp>), LocalAppOperationError> {
    let code = match action {
        "cancel" if due.is_none() => 1,
        "reschedule" if due.is_some() => 2,
        _ => return Err(invalid_payload()),
    };
    let due = due.map(|v| prost_types::Timestamp {
        seconds: v.seconds,
        nanos: v.nanos,
    });
    if let Some(ref v) = due {
        timestamp(v.clone()).map_err(|_| invalid_payload())?;
    }
    Ok((code, due))
}
pub(super) async fn policy(
    channel: Channel,
    request: LocalAppConversationPolicyRequest,
) -> Result<Value, LocalAppOperationError> {
    if !handle(&request.agent_handle) || !selector(&request.conversation_anchor_id) {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .update_local_app_conversation_follow_up_policy(
            wire::UpdateLocalAppConversationFollowUpPolicyRequest {
                agent_handle: request.agent_handle,
                conversation_anchor_id: request.conversation_anchor_id,
                expected_revision: request.expected_revision,
                enabled: request.enabled,
            },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    state(response.state.ok_or_else(untrusted)?)
}
pub(super) async fn follow_up(
    channel: Channel,
    request: LocalAppConversationFollowUpUpdateRequest,
) -> Result<Value, LocalAppOperationError> {
    if !handle(&request.agent_handle)
        || !selector(&request.conversation_anchor_id)
        || !selector(&request.task_id)
        || request.expected_revision == 0
    {
        return Err(invalid_payload());
    }
    let (action, scheduled_for) = task_action(&request.action, request.scheduled_for)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .update_local_app_conversation_follow_up(wire::UpdateLocalAppConversationFollowUpRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            task_id: request.task_id,
            expected_revision: request.expected_revision,
            action,
            scheduled_for,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    state(response.state.ok_or_else(untrusted)?)
}
fn pending_hook(input: wire::LocalAppAgentPendingHook) -> Result<Value, LocalAppOperationError> {
    if !selector(&input.task_id) || input.revision == 0 {
        return Err(untrusted());
    }
    let status = match wire::HookAdmissionState::try_from(input.status).map_err(|_| untrusted())? {
        wire::HookAdmissionState::Pending => "pending",
        wire::HookAdmissionState::Running => "running",
        wire::HookAdmissionState::Canceled => "canceled",
        _ => return Err(untrusted()),
    };
    if input.can_modify && (input.system_cadence || status != "pending") {
        return Err(untrusted());
    }
    Ok(
        json!({"taskId":input.task_id,"revision":input.revision.to_string(),"scheduledFor":input.scheduled_for.map(timestamp).transpose()?,"systemCadence":input.system_cadence,"status":status,"canModify":input.can_modify,"publicPurpose":input.public_purpose}),
    )
}
pub(super) async fn list_hooks(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<Value, LocalAppOperationError> {
    if !handle(&request.agent_handle) {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .list_local_app_agent_pending_hooks(wire::ListLocalAppAgentPendingHooksRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.hooks.len() > 100 {
        return Err(untrusted());
    }
    let hooks = response
        .hooks
        .into_iter()
        .map(pending_hook)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"hooks":hooks,"truncated":response.truncated}))
}
pub(super) async fn update_hook(
    channel: Channel,
    request: LocalAppAgentPendingHookUpdateRequest,
) -> Result<Value, LocalAppOperationError> {
    if !handle(&request.agent_handle)
        || !selector(&request.task_id)
        || request.expected_revision == 0
    {
        return Err(invalid_payload());
    }
    let (action, scheduled_for) = task_action(&request.action, request.scheduled_for)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .update_local_app_agent_pending_hook(wire::UpdateLocalAppAgentPendingHookRequest {
            agent_handle: request.agent_handle,
            task_id: request.task_id,
            expected_revision: request.expected_revision,
            action,
            scheduled_for,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    pending_hook(response.hook.ok_or_else(untrusted)?)
}


#[cfg(test)]
mod purpose_tests {
    use super::*;

    #[test]
    fn public_purpose_uses_the_typed_field_without_changing_controls() {
        let task = wire::LocalAppAgentPendingHook {
            task_id: "hook-1".into(), revision: 1, status: 2,
            can_modify: true, public_purpose: "Revisit the observation".into(),
            ..Default::default()
        };
        let projected = pending_hook(task.clone()).unwrap();
        assert_eq!(projected["publicPurpose"], "Revisit the observation");
        assert_eq!(projected["canModify"], true);
        assert!(projected.get("reason").is_none());
        assert!(pending_hook(wire::LocalAppAgentPendingHook {
            system_cadence: true, ..task
        }).is_err());
    }
}
