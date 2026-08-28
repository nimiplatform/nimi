package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		Sidecar:  publicChatSidecarOutcome{Status: "skipped"},
		FollowUp: publicChatFollowUpOutcome{Status: "skipped"},
	}
	if structured == nil {
		return outcome
	}
	assistantText := strings.TrimSpace(structured.Message.Text)
	if strings.TrimSpace(assistantText) == "" {
		return outcome
	}
	sidecarStartedAt := time.Now()
	summary, err := r.svc.executeChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		CallerAppID:   session.CallerAppID,
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
			Status:          "applied",
			CanceledHookIDs: append([]string(nil), summary.CanceledHookIDs...),
			ScheduledHookID: summary.ScheduledHookID,
			StatusText:      summary.StatusText,
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
		"sidecar_status", outcome.Sidecar.Status,
		"follow_up_status", outcome.FollowUp.Status,
	)
	return outcome
}
