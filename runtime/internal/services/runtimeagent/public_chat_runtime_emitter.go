package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func (r publicChatRuntime) emitTurnEvent(session publicChatAnchorState, turnID string, messageType string, detail map[string]any) error {
	trimmedTurnID := strings.TrimSpace(turnID)
	streamID := r.svc.publicChatTurnStreamID(trimmedTurnID)
	if streamID == "" {
		// Stream identity must be real per K-AGCORE-030; if lookup fails we
		// fail-closed rather than fabricate stream_id from turn_id.
		return status.Error(codes.FailedPrecondition, "runtime.agent.turn.* stream identity unavailable")
	}
	sequence := r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	timeline, err := r.svc.publicChatTurnTimelineEnvelope(trimmedTurnID, messageType, sequence, time.Now())
	if err != nil {
		return err
	}
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
		"timeline":               timeline,
	}
	if detail == nil {
		out["detail"] = map[string]any{}
	} else {
		out["detail"] = detail
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, messageType, out)
}

// emitTurnMessageCommitted emits runtime.agent.turn.message_committed with
// the required `message_id` envelope extra (per
// runtime-agent-event-projection.yaml `extra_fields_by_event`) plus the
// committed message detail (`message_id`, `text`).
func (r publicChatRuntime) emitTurnMessageCommitted(session publicChatAnchorState, turnID string, messageID string, text string) error {
	trimmedTurnID := strings.TrimSpace(turnID)
	trimmedMessageID := strings.TrimSpace(messageID)
	if trimmedMessageID == "" {
		return status.Error(codes.FailedPrecondition, "runtime.agent.turn.message_committed requires message_id")
	}
	streamID := r.svc.publicChatTurnStreamID(trimmedTurnID)
	if streamID == "" {
		return status.Error(codes.FailedPrecondition, "runtime.agent.turn.* stream identity unavailable")
	}
	sequence := r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	timeline, err := r.svc.publicChatTurnTimelineEnvelope(trimmedTurnID, publicChatTurnMessageCommittedType, sequence, time.Now())
	if err != nil {
		return err
	}
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
		"message_id":             trimmedMessageID,
		"timeline":               timeline,
		"detail": map[string]any{
			"message_id": trimmedMessageID,
			"text":       strings.TrimSpace(text),
		},
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, publicChatTurnMessageCommittedType, out)
}
func (r publicChatRuntime) emitEvent(callerAppID string, subjectUserID string, messageType string, payload map[string]any) error {
	if r.svc == nil || r.svc.isClosed() {
		return nil
	}
	r.svc.chatSurfaceMu.Lock()
	emitter := r.svc.chatAppEmit
	r.svc.chatSurfaceMu.Unlock()
	if emitter == nil {
		return fmt.Errorf("runtime public chat app emitter unavailable")
	}
	structPayload, err := structpb.NewStruct(payload)
	if err != nil {
		return err
	}
	_, err = emitter(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     publicChatRuntimeAppID,
		ToAppId:       strings.TrimSpace(callerAppID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		MessageType:   strings.TrimSpace(messageType),
		Payload:       structPayload,
	})
	return err
}
func (r publicChatRuntime) shutdownSurface() {
	r.svc.chatSurfaceMu.Lock()
	turns := make([]*publicChatTurnState, 0, len(r.svc.chatTurns))
	for _, turn := range r.svc.chatTurns {
		if turn != nil {
			turns = append(turns, turn)
		}
	}
	followUps := make([]*publicChatFollowUpState, 0, len(r.svc.chatFollowUps))
	for _, followUp := range r.svc.chatFollowUps {
		if followUp != nil {
			followUps = append(followUps, followUp)
		}
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.setPublicChatTurnExecutor(nil)
	for _, turn := range turns {
		if turn.Cancel != nil {
			turn.Cancel()
		}
	}
	for _, followUp := range followUps {
		if followUp.Cancel != nil {
			followUp.Cancel()
		}
	}
	r.svc.chatAsyncWG.Wait()
	r.svc.chatSurfaceMu.Lock()
	r.svc.chatAppEmit = nil
	r.svc.chatSurfaceMu.Unlock()
}
