package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (r publicChatRuntime) applyPostTurn(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	structured *publicChatStructuredEnvelope,
) publicChatPostTurnOutcome {
	totalStartedAt := time.Now()
	outcome := publicChatPostTurnOutcome{
		AssistantMemory: publicChatAssistantMemoryOutcome{Status: "skipped"},
		Sidecar:         publicChatSidecarOutcome{Status: "skipped"},
		FollowUp:        publicChatFollowUpOutcome{Status: "skipped"},
	}
	if structured == nil {
		return outcome
	}
	assistantText := strings.TrimSpace(structured.Message.Text)
	if strings.TrimSpace(assistantText) == "" {
		return outcome
	}
	r.svc.appendPublicChatAssistantMessage(session.ConversationAnchorID, assistantText)
	memoryStartedAt := time.Now()
	outcome.AssistantMemory = r.applyAssistantTurnMemory(ctx, session, turn, assistantText)
	r.svc.observeCounter("runtime_agent_post_turn_memory_write_total", 1,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"status", outcome.AssistantMemory.Status,
	)
	r.svc.observeLatency("runtime.agent.turn.post_turn_memory_ms", memoryStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"status", outcome.AssistantMemory.Status,
	)
	sidecarStartedAt := time.Now()
	summary, err := r.svc.executeChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       session.AgentID,
		SourceEventID: turn.TurnID,
		Messages: append(
			toProtoPublicChatMessages(req.Messages),
			&runtimev1.ChatMessage{
				Role:    "assistant",
				Content: assistantText,
			},
		),
	})
	if err != nil {
		outcome.Sidecar = publicChatSidecarOutcome{
			Status:     "failed",
			ReasonCode: reasonCodeFromError(err),
			Message:    strings.TrimSpace(err.Error()),
		}
	} else if summary == nil {
		outcome.Sidecar = publicChatSidecarOutcome{Status: "skipped"}
	} else {
		outcome.Sidecar = publicChatSidecarOutcome{
			Status:              "applied",
			AcceptedMemoryCount: summary.AcceptedMemoryCount,
			CanceledHookIDs:     append([]string(nil), summary.CanceledHookIDs...),
			ScheduledHookID:     summary.ScheduledHookID,
			StatusText:          summary.StatusText,
		}
	}
	r.svc.observeCounter("runtime_agent_post_turn_sidecar_total", 1,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"status", outcome.Sidecar.Status,
	)
	r.svc.observeLatency("runtime.agent.turn.post_turn_sidecar_ms", sidecarStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"status", outcome.Sidecar.Status,
	)
	followUpStartedAt := time.Now()
	outcome.FollowUp = r.svc.schedulePublicChatFollowUp(session, turn, req, structured)
	r.svc.observeCounter("runtime_agent_post_turn_follow_up_total", 1,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"status", outcome.FollowUp.Status,
	)
	r.svc.observeLatency("runtime.agent.turn.post_turn_follow_up_ms", followUpStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"status", outcome.FollowUp.Status,
	)
	r.svc.observeLatency("runtime.agent.turn.post_turn_total_ms", totalStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"memory_status", outcome.AssistantMemory.Status,
		"sidecar_status", outcome.Sidecar.Status,
		"follow_up_status", outcome.FollowUp.Status,
	)
	return outcome
}
func (r publicChatRuntime) applyAssistantTurnMemory(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	assistantText string,
) publicChatAssistantMemoryOutcome {
	entry, err := r.svc.agentByID(session.AgentID)
	if err != nil {
		return publicChatAssistantMemoryOutcome{
			Status:     "failed",
			ReasonCode: reasonCodeFromError(err),
			Message:    strings.TrimSpace(err.Error()),
		}
	}
	userID := firstNonEmpty(session.SubjectUserID, entry.State.GetActiveUserId())
	if userID == "" || strings.TrimSpace(assistantText) == "" {
		return publicChatAssistantMemoryOutcome{Status: "skipped"}
	}
	now := time.Now().UTC()
	resp, err := r.svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: session.AgentID,
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{
							AgentId: session.AgentID,
							UserId:  userID,
						},
					},
				},
				SourceEventId: turn.TurnID,
				PolicyReason:  publicChatAssistantMemoryPolicy,
				Extensions:    publicChatAssistantMemoryPromotionEvidence(session, turn),
				Record: &runtimev1.MemoryRecordInput{
					Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
					Provenance: &runtimev1.MemoryProvenance{
						SourceSystem:  publicChatAssistantMemorySource,
						SourceEventId: turn.TurnID,
						AuthorId:      session.AgentID,
						TraceId:       session.ThreadID,
						CommittedAt:   timestamppb.New(now),
					},
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: strings.TrimSpace(assistantText),
							ObservedAt:  timestamppb.New(now),
							SourceRef:   session.ThreadID,
						},
					},
				},
			},
		},
	})
	if err != nil {
		return publicChatAssistantMemoryOutcome{
			Status:     "failed",
			ReasonCode: reasonCodeFromError(err),
			Message:    strings.TrimSpace(err.Error()),
		}
	}
	outcome := publicChatAssistantMemoryOutcome{
		Status:        "applied",
		AcceptedCount: len(resp.GetAccepted()),
		RejectedCount: len(resp.GetRejected()),
	}
	if len(resp.GetAccepted()) == 0 && len(resp.GetRejected()) > 0 {
		outcome.Status = "rejected"
		outcome.ReasonCode = resp.GetRejected()[0].GetReasonCode()
		outcome.Message = strings.TrimSpace(resp.GetRejected()[0].GetMessage())
	}
	return outcome
}

func publicChatAssistantMemoryPromotionEvidence(session publicChatAnchorState, turn publicChatTurnState) *structpb.Struct {
	out, err := structpb.NewStruct(map[string]any{
		"promotion_target_id":                 "RUNTIME_MEMORY_OR_COGNITION",
		"participation_id":                    firstNonEmpty(turn.ChainID, session.ConversationAnchorID),
		"source_profile":                      "realm_group_agent",
		"output_candidate_ref":                firstNonEmpty(turn.TurnID, turn.RequestID),
		"audit_id":                            firstNonEmpty(turn.LastKnownTraceID, turn.StreamID, turn.TurnID),
		"provenance_ref":                      firstNonEmpty(turn.StreamID, turn.TurnID),
		"policy_verdict_ref":                  publicChatAssistantMemoryPolicy,
		"memory_read_verdict":                 "PASS",
		"memory_write_verdict":                "PASS",
		"capability_scope_verdict":            "PASS",
		"target_owner_authorization_ref":      firstNonEmpty(session.SubjectUserID, session.CallerAppID),
		"explicit_user_or_manager_intent_ref": firstNonEmpty(turn.RequestID, turn.TurnID),
	})
	if err != nil {
		return nil
	}
	return out
}
