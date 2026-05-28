package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// publicChatFollowUpState is post-turn runtime-owned follow-up bookkeeping.
// Per K-AGCORE-034 it is bound to a ConversationAnchor; continuity is via
// `ConversationAnchorID`, never a freestanding session identity.
type publicChatFollowUpState struct {
	FollowUpID           string
	ConversationAnchorID string
	AgentID              string
	CallerAppID          string
	SubjectUserID        string
	ThreadID             string
	Instruction          string
	ScheduledFor         time.Time
	ChainID              string
	FollowUpDepth        int
	MaxFollowUpTurns     int
	SourceTurnID         string
	SourceActionID       string
	HookIntent           *runtimev1.HookIntent
	Context              context.Context
	Cancel               context.CancelFunc
	Armed                bool
}

type publicChatFollowUpOutcome struct {
	Status           string
	FollowUpID       string
	ChainID          string
	ScheduledFor     string
	FollowUpDepth    int
	MaxFollowUpTurns int
	SourceTurnID     string
	SourceActionID   string
	ReasonCode       runtimev1.ReasonCode
	ActionHint       string
	Message          string
}

func (o publicChatFollowUpOutcome) payload() map[string]any {
	payload := map[string]any{
		"status":              o.Status,
		"follow_up_depth":     o.FollowUpDepth,
		"max_follow_up_turns": o.MaxFollowUpTurns,
	}
	if strings.TrimSpace(o.FollowUpID) != "" {
		payload["follow_up_id"] = strings.TrimSpace(o.FollowUpID)
	}
	if strings.TrimSpace(o.ChainID) != "" {
		payload["chain_id"] = strings.TrimSpace(o.ChainID)
	}
	if strings.TrimSpace(o.ScheduledFor) != "" {
		payload["scheduled_for"] = strings.TrimSpace(o.ScheduledFor)
	}
	if strings.TrimSpace(o.SourceTurnID) != "" {
		payload["source_turn_id"] = strings.TrimSpace(o.SourceTurnID)
	}
	if strings.TrimSpace(o.SourceActionID) != "" {
		payload["source_action_id"] = strings.TrimSpace(o.SourceActionID)
	}
	if o.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(o.ReasonCode)
	}
	if strings.TrimSpace(o.ActionHint) != "" {
		payload["action_hint"] = strings.TrimSpace(o.ActionHint)
	}
	if strings.TrimSpace(o.Message) != "" {
		payload["message"] = strings.TrimSpace(o.Message)
	}
	return payload
}

// publicChatAcceptedDetail builds the
// `runtime.agent.turn.accepted.detail` payload per yaml. Only `request_id`
// is admitted on the detail; transcript/binding/session_status etc. are
// session-level execution truth and live exclusively on the unary public chat
// session snapshot payload. RequestID is the
// inbound `runtime.agent.turn.request` message id (or, for follow-up
// turns, the runtime-owned follow-up id) — when neither is available we
// emit `{}` rather than fabricating one.
func publicChatAcceptedDetail(requestID string) map[string]any {
	out := map[string]any{}
	if trimmed := strings.TrimSpace(requestID); trimmed != "" {
		out["request_id"] = trimmed
	}
	return out
}

// publicChatPostTurnIndicationDetail scrubs the `turn.post_turn.detail`
// down to the mounted indication-only shape: `action?` (the modeled
// action selected at turn-close, when present) and `hook_intent?` (a
// turn-close indication; canonical hook lifecycle is on
// `runtime.agent.hook.*`). Runtime execution truth (assistant_memory,
// chat_sidecar, follow_up scheduling) is NOT carried here; consumers recover
// it from the unary public chat session snapshot `last_turn`.
func publicChatPostTurnIndicationDetail(structured *publicChatStructuredEnvelope, followUp publicChatFollowUpOutcome) map[string]any {
	out := map[string]any{}
	action := firstPublicChatTopLevelAction(structured)
	if action != nil {
		out["action"] = map[string]any{
			"action_id":   action.ActionID,
			"modality":    action.Modality,
			"operation":   action.Operation,
			"action_cue":  publicChatStatusCueActionLabel(structured),
			"source_kind": "structured_action",
		}
	}
	if hookIntent := publicChatHookIntentIndication(structured, followUp); hookIntent != nil {
		out["hook_intent"] = hookIntent
	}
	return out
}

func firstPublicChatTopLevelAction(structured *publicChatStructuredEnvelope) *publicChatStructuredAction {
	if structured == nil {
		return nil
	}
	for index := range structured.Actions {
		action := &structured.Actions[index]
		if strings.TrimSpace(action.ActionID) == "" {
			continue
		}
		switch strings.TrimSpace(action.Modality) {
		case "image", "voice":
		default:
			continue
		}
		return action
	}
	return nil
}

func publicChatStatusCueActionLabel(structured *publicChatStructuredEnvelope) string {
	if structured == nil || structured.StatusCue == nil {
		return ""
	}
	return strings.TrimSpace(structured.StatusCue.ActionCue)
}

// publicChatTurnCompletedDetail projects yaml `turn.completed.detail`
// admitting only `terminal_reason?`. The terminal reason mirrors the
// committed finish reason when one is observed. Runtime execution truth
// (usage, finish_reason, stream_simulated, model/route resolution) is
// recovered through session.snapshot only.
func publicChatTurnCompletedDetail(finish runtimev1.FinishReason) map[string]any {
	out := map[string]any{}
	if finish != runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		out["terminal_reason"] = publicChatFinishReasonLabel(finish)
	}
	return out
}

