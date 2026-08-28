use serde_json::{json, Map as JsonMap, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::{
    AgentContextProjectionReasonCode, AgentConversationSummaryStatus, AgentExecutionState,
    AgentLifecycleStatus, AgentLocalSourceContextState, AgentLocalSourceCoverageSection,
    AgentLocalSourceCoverageState, AgentPresentationAssetMaterial, AgentPresentationAssetRole,
    AgentPresentationBackendKind, AgentPresentationProfile, AgentPresentationProfilePatch,
    AgentSourceCognitionStatus, AgentTurnContextLaneId, AgentTurnContextLaneState,
    AgentTurnContextState, AgentTurnContextTruncationReason, CognitionMemoryEpistemicStatus,
    CognitionMemoryLifecycle, CognitionMemoryOutcome, CommitLocalAppAgentPresentationRequest,
    CorrectLocalAppAgentMemoryRequest, DeleteAllLocalAppAgentMemoryRequest,
    ForgetLocalAppAgentMemoryRequest, GetLocalAppAgentAutonomySnapshotRequest,
    GetLocalAppAgentManagerSnapshotRequest, GetLocalAppAgentPresentationSnapshotRequest,
    InspectLocalAppAgentMemoryRequest, LocalAppAgentAutonomyConfig, LocalAppAgentAutonomyIntent,
    LocalAppAgentAutonomyMode, LocalAppAgentAutonomyProjection,
    LocalAppAgentManagerActionAvailabilityState, LocalAppAgentManagerActionUnavailableReason,
    LocalAppAgentManagerProductAction, LocalAppAgentPresentationIntent,
    LocalAppAgentPresentationProjection, SetLocalAppAgentMemoryEnabledRequest,
    UpdateLocalAppAgentAutonomyRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentManagerSnapshotRequest, LocalAppAgentMemoryCorrectRequest,
    LocalAppAgentMemoryDeleteRequest, LocalAppAgentMemoryForgetRequest,
    LocalAppAgentMemoryInspectRequest, LocalAppAgentMemorySwitchRequest,
    LocalAppAgentUpdateAutonomyRequest, LocalAppOperationError,
};

use super::{invalid_payload, untrusted};

const AGENT_HANDLE_PREFIX: &str = "agent_ref_";
const AGENT_HANDLE_SUFFIX_BYTES: usize = 43;
const MAX_MEMORY_PAGE_SIZE: u32 = 100;
const MAX_MEMORY_PAGE_TOKEN_BYTES: usize = 1024;

pub(super) async fn manager_snapshot(
    channel: Channel,
    request: LocalAppAgentManagerSnapshotRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    if request
        .conversation_anchor_id
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.len() > 512 || value.trim() != value)
    {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_manager_snapshot(GetLocalAppAgentManagerSnapshotRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_manager_snapshot(response.snapshot.ok_or_else(untrusted)?)
}

fn project_manager_snapshot(
    snapshot: crate::generated::LocalAppAgentManagerSnapshot,
) -> Result<JsonValue, LocalAppOperationError> {
    if snapshot.status_text.len() > 2048 || snapshot.current_emotion.len() > 256 {
        return Err(untrusted());
    }
    let action_availability = project_manager_action_availability(snapshot.action_availability)?;
    Ok(json!({
        "lifecycleStatus": project_lifecycle_status(snapshot.lifecycle_status)?,
        "executionState": project_execution_state(snapshot.execution_state)?,
        "statusText": snapshot.status_text,
        "currentEmotion": snapshot.current_emotion,
        "source": snapshot.source.map(project_manager_source).transpose()?,
        "context": snapshot.context.map(project_manager_context).transpose()?,
        "actionAvailability": action_availability,
    }))
}

fn project_manager_action_availability(
    rows: Vec<crate::generated::LocalAppAgentManagerActionAvailability>,
) -> Result<JsonValue, LocalAppOperationError> {
    if rows.len() != 11 {
        return Err(untrusted());
    }
    let mut projected = JsonMap::new();
    for row in rows {
        let action = match LocalAppAgentManagerProductAction::try_from(row.action)
            .map_err(|_| untrusted())?
        {
            LocalAppAgentManagerProductAction::SharedAiConfigRead => "getSharedAIConfig",
            LocalAppAgentManagerProductAction::SharedAiConfigWrite => "overwriteSharedAIConfig",
            LocalAppAgentManagerProductAction::AutonomyRead => "readAutonomy",
            LocalAppAgentManagerProductAction::AutonomyWrite => "updateAutonomy",
            LocalAppAgentManagerProductAction::MemoryInspect => "inspectMemory",
            LocalAppAgentManagerProductAction::MemoryCorrect => "correctMemory",
            LocalAppAgentManagerProductAction::MemoryForget => "forgetMemory",
            LocalAppAgentManagerProductAction::MemorySwitch => "switchMemory",
            LocalAppAgentManagerProductAction::MemoryDelete => "deleteAllMemory",
            LocalAppAgentManagerProductAction::AppearanceCommit => "replaceAppearance",
            LocalAppAgentManagerProductAction::AppearanceRestore => "restorePreviousAppearance",
            LocalAppAgentManagerProductAction::Unspecified => return Err(untrusted()),
        };
        if projected.contains_key(action) {
            return Err(untrusted());
        }
        let state = LocalAppAgentManagerActionAvailabilityState::try_from(row.state)
            .map_err(|_| untrusted())?;
        let reason = LocalAppAgentManagerActionUnavailableReason::try_from(row.reason)
            .map_err(|_| untrusted())?;
        let value = match state {
            LocalAppAgentManagerActionAvailabilityState::Available => {
                if reason != LocalAppAgentManagerActionUnavailableReason::None {
                    return Err(untrusted());
                }
                json!({ "state": "available", "reason": null })
            }
            LocalAppAgentManagerActionAvailabilityState::Unavailable => {
                let reason = match reason {
                    LocalAppAgentManagerActionUnavailableReason::OperationUnavailable => {
                        "operation-unavailable"
                    }
                    LocalAppAgentManagerActionUnavailableReason::OwnerUnavailable => {
                        "owner-unavailable"
                    }
                    LocalAppAgentManagerActionUnavailableReason::MemoryDisabled => {
                        "memory-disabled"
                    }
                    LocalAppAgentManagerActionUnavailableReason::MemoryAdoptionRequired => {
                        "memory-adoption-required"
                    }
                    LocalAppAgentManagerActionUnavailableReason::PreviousPresentationUnavailable => {
                        "previous-presentation-unavailable"
                    }
                    LocalAppAgentManagerActionUnavailableReason::None
                    | LocalAppAgentManagerActionUnavailableReason::Unspecified => {
                        return Err(untrusted())
                    }
                };
                json!({ "state": "unavailable", "reason": reason })
            }
            LocalAppAgentManagerActionAvailabilityState::Unspecified => return Err(untrusted()),
        };
        projected.insert(action.to_string(), value);
    }
    if projected.len() != 11 {
        return Err(untrusted());
    }
    Ok(JsonValue::Object(projected))
}

fn project_manager_source(
    source: crate::generated::LocalAppAgentManagerSourceProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    if source.coverage_sections.len() > 32 {
        return Err(untrusted());
    }
    let coverage_sections = source
        .coverage_sections
        .into_iter()
        .map(|row| {
            Ok(json!({
                "section": project_source_coverage_section(row.section)?,
                "state": project_source_coverage_state(row.state)?,
                "requiredCount": row.required_count,
                "resolvedCount": row.resolved_count,
                "omittedCount": row.omitted_count,
            }))
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
    Ok(json!({
        "ready": source.ready,
        "state": project_source_state(source.state)?,
        "reasonCode": project_context_reason(source.reason_code)?,
        "capturedAt": source.captured_at.map(project_timestamp),
        "coverageSections": coverage_sections,
        "lorebookReady": source.lorebook_ready,
        "lorebookItemCount": source.lorebook_item_count,
        "lorebookEstimatedTokens": source.lorebook_estimated_tokens.to_string(),
    }))
}

fn project_manager_context(
    context: crate::generated::LocalAppAgentManagerContextProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    if context.lanes.len() > 32 || context.truncation.len() > 16 {
        return Err(untrusted());
    }
    let lanes = context
        .lanes
        .into_iter()
        .map(|lane| {
            Ok(json!({
                "laneId": project_context_lane_id(lane.lane_id)?,
                "state": project_context_lane_state(lane.state)?,
                "includedItemCount": lane.included_item_count,
                "omittedItemCount": lane.omitted_item_count,
                "truncatedItemCount": lane.truncated_item_count,
                "allocatedTokens": lane.allocated_tokens.to_string(),
                "usedTokens": lane.used_tokens.to_string(),
            }))
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
    let truncation = context
        .truncation
        .into_iter()
        .map(|row| {
            Ok(json!({
                "reason": project_context_truncation_reason(row.reason)?,
                "omittedItemCount": row.omitted_item_count,
                "truncatedItemCount": row.truncated_item_count,
            }))
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
    Ok(json!({
        "ready": context.ready,
        "state": project_context_state(context.state)?,
        "reasonCode": project_context_reason(context.reason_code)?,
        "lanes": lanes,
        "inputBudgetTokens": context.input_budget_tokens.to_string(),
        "usedTokens": context.used_tokens.to_string(),
        "requiredInputTokens": context.required_input_tokens.to_string(),
        "requiredContextWindowTokens": context.required_context_window_tokens.to_string(),
        "truncation": truncation,
        "transcriptTurnCount": context.transcript_turn_count,
        "memoryItemCount": context.memory_item_count,
        "mediaCount": context.media_count,
        "toolCount": context.tool_count,
        "sourceAdapterStatus": project_source_cognition_status(context.source_adapter_status)?,
        "sourceSelectionStatus": project_source_cognition_status(context.source_selection_status)?,
        "conversationSummaryStatus": project_conversation_summary_status(context.conversation_summary_status)?,
        "privateRecallCount": context.private_recall_count,
    }))
}

fn project_lifecycle_status(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentLifecycleStatus::try_from(value).map_err(|_| untrusted())? {
            AgentLifecycleStatus::Initializing => "initializing",
            AgentLifecycleStatus::Active => "active",
            AgentLifecycleStatus::Suspended => "suspended",
            AgentLifecycleStatus::Terminating => "terminating",
            AgentLifecycleStatus::Terminated => "terminated",
            AgentLifecycleStatus::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_execution_state(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentExecutionState::try_from(value).map_err(|_| untrusted())? {
            AgentExecutionState::Idle => "idle",
            AgentExecutionState::ChatActive => "chat-active",
            AgentExecutionState::LifePending => "life-pending",
            AgentExecutionState::LifeRunning => "life-running",
            AgentExecutionState::Suspended => "suspended",
            AgentExecutionState::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_source_state(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentLocalSourceContextState::try_from(value).map_err(|_| untrusted())? {
            AgentLocalSourceContextState::NotMaterialized => "not_materialized",
            AgentLocalSourceContextState::Validating => "validating",
            AgentLocalSourceContextState::Ready => "ready",
            AgentLocalSourceContextState::Invalid => "invalid",
            AgentLocalSourceContextState::Deleted => "deleted",
            AgentLocalSourceContextState::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_context_state(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentTurnContextState::try_from(value).map_err(|_| untrusted())? {
            AgentTurnContextState::NotComposed => "not_composed",
            AgentTurnContextState::Ready => "ready",
            AgentTurnContextState::ContextCapacityExceeded => "context_capacity_exceeded",
            AgentTurnContextState::Invalid => "invalid",
            AgentTurnContextState::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_context_reason(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentContextProjectionReasonCode::try_from(value).map_err(|_| untrusted())? {
            AgentContextProjectionReasonCode::None => "none",
            AgentContextProjectionReasonCode::SourceNotMaterialized => "source_not_materialized",
            AgentContextProjectionReasonCode::SourceValidationPending => {
                "source_validation_pending"
            }
            AgentContextProjectionReasonCode::SourceSnapshotInvalid => "source_snapshot_invalid",
            AgentContextProjectionReasonCode::ContextNotComposed => "context_not_composed",
            AgentContextProjectionReasonCode::ContextCapacityExceeded => {
                "context_capacity_exceeded"
            }
            AgentContextProjectionReasonCode::ContextManifestInvalid => "context_manifest_invalid",
            AgentContextProjectionReasonCode::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_source_coverage_section(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentLocalSourceCoverageSection::try_from(value).map_err(|_| untrusted())? {
            AgentLocalSourceCoverageSection::Identity => "identity",
            AgentLocalSourceCoverageSection::Presentation => "presentation",
            AgentLocalSourceCoverageSection::Biography => "biography",
            AgentLocalSourceCoverageSection::Psychology => "psychology",
            AgentLocalSourceCoverageSection::Knowledge => "knowledge",
            AgentLocalSourceCoverageSection::Relationships => "relationships",
            AgentLocalSourceCoverageSection::Capabilities => "capabilities",
            AgentLocalSourceCoverageSection::InteractionProfile => "interaction_profile",
            AgentLocalSourceCoverageSection::Assets => "assets",
            AgentLocalSourceCoverageSection::Authoring => "authoring",
            AgentLocalSourceCoverageSection::WorldCore => "world_core",
            AgentLocalSourceCoverageSection::BoundEntity => "bound_entity",
            AgentLocalSourceCoverageSection::DependencyClosure => "dependency_closure",
            AgentLocalSourceCoverageSection::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_source_coverage_state(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentLocalSourceCoverageState::try_from(value).map_err(|_| untrusted())? {
            AgentLocalSourceCoverageState::Complete => "complete",
            AgentLocalSourceCoverageState::NotApplicable => "not_applicable",
            AgentLocalSourceCoverageState::OptionalOmitted => "optional_omitted",
            AgentLocalSourceCoverageState::Invalid => "invalid",
            AgentLocalSourceCoverageState::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_context_lane_id(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentTurnContextLaneId::try_from(value).map_err(|_| untrusted())? {
            AgentTurnContextLaneId::RuntimePolicy => "runtime_policy",
            AgentTurnContextLaneId::OutputContract => "output_contract",
            AgentTurnContextLaneId::SourceIdentity => "source_identity",
            AgentTurnContextLaneId::SourceBehavior => "source_behavior",
            AgentTurnContextLaneId::WorldContext => "world_context",
            AgentTurnContextLaneId::RelationshipContext => "relationship_context",
            AgentTurnContextLaneId::SourceKnowledge => "source_knowledge",
            AgentTurnContextLaneId::CanonicalMemory => "canonical_memory",
            AgentTurnContextLaneId::ConversationHistory => "conversation_history",
            AgentTurnContextLaneId::CapabilityContext => "capability_context",
            AgentTurnContextLaneId::CurrentUserTurn => "current_user_turn",
            AgentTurnContextLaneId::CognitionSource => "cognition_source",
            AgentTurnContextLaneId::ConversationSummary => "conversation_summary",
            AgentTurnContextLaneId::PrivateRecall => "private_recall",
            AgentTurnContextLaneId::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_context_lane_state(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentTurnContextLaneState::try_from(value).map_err(|_| untrusted())? {
            AgentTurnContextLaneState::Included => "included",
            AgentTurnContextLaneState::Empty => "empty",
            AgentTurnContextLaneState::Omitted => "omitted",
            AgentTurnContextLaneState::Truncated => "truncated",
            AgentTurnContextLaneState::Invalid => "invalid",
            AgentTurnContextLaneState::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_context_truncation_reason(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentTurnContextTruncationReason::try_from(value).map_err(|_| untrusted())? {
            AgentTurnContextTruncationReason::None => "none",
            AgentTurnContextTruncationReason::InputBudgetExhausted => "input_budget_exhausted",
            AgentTurnContextTruncationReason::OptionalContentOmitted => "optional_content_omitted",
            AgentTurnContextTruncationReason::ContextCapacityExceeded => {
                "context_capacity_exceeded"
            }
            AgentTurnContextTruncationReason::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_source_cognition_status(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentSourceCognitionStatus::try_from(value).map_err(|_| untrusted())? {
            AgentSourceCognitionStatus::Unconfigured => "unconfigured",
            AgentSourceCognitionStatus::Building => "building",
            AgentSourceCognitionStatus::Ready => "ready",
            AgentSourceCognitionStatus::Unavailable => "unavailable",
            AgentSourceCognitionStatus::Failure => "failure",
            AgentSourceCognitionStatus::NoHits => "no_hits",
            AgentSourceCognitionStatus::NoResult => "no_result",
            AgentSourceCognitionStatus::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_conversation_summary_status(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentConversationSummaryStatus::try_from(value).map_err(|_| untrusted())? {
            AgentConversationSummaryStatus::Absent => "absent",
            AgentConversationSummaryStatus::Ready => "ready",
            AgentConversationSummaryStatus::Failed => "failed",
            AgentConversationSummaryStatus::Omitted => "omitted",
            AgentConversationSummaryStatus::Unavailable => "unavailable",
            AgentConversationSummaryStatus::Unspecified => return Err(untrusted()),
        },
    )
}

pub(super) async fn autonomy_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_autonomy_snapshot(GetLocalAppAgentAutonomySnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_autonomy(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn update_autonomy(
    channel: Channel,
    request: LocalAppAgentUpdateAutonomyRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    if request.expected_autonomy_revision == 0 {
        return Err(invalid_payload());
    }
    let intent = parse_autonomy_intent(request.intent)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .update_local_app_agent_autonomy(UpdateLocalAppAgentAutonomyRequest {
            agent_handle: request.agent_handle,
            expected_autonomy_revision: request.expected_autonomy_revision,
            intent: Some(intent),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_autonomy(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn presentation_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_presentation_snapshot(GetLocalAppAgentPresentationSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_presentation(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn commit_presentation(
    channel: Channel,
    request: LocalAppAgentCommitPresentationRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let intent = parse_presentation_intent(request.intent)?;
    let imported_assets = parse_presentation_assets(request.imported_assets)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .commit_local_app_agent_presentation(CommitLocalAppAgentPresentationRequest {
            agent_handle: request.agent_handle,
            expected_presentation_revision: request.expected_presentation_revision,
            intent: Some(intent),
            imported_assets,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_presentation(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn memory_inspect(
    channel: Channel,
    request: LocalAppAgentMemoryInspectRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_memory_page(request.limit, &request.page_token)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .inspect_local_app_agent_memory(InspectLocalAppAgentMemoryRequest {
            agent_handle: request.agent_handle,
            limit: request.limit,
            page_token: request.page_token,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_memory(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn memory_correct(
    channel: Channel,
    request: LocalAppAgentMemoryCorrectRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .correct_local_app_agent_memory(CorrectLocalAppAgentMemoryRequest {
            agent_handle: request.agent_handle,
            memory_id: request.memory_id,
            corrected_content: request.corrected_content,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_memory_mutation(
        response.outcome,
        response.affected_memory_ids,
        response.projection,
    )
}

pub(super) async fn memory_forget(
    channel: Channel,
    request: LocalAppAgentMemoryForgetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .forget_local_app_agent_memory(ForgetLocalAppAgentMemoryRequest {
            agent_handle: request.agent_handle,
            memory_ids: request.memory_ids,
            confirmed: request.confirmed,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_memory_mutation(
        response.outcome,
        response.affected_memory_ids,
        response.projection,
    )
}

pub(super) async fn memory_switch(
    channel: Channel,
    request: LocalAppAgentMemorySwitchRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .set_local_app_agent_memory_enabled(SetLocalAppAgentMemoryEnabledRequest {
            agent_handle: request.agent_handle,
            enabled: request.enabled,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_memory_mutation(response.outcome, Vec::new(), response.projection)
}

pub(super) async fn memory_delete(
    channel: Channel,
    request: LocalAppAgentMemoryDeleteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .delete_all_local_app_agent_memory(DeleteAllLocalAppAgentMemoryRequest {
            agent_handle: request.agent_handle,
            confirmed: request.confirmed,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_memory_mutation(
        response.outcome,
        response.affected_memory_ids,
        response.projection,
    )
}

fn project_memory(
    projection: crate::generated::AgentMemoryProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    let outcome = project_memory_outcome(projection.outcome)?;
    if !valid_memory_page_token(&projection.next_page_token) {
        return Err(untrusted());
    }
    let next_page_token =
        (!projection.next_page_token.is_empty()).then_some(projection.next_page_token);
    let items = projection.items.into_iter().map(|item| {
        Ok(json!({
            "memoryId": item.memory_id,
            "content": item.content,
            "epistemicStatus": match CognitionMemoryEpistemicStatus::try_from(item.epistemic_status).map_err(|_| untrusted())? {
                CognitionMemoryEpistemicStatus::Explicit => "explicit",
                CognitionMemoryEpistemicStatus::Inferred => "inferred",
                CognitionMemoryEpistemicStatus::Consolidated => "consolidated",
                CognitionMemoryEpistemicStatus::Unspecified => return Err(untrusted()),
            },
            "lifecycle": match CognitionMemoryLifecycle::try_from(item.lifecycle).map_err(|_| untrusted())? {
                CognitionMemoryLifecycle::Current => "current",
                CognitionMemoryLifecycle::Superseded => "superseded",
                CognitionMemoryLifecycle::Conflicted => "conflicted",
                CognitionMemoryLifecycle::Forgotten => return Err(untrusted()),
                CognitionMemoryLifecycle::Unspecified => return Err(untrusted()),
            },
            "occurredAt": item.occurred_at.map(project_timestamp).ok_or_else(untrusted)?,
            "updatedAt": item.updated_at.map(project_timestamp).ok_or_else(untrusted)?,
            "sourceExplanation": item.source_explanation,
        }))
    }).collect::<Result<Vec<JsonValue>, LocalAppOperationError>>()?;
    Ok(json!({
        "outcome": outcome,
        "enabled": projection.enabled,
        "adoptionRequired": projection.adoption_required,
        "items": items,
        "currentCount": projection.current_count,
        "supersededCount": projection.superseded_count,
        "forgottenCount": projection.forgotten_count,
        "nextPageToken": next_page_token,
    }))
}

fn require_memory_page(limit: u32, page_token: &str) -> Result<(), LocalAppOperationError> {
    if !(1..=MAX_MEMORY_PAGE_SIZE).contains(&limit) || !valid_memory_page_token(page_token) {
        return Err(invalid_payload());
    }
    Ok(())
}

fn valid_memory_page_token(value: &str) -> bool {
    value.trim() == value
        && value.len() <= MAX_MEMORY_PAGE_TOKEN_BYTES
        && !value.chars().any(|character| {
            ('\u{0000}'..='\u{001f}').contains(&character) || character == '\u{007f}'
        })
}

fn project_memory_mutation(
    outcome: i32,
    affected_memory_ids: Vec<String>,
    projection: Option<crate::generated::AgentMemoryProjection>,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "outcome": project_memory_outcome(outcome)?,
        "affectedMemoryIds": affected_memory_ids,
        "projection": project_memory(projection.ok_or_else(untrusted)?)?,
    }))
}

fn project_memory_outcome(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match CognitionMemoryOutcome::try_from(value).map_err(|_| untrusted())? {
            CognitionMemoryOutcome::Unconfigured => "unconfigured",
            CognitionMemoryOutcome::Building => "building",
            CognitionMemoryOutcome::Ready => "ready",
            CognitionMemoryOutcome::NoHits => "no_hits",
            CognitionMemoryOutcome::Unavailable => "unavailable",
            CognitionMemoryOutcome::Failed => "failed",
            CognitionMemoryOutcome::Invalid => "invalid",
            CognitionMemoryOutcome::Pending => "pending",
            CognitionMemoryOutcome::Committed => "committed",
            CognitionMemoryOutcome::Conflict => "conflict",
            CognitionMemoryOutcome::Forgotten => "forgotten",
            CognitionMemoryOutcome::Deleted => "deleted",
            CognitionMemoryOutcome::NoEffect => "no_effect",
            CognitionMemoryOutcome::Admitted => "admitted",
            CognitionMemoryOutcome::Rejected => "rejected",
            _ => return Err(untrusted()),
        },
    )
}

fn project_autonomy(
    projection: LocalAppAgentAutonomyProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    if projection.used_tokens_in_window < 0 {
        return Err(untrusted());
    }
    Ok(json!({
        "enabled": projection.enabled,
        "config": projection.config.map(project_autonomy_config).transpose()?,
        "usedTokensInWindow": projection.used_tokens_in_window,
        "windowStartedAt": projection.window_started_at.map(project_timestamp),
        "budgetExhausted": projection.budget_exhausted,
        "suspendedUntil": projection.suspended_until.map(project_timestamp),
        "autonomyRevision": projection.autonomy_revision.to_string(),
    }))
}

fn project_autonomy_config(
    config: LocalAppAgentAutonomyConfig,
) -> Result<JsonValue, LocalAppOperationError> {
    if config.daily_token_budget < 0 || config.max_tokens_per_hook < 0 {
        return Err(untrusted());
    }
    let mode = match LocalAppAgentAutonomyMode::try_from(config.mode).map_err(|_| untrusted())? {
        LocalAppAgentAutonomyMode::Off => "off",
        LocalAppAgentAutonomyMode::Low => "low",
        LocalAppAgentAutonomyMode::Medium => "medium",
        LocalAppAgentAutonomyMode::High => "high",
        LocalAppAgentAutonomyMode::Unspecified => return Err(untrusted()),
    };
    Ok(json!({
        "dailyTokenBudget": config.daily_token_budget,
        "maxTokensPerHook": config.max_tokens_per_hook,
        "minHookInterval": config.min_hook_interval.map(project_duration),
        "suspendUntil": config.suspend_until.map(project_timestamp),
        "mode": mode,
    }))
}

fn project_presentation(
    projection: LocalAppAgentPresentationProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "profile": project_optional_presentation_profile(projection.profile)?,
        "previousProfile": project_optional_presentation_profile(projection.previous_profile)?,
        "defaultVoiceReference": projection.default_voice_reference,
        "avatarAutoplay": projection.avatar_autoplay,
        "presentationRevision": projection.presentation_revision.to_string(),
    }))
}

fn project_optional_presentation_profile(
    profile: Option<AgentPresentationProfile>,
) -> Result<Option<JsonValue>, LocalAppOperationError> {
    let Some(profile) = profile else {
        return Ok(None);
    };
    project_presentation_profile(profile).map(Some)
}

fn project_presentation_profile(
    profile: AgentPresentationProfile,
) -> Result<JsonValue, LocalAppOperationError> {
    let backend =
        AgentPresentationBackendKind::try_from(profile.backend_kind).map_err(|_| untrusted())?;
    let backend_kind = if backend == AgentPresentationBackendKind::Unspecified {
        if !profile.avatar_asset_ref.is_empty() {
            return Err(untrusted());
        }
        JsonValue::Null
    } else {
        json!(project_backend_kind(profile.backend_kind)?)
    };
    Ok(json!({
        "backendKind": backend_kind,
        "avatarAssetRef": profile.avatar_asset_ref,
        "expressionProfileRef": profile.expression_profile_ref,
        "idlePreset": profile.idle_preset,
        "interactionPolicyRef": profile.interaction_policy_ref,
        "defaultVoiceReference": profile.default_voice_reference,
        "avatarAutoplay": profile.avatar_autoplay,
        "backgroundAssetRef": profile.background_asset_ref,
        "revision": profile.revision.to_string(),
    }))
}

fn project_backend_kind(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentPresentationBackendKind::try_from(value).map_err(|_| untrusted())? {
            AgentPresentationBackendKind::Vrm => "vrm",
            AgentPresentationBackendKind::Live2d => "live2d",
            AgentPresentationBackendKind::Sprite2d => "sprite2d",
            AgentPresentationBackendKind::Canvas2d => "canvas2d",
            AgentPresentationBackendKind::Video => "video",
            AgentPresentationBackendKind::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_timestamp(value: prost_types::Timestamp) -> JsonValue {
    json!({"seconds": value.seconds.to_string(), "nanos": value.nanos})
}

fn project_duration(value: prost_types::Duration) -> JsonValue {
    json!({"seconds": value.seconds.to_string(), "nanos": value.nanos})
}

fn parse_autonomy_intent(
    value: JsonValue,
) -> Result<LocalAppAgentAutonomyIntent, LocalAppOperationError> {
    let object = allowed_object(&value, &["enabled", "config"])?;
    let enabled = match object.get("enabled") {
        Some(JsonValue::Bool(value)) => Some(*value),
        None => None,
        _ => return Err(invalid_payload()),
    };
    let config = match object.get("config") {
        Some(JsonValue::Object(_)) => Some(parse_autonomy_config(
            object.get("config").expect("present"),
        )?),
        None => None,
        _ => return Err(invalid_payload()),
    };
    if enabled.is_none() && config.is_none() {
        return Err(invalid_payload());
    }
    Ok(LocalAppAgentAutonomyIntent { enabled, config })
}

fn parse_autonomy_config(
    value: &JsonValue,
) -> Result<LocalAppAgentAutonomyConfig, LocalAppOperationError> {
    let object = allowed_object(
        value,
        &[
            "dailyTokenBudget",
            "maxTokensPerHook",
            "minHookInterval",
            "suspendUntil",
            "mode",
        ],
    )?;
    let mode = match text(object, "mode")? {
        "off" => LocalAppAgentAutonomyMode::Off,
        "low" => LocalAppAgentAutonomyMode::Low,
        "medium" => LocalAppAgentAutonomyMode::Medium,
        "high" => LocalAppAgentAutonomyMode::High,
        _ => return Err(invalid_payload()),
    };
    Ok(LocalAppAgentAutonomyConfig {
        daily_token_budget: integer(object, "dailyTokenBudget")?,
        max_tokens_per_hook: integer(object, "maxTokensPerHook")?,
        min_hook_interval: optional_duration(object.get("minHookInterval"))?,
        suspend_until: optional_timestamp(object.get("suspendUntil"))?,
        mode: mode as i32,
    })
}

fn parse_presentation_intent(
    value: JsonValue,
) -> Result<LocalAppAgentPresentationIntent, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    let allowed = [
        "backendKind",
        "avatarAssetRef",
        "expressionProfileRef",
        "idlePreset",
        "interactionPolicyRef",
        "defaultVoiceReference",
        "avatarAutoplay",
        "backgroundAssetRef",
    ];
    if object.is_empty() || object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(invalid_payload());
    }
    let backend_kind = match object.get("backendKind") {
        None => None,
        Some(value) => Some(match value.as_str().ok_or_else(invalid_payload)? {
            "vrm" => AgentPresentationBackendKind::Vrm as i32,
            "live2d" => AgentPresentationBackendKind::Live2d as i32,
            "sprite2d" => AgentPresentationBackendKind::Sprite2d as i32,
            "canvas2d" => AgentPresentationBackendKind::Canvas2d as i32,
            "video" => AgentPresentationBackendKind::Video as i32,
            _ => return Err(invalid_payload()),
        }),
    };
    let avatar_autoplay = match object.get("avatarAutoplay") {
        None => None,
        Some(value) => Some(value.as_bool().ok_or_else(invalid_payload)?),
    };
    Ok(LocalAppAgentPresentationIntent {
        patch: Some(AgentPresentationProfilePatch {
            backend_kind,
            avatar_asset_ref: optional_patch_text(object, "avatarAssetRef")?,
            expression_profile_ref: optional_patch_text(object, "expressionProfileRef")?,
            idle_preset: optional_patch_text(object, "idlePreset")?,
            interaction_policy_ref: optional_patch_text(object, "interactionPolicyRef")?,
            default_voice_reference: optional_patch_text(object, "defaultVoiceReference")?,
            avatar_autoplay,
            background_asset_ref: optional_patch_text(object, "backgroundAssetRef")?,
        }),
    })
}

fn optional_patch_text(
    object: &JsonMap<String, JsonValue>,
    key: &str,
) -> Result<Option<String>, LocalAppOperationError> {
    match object.get(key) {
        None => Ok(None),
        Some(value) => {
            let text = value.as_str().ok_or_else(invalid_payload)?;
            if text.trim() != text || text.len() > 512 {
                return Err(invalid_payload());
            }
            Ok(Some(text.to_string()))
        }
    }
}

fn parse_presentation_assets(
    value: JsonValue,
) -> Result<Vec<AgentPresentationAssetMaterial>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.len() > 2 {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            let object = exact_object(
                value,
                &["role", "fileName", "mediaType", "content", "sha256"],
            )?;
            let role = match text(object, "role")? {
                "avatar" => AgentPresentationAssetRole::Avatar,
                "background" => AgentPresentationAssetRole::Background,
                _ => return Err(invalid_payload()),
            };
            let content_values = object
                .get("content")
                .and_then(JsonValue::as_array)
                .ok_or_else(invalid_payload)?;
            if content_values.is_empty() || content_values.len() > 64 * 1024 * 1024 {
                return Err(invalid_payload());
            }
            let content = content_values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .filter(|byte| *byte <= 255)
                        .map(|byte| byte as u8)
                        .ok_or_else(invalid_payload)
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AgentPresentationAssetMaterial {
                role: role as i32,
                file_name: text(object, "fileName")?.to_string(),
                media_type: text(object, "mediaType")?.to_string(),
                content,
                sha256: text(object, "sha256")?.to_string(),
            })
        })
        .collect()
}

fn require_agent_handle(value: &str) -> Result<(), LocalAppOperationError> {
    if value.len() != AGENT_HANDLE_PREFIX.len() + AGENT_HANDLE_SUFFIX_BYTES
        || !value.starts_with(AGENT_HANDLE_PREFIX)
        || !value
            .bytes()
            .skip(AGENT_HANDLE_PREFIX.len())
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn allowed_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a JsonMap<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(invalid_payload());
    }
    Ok(object)
}

fn exact_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a JsonMap<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid_payload());
    }
    Ok(object)
}

fn text<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    let value = optional_text(object, key)?;
    if value.is_empty() {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn optional_text<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    let value = object
        .get(key)
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    if value.trim() != value || value.len() > 512 {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn integer(object: &JsonMap<String, JsonValue>, key: &str) -> Result<i64, LocalAppOperationError> {
    object
        .get(key)
        .and_then(JsonValue::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(invalid_payload)
}

fn optional_timestamp(
    value: Option<&JsonValue>,
) -> Result<Option<prost_types::Timestamp>, LocalAppOperationError> {
    match value {
        None => Ok(None),
        Some(value) => parse_seconds_nanos(value)
            .map(|(seconds, nanos)| Some(prost_types::Timestamp { seconds, nanos })),
    }
}

fn optional_duration(
    value: Option<&JsonValue>,
) -> Result<Option<prost_types::Duration>, LocalAppOperationError> {
    match value {
        None => Ok(None),
        Some(value) => parse_seconds_nanos(value)
            .map(|(seconds, nanos)| Some(prost_types::Duration { seconds, nanos })),
    }
}

fn parse_seconds_nanos(value: &JsonValue) -> Result<(i64, i32), LocalAppOperationError> {
    let object = exact_object(value, &["seconds", "nanos"])?;
    let seconds = object
        .get("seconds")
        .and_then(JsonValue::as_str)
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(invalid_payload)?;
    let nanos = object
        .get("nanos")
        .and_then(JsonValue::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| (0..1_000_000_000).contains(value))
        .ok_or_else(invalid_payload)?;
    Ok((seconds, nanos))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager_action_availability() -> Vec<crate::generated::LocalAppAgentManagerActionAvailability>
    {
        [
            LocalAppAgentManagerProductAction::SharedAiConfigRead,
            LocalAppAgentManagerProductAction::SharedAiConfigWrite,
            LocalAppAgentManagerProductAction::AutonomyRead,
            LocalAppAgentManagerProductAction::AutonomyWrite,
            LocalAppAgentManagerProductAction::MemoryInspect,
            LocalAppAgentManagerProductAction::MemoryCorrect,
            LocalAppAgentManagerProductAction::MemoryForget,
            LocalAppAgentManagerProductAction::MemorySwitch,
            LocalAppAgentManagerProductAction::MemoryDelete,
            LocalAppAgentManagerProductAction::AppearanceCommit,
            LocalAppAgentManagerProductAction::AppearanceRestore,
        ]
        .into_iter()
        .map(
            |action| crate::generated::LocalAppAgentManagerActionAvailability {
                action: action as i32,
                state: if action == LocalAppAgentManagerProductAction::AppearanceRestore {
                    LocalAppAgentManagerActionAvailabilityState::Unavailable as i32
                } else {
                    LocalAppAgentManagerActionAvailabilityState::Available as i32
                },
                reason: if action == LocalAppAgentManagerProductAction::AppearanceRestore {
                    LocalAppAgentManagerActionUnavailableReason::PreviousPresentationUnavailable
                        as i32
                } else {
                    LocalAppAgentManagerActionUnavailableReason::None as i32
                },
            },
        )
        .collect()
    }

    #[test]
    fn manager_action_availability_requires_exact_complete_owner_rows() {
        let valid = manager_action_availability();
        let projected = project_manager_action_availability(valid.clone())
            .expect("complete owner availability");
        assert_eq!(projected.as_object().map(JsonMap::len), Some(11));
        assert_eq!(projected["getSharedAIConfig"]["state"], "available");
        assert!(projected["getSharedAIConfig"]["reason"].is_null());
        assert_eq!(
            projected["restorePreviousAppearance"]["reason"],
            "previous-presentation-unavailable"
        );

        let mut duplicate = valid.clone();
        duplicate[10].action = duplicate[0].action;
        let mut unknown = valid.clone();
        unknown[0].action = i32::MAX;
        let mut mismatched = valid.clone();
        mismatched[0].reason = LocalAppAgentManagerActionUnavailableReason::OwnerUnavailable as i32;
        let mut unavailable_without_reason = valid.clone();
        unavailable_without_reason[0].state =
            LocalAppAgentManagerActionAvailabilityState::Unavailable as i32;
        for malformed in [
            valid[..10].to_vec(),
            duplicate,
            unknown,
            mismatched,
            unavailable_without_reason,
        ] {
            assert!(project_manager_action_availability(malformed).is_err());
        }
    }

    #[test]
    fn memory_pagination_is_bounded_and_opaque() {
        for (limit, page_token) in [(1, ""), (100, "opaque-page-2")] {
            assert!(require_memory_page(limit, page_token).is_ok());
        }
        for (limit, page_token) in [(0, ""), (101, ""), (1, " bad "), (1, "bad\npage")] {
            assert!(require_memory_page(limit, page_token).is_err());
        }
        assert!(require_memory_page(1, &"x".repeat(1025)).is_err());
    }

    #[test]
    fn memory_projection_preserves_opaque_next_token_and_rejects_forgotten_content() {
        let projection = project_memory(crate::generated::AgentMemoryProjection {
            outcome: CognitionMemoryOutcome::Ready as i32,
            enabled: true,
            adoption_required: false,
            items: Vec::new(),
            current_count: 2,
            superseded_count: 0,
            forgotten_count: 1,
            next_page_token: "opaque-page-2".to_string(),
        })
        .expect("bounded Memory projection");
        assert_eq!(projection["nextPageToken"], "opaque-page-2");

        let forgotten = crate::generated::AgentMemoryProjection {
            outcome: CognitionMemoryOutcome::Ready as i32,
            enabled: true,
            adoption_required: false,
            items: vec![crate::generated::AgentMemoryItem {
                memory_id: "memory-forgotten".to_string(),
                content: "private original".to_string(),
                epistemic_status: CognitionMemoryEpistemicStatus::Explicit as i32,
                lifecycle: CognitionMemoryLifecycle::Forgotten as i32,
                occurred_at: Some(prost_types::Timestamp {
                    seconds: 1,
                    nanos: 0,
                }),
                updated_at: Some(prost_types::Timestamp {
                    seconds: 1,
                    nanos: 0,
                }),
                source_explanation: "committed fact".to_string(),
            }],
            current_count: 0,
            superseded_count: 0,
            forgotten_count: 1,
            next_page_token: String::new(),
        };
        assert!(project_memory(forgotten).is_err());
    }

    #[test]
    fn manager_snapshot_projects_only_bounded_camel_case_status() {
        let projected = project_manager_snapshot(crate::generated::LocalAppAgentManagerSnapshot {
            lifecycle_status: AgentLifecycleStatus::Active as i32,
            execution_state: AgentExecutionState::ChatActive as i32,
            status_text: "available".to_string(),
            current_emotion: "focused".to_string(),
            source: Some(crate::generated::LocalAppAgentManagerSourceProjection {
                ready: true,
                state: AgentLocalSourceContextState::Ready as i32,
                reason_code: AgentContextProjectionReasonCode::None as i32,
                captured_at: Some(prost_types::Timestamp {
                    seconds: 42,
                    nanos: 7,
                }),
                coverage_sections: vec![crate::generated::LocalAgentSourceCoverageSectionStatus {
                    section: AgentLocalSourceCoverageSection::Identity as i32,
                    state: AgentLocalSourceCoverageState::Complete as i32,
                    required_count: 1,
                    resolved_count: 1,
                    omitted_count: 0,
                }],
                lorebook_ready: true,
                lorebook_item_count: 2,
                lorebook_estimated_tokens: u64::MAX,
            }),
            context: Some(crate::generated::LocalAppAgentManagerContextProjection {
                ready: true,
                state: AgentTurnContextState::Ready as i32,
                reason_code: AgentContextProjectionReasonCode::None as i32,
                lanes: vec![crate::generated::AgentTurnContextLaneSummary {
                    lane_id: AgentTurnContextLaneId::CanonicalMemory as i32,
                    state: AgentTurnContextLaneState::Included as i32,
                    included_item_count: 1,
                    omitted_item_count: 0,
                    truncated_item_count: 0,
                    allocated_tokens: u64::MAX,
                    used_tokens: 8,
                }],
                input_budget_tokens: u64::MAX,
                used_tokens: 8,
                required_input_tokens: 9,
                required_context_window_tokens: 10,
                truncation: vec![crate::generated::AgentTurnContextTruncationSummary {
                    reason: AgentTurnContextTruncationReason::None as i32,
                    omitted_item_count: 0,
                    truncated_item_count: 0,
                }],
                transcript_turn_count: 3,
                memory_item_count: 1,
                media_count: 0,
                tool_count: 0,
                source_adapter_status: AgentSourceCognitionStatus::Ready as i32,
                source_selection_status: AgentSourceCognitionStatus::NoHits as i32,
                conversation_summary_status: AgentConversationSummaryStatus::Absent as i32,
                private_recall_count: 1,
            }),
            action_availability: manager_action_availability(),
        })
        .expect("bounded manager snapshot");

        assert_eq!(projected["lifecycleStatus"], "active");
        assert_eq!(projected["executionState"], "chat-active");
        assert_eq!(projected["source"]["capturedAt"]["seconds"], "42");
        assert_eq!(
            projected["source"]["lorebookEstimatedTokens"],
            u64::MAX.to_string()
        );
        assert_eq!(
            projected["context"]["lanes"][0]["laneId"],
            "canonical_memory"
        );
        assert_eq!(
            projected["context"]["inputBudgetTokens"],
            u64::MAX.to_string()
        );
        assert_eq!(
            projected["actionAvailability"]
                .as_object()
                .map(JsonMap::len),
            Some(11)
        );
        assert_eq!(projected.as_object().map(|record| record.len()), Some(7));
        let serialized = projected.to_string();
        for forbidden in [
            "localAgentRef",
            "ownerUserId",
            "prompt",
            "provider",
            "model",
            "storage",
            "generation",
            "score",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn fresh_presentation_projection_keeps_previous_profile_and_decimal_revision() {
        let projected = project_presentation(LocalAppAgentPresentationProjection {
            profile: None,
            previous_profile: None,
            default_voice_reference: String::new(),
            presentation_revision: 0,
            avatar_autoplay: false,
        })
        .expect("fresh presentation projection");
        assert_eq!(projected["presentationRevision"], "0");
        assert!(projected["profile"].is_null());
        assert!(projected["previousProfile"].is_null());
        assert_eq!(projected["avatarAutoplay"], false);
        assert_eq!(projected.as_object().map(|record| record.len()), Some(5));
    }

    #[test]
    fn voice_only_profile_projects_nullable_backend_and_patch_presence() {
        let projected = project_presentation(LocalAppAgentPresentationProjection {
            profile: Some(AgentPresentationProfile {
                backend_kind: AgentPresentationBackendKind::Unspecified as i32,
                avatar_asset_ref: String::new(),
                expression_profile_ref: String::new(),
                idle_preset: String::new(),
                interaction_policy_ref: String::new(),
                default_voice_reference: "preset_voice_id:serena".to_string(),
                avatar_autoplay: true,
                background_asset_ref: String::new(),
                revision: 1,
            }),
            previous_profile: None,
            default_voice_reference: "preset_voice_id:serena".to_string(),
            presentation_revision: 1,
            avatar_autoplay: true,
        })
        .expect("voice-only presentation projection");
        assert!(projected["profile"]["backendKind"].is_null());
        assert_eq!(
            projected["profile"]["defaultVoiceReference"],
            "preset_voice_id:serena"
        );
        assert_eq!(projected["avatarAutoplay"], true);

        let intent = parse_presentation_intent(serde_json::json!({
            "defaultVoiceReference": "preset_voice_id:serena",
            "avatarAutoplay": false
        }))
        .expect("voice-only presentation patch");
        let patch = intent.patch.expect("canonical presentation patch");
        assert!(patch.backend_kind.is_none());
        assert_eq!(
            patch.default_voice_reference.as_deref(),
            Some("preset_voice_id:serena")
        );
        assert_eq!(patch.avatar_autoplay, Some(false));
    }

    #[test]
    fn imported_assets_cross_the_native_boundary_as_owned_bytes() {
        let assets = parse_presentation_assets(serde_json::json!([{
            "role": "avatar",
            "fileName": "avatar.vrm",
            "mediaType": "model/gltf-binary",
            "content": [1, 2, 255],
            "sha256": "abc123"
        }]))
        .expect("imported presentation asset");
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].role, AgentPresentationAssetRole::Avatar as i32);
        assert_eq!(assets[0].content, vec![1, 2, 255]);
    }
}