// setPublicChatTurnRequestID records the upstream request id onto
// runtime-owned turn state so subsequent `accepted` emissions can
// surface it on `accepted.detail.request_id` per yaml.
func (s *Service) setPublicChatTurnRequestID(turnID string, requestID string) {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		return
	}
	turn.RequestID = strings.TrimSpace(requestID)
}

func clonePublicChatReasoningConfig(input *publicChatReasoningConfig) *publicChatReasoningConfig {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}

func publicChatReasoningPayloadFromConfig(input *publicChatReasoningConfig) *publicChatReasoningPayload {
	if input == nil {
		return nil
	}
	return &publicChatReasoningPayload{
		Mode:         strings.ToLower(strings.TrimPrefix(input.Mode.String(), "REASONING_MODE_")),
		TraceMode:    strings.ToLower(strings.TrimPrefix(input.TraceMode.String(), "REASONING_TRACE_MODE_")),
		BudgetTokens: input.BudgetTokens,
	}
}

func publicChatMessagePayloadsFromProto(input []*runtimev1.ChatMessage) []publicChatMessagePayload {
	out := make([]publicChatMessagePayload, 0, len(input))
	for _, item := range input {
		if item == nil {
			continue
		}
		role := strings.TrimSpace(item.GetRole())
		content := strings.TrimSpace(item.GetContent())
		if role == "" || content == "" {
			continue
		}
		out = append(out, publicChatMessagePayload{
			Role:    role,
			Content: content,
			Name:    strings.TrimSpace(item.GetName()),
		})
	}
	return out
}

func publicChatTranscriptMessageID(anchorID string, index int) string {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedAnchorID == "" {
		trimmedAnchorID = "runtime-agent-session"
	}
	return fmt.Sprintf("%s:transcript:%d", trimmedAnchorID, index)
}

func publicChatTranscriptMessageTimestamp(createdAt time.Time, updatedAt time.Time, index int) string {
	base := createdAt.UTC()
	if base.IsZero() {
		base = updatedAt.UTC()
	}
	if base.IsZero() {
		base = time.Unix(0, 0).UTC()
	}
	return base.Add(time.Duration(index) * time.Millisecond).Format(time.RFC3339Nano)
}

func publicChatMessageEnvelopePayloads(input []*runtimev1.ChatMessage, anchorID string, createdAt time.Time, updatedAt time.Time) []any {
	payloads := publicChatMessagePayloadsFromProto(input)
	out := make([]any, 0, len(payloads))
	for index, item := range payloads {
		timestamp := publicChatTranscriptMessageTimestamp(createdAt, updatedAt, index)
		out = append(out, map[string]any{
			"id":         publicChatTranscriptMessageID(anchorID, index),
			"role":       item.Role,
			"content":    item.Content,
			"name":       item.Name,
			"status":     "complete",
			"kind":       "text",
			"created_at": timestamp,
			"updated_at": timestamp,
		})
	}
	return out
}

func (s *Service) appendPublicChatAssistantMessage(anchorID string, assistantText string) {
	if strings.TrimSpace(anchorID) == "" || strings.TrimSpace(assistantText) == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	session.Transcript = appendPublicChatAssistantTranscript(session.Transcript, assistantText)
	session.UpdatedAt = time.Now().UTC()
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
}

func (s *Service) publicChatAnchorSnapshot(anchorID string) (publicChatAnchorState, bool) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		return publicChatAnchorState{}, false
	}
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.Transcript = cloneChatMessages(session.Transcript)
	return snapshot, true
}

func (s *Service) setPublicChatStoredFollowUpOutcome(anchorID string, sourceTurnID string, outcome publicChatFollowUpOutcome) {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	trimmedSourceTurnID := strings.TrimSpace(sourceTurnID)
	if trimmedAnchorID == "" || trimmedSourceTurnID == "" {
		return
	}
	changed := false
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[trimmedAnchorID]
	if session != nil {
		for _, snapshot := range []*publicChatTurnProjectionState{session.ActiveTurnSnapshot, session.LastTurnSnapshot} {
			if snapshot == nil || strings.TrimSpace(snapshot.TurnID) != trimmedSourceTurnID {
				continue
			}
			snapshot.FollowUp = clonePublicChatFollowUpOutcome(&outcome)
			snapshot.UpdatedAt = time.Now().UTC()
			changed = true
		}
	}
	s.chatSurfaceMu.Unlock()
	if changed {
		s.persistCurrentPublicChatSurfaceState()
	}
}

func (s *Service) setPublicChatAnchorBaseSystemPrompt(anchorID string, systemPrompt string) {
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	session.SystemPrompt = strings.TrimSpace(systemPrompt)
	session.UpdatedAt = time.Now().UTC()
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
}

func buildPublicChatFollowUpSystemPrompt(base string, instruction string, depth int, maxTurns int) string {
	followUpInstruction := strings.TrimSpace(instruction)
	if followUpInstruction == "" {
		return strings.TrimSpace(base)
	}
	sections := make([]string, 0, 2)
	if trimmed := strings.TrimSpace(base); trimmed != "" {
		sections = append(sections, trimmed)
	}
	sections = append(sections, fmt.Sprintf(
		"FollowUpInstruction:\n%s\n\nTreat this as an internal continuation cue, not a new user message. Continue naturally from the latest assistant turn. Add only net-new content. Do not restate the previous assistant reply. The current follow-up depth is %d of %d. If no natural continuation is needed, return an empty actions array and do not repeat the prior message.",
		followUpInstruction,
		depth,
		maxTurns,
	))
	return strings.Join(sections, "\n\n")
}
