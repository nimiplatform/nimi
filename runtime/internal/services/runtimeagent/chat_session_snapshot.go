package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	publicChatTurnStatusAccepted    = "accepted"
	publicChatTurnStatusStarted     = "started"
	publicChatTurnStatusStreaming   = "streaming"
	publicChatTurnStatusCompleted   = "completed"
	publicChatTurnStatusFailed      = "failed"
	publicChatTurnStatusInterrupted = "interrupted"
)

type publicChatTurnProjectionState struct {
	TurnID            string
	StreamID          string
	Status            string
	TraceID           string
	StreamSequence    uint64
	TimelineStartedAt time.Time
	Origin            string
	ChainID           string
	FollowUpDepth     int
	MaxFollowUpTurns  int
	SourceTurnID      string
	SourceActionID    string
	ModelResolved     string
	RouteDecision     runtimev1.RoutePolicy
	OutputObserved    bool
	ReasoningObserved bool
	MessageID         string
	AssistantText     string
	Structured        *publicChatStructuredEnvelope
	AssistantMemory   *publicChatAssistantMemoryOutcome
	Sidecar           *publicChatSidecarOutcome
	FollowUp          *publicChatFollowUpOutcome
	ContextSummary    *runtimev1.AgentTurnContextSummary
	FinishReason      string
	StreamSimulated   bool
	Usage             *runtimev1.UsageStats
	ReasonCode        runtimev1.ReasonCode
	ActionHint        string
	Message           string
	UpdatedAt         time.Time
}

func newPublicChatTurnProjection(turn *publicChatTurnState) *publicChatTurnProjectionState {
	if turn == nil {
		return nil
	}
	return &publicChatTurnProjectionState{
		TurnID:            turn.TurnID,
		StreamID:          turn.StreamID,
		Status:            publicChatTurnStatusAccepted,
		TimelineStartedAt: turn.TimelineStartedAt,
		Origin:            firstNonEmpty(strings.TrimSpace(turn.Origin), publicChatTurnOriginUser),
		ChainID:           strings.TrimSpace(turn.ChainID),
		FollowUpDepth:     turn.FollowUpDepth,
		MaxFollowUpTurns:  turn.MaxFollowUpTurns,
		SourceTurnID:      strings.TrimSpace(turn.SourceTurnID),
		SourceActionID:    strings.TrimSpace(turn.SourceActionID),
		UpdatedAt:         time.Now().UTC(),
	}
}

func clonePublicChatTurnProjectionState(input *publicChatTurnProjectionState) *publicChatTurnProjectionState {
	if input == nil {
		return nil
	}
	out := *input
	out.Structured = clonePublicChatStructuredEnvelope(input.Structured)
	out.AssistantMemory = clonePublicChatAssistantMemoryOutcome(input.AssistantMemory)
	out.Sidecar = clonePublicChatSidecarOutcome(input.Sidecar)
	out.FollowUp = clonePublicChatFollowUpOutcome(input.FollowUp)
	out.ContextSummary = cloneAgentTurnContextSummary(input.ContextSummary)
	if input.Usage != nil {
		out.Usage = proto.Clone(input.Usage).(*runtimev1.UsageStats)
	}
	return &out
}

func cloneAgentTurnContextSummary(input *runtimev1.AgentTurnContextSummary) *runtimev1.AgentTurnContextSummary {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentTurnContextSummary)
}

// commitPublicChatTurnTranscript appends the current user message and its
// committed assistant response as one Runtime-owned transcript turn.
// Request-carried history is never admitted here.
func (s *Service) commitPublicChatTurnTranscript(anchorID string, currentUser *runtimev1.ChatMessage, assistantText string) error {
	return s.commitPublicChatTurnTranscriptForTurn(anchorID, "", currentUser, assistantText)
}

func (s *Service) commitPublicChatTurnTranscriptForTurn(anchorID string, turnID string, currentUser *runtimev1.ChatMessage, assistantText string) error {
	return s.commitPublicChatTurnTranscriptForTurnWithProjection(context.Background(), anchorID, turnID, currentUser, assistantText, nil)
}

func (s *Service) commitPublicChatTurnTranscriptForTurnWithProjection(
	commitContext context.Context,
	anchorID string,
	turnID string,
	currentUser *runtimev1.ChatMessage,
	assistantText string,
	finalizeProjection func(*publicChatTurnProjectionState),
) error {
	if strings.TrimSpace(anchorID) == "" || !validRuntimeOwnedCurrentUserMessage(currentUser) || strings.TrimSpace(assistantText) == "" {
		return status.Error(codes.InvalidArgument, "committed transcript requires anchor, current user, and assistant text")
	}
	return s.commitPublicChatTranscriptTurn(
		commitContext,
		anchorID,
		turnID,
		publicChatTurnOriginUser,
		currentUser.GetContent(),
		assistantText,
		finalizeProjection,
	)
}

func (s *Service) commitPublicChatFollowUpTranscript(anchorID string, turnID string, instruction string, assistantText string) error {
	return s.commitPublicChatFollowUpTranscriptWithProjection(context.Background(), anchorID, turnID, instruction, assistantText, nil)
}

func (s *Service) commitPublicChatFollowUpTranscriptWithProjection(
	commitContext context.Context,
	anchorID string,
	turnID string,
	instruction string,
	assistantText string,
	finalizeProjection func(*publicChatTurnProjectionState),
) error {
	if strings.TrimSpace(anchorID) == "" || strings.TrimSpace(turnID) == "" || strings.TrimSpace(instruction) == "" || strings.TrimSpace(assistantText) == "" {
		return status.Error(codes.InvalidArgument, "committed follow-up transcript requires anchor, turn, instruction, and assistant text")
	}
	return s.commitPublicChatTranscriptTurn(
		commitContext,
		anchorID,
		turnID,
		publicChatTurnOriginFollowUp,
		instruction,
		assistantText,
		finalizeProjection,
	)
}

// commitPublicChatTranscriptTurn is the irreversible Runtime turn boundary.
// It appends the canonical transcript record and, for live turns, installs the
// completed projection in one chatSurfaceMu-serialized durable transaction.
// Any capture or SQLite failure restores the exact pre-commit in-memory state;
// callers may then classify the still-uncommitted turn as failed.
func (s *Service) commitPublicChatTranscriptTurn(
	commitContext context.Context,
	anchorID string,
	turnID string,
	origin string,
	inputText string,
	assistantText string,
	finalizeProjection func(*publicChatTurnProjectionState),
) error {
	if s == nil {
		return status.Error(codes.FailedPrecondition, "public chat service unavailable")
	}
	trimmedAnchorID := strings.TrimSpace(anchorID)
	trimmedTurnID := strings.TrimSpace(turnID)
	trimmedInput := strings.TrimSpace(inputText)
	trimmedAssistant := strings.TrimSpace(assistantText)
	if trimmedAnchorID == "" || trimmedInput == "" || trimmedAssistant == "" ||
		(origin != publicChatTurnOriginUser && origin != publicChatTurnOriginFollowUp) ||
		(origin == publicChatTurnOriginFollowUp && trimmedTurnID == "") {
		return status.Error(codes.InvalidArgument, "committed transcript turn is invalid")
	}

	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()

	session := s.chatAnchors[trimmedAnchorID]
	if session == nil {
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return status.Error(codes.DataLoss, err.Error())
	}

	var turn *publicChatTurnState
	if finalizeProjection != nil {
		turn = s.chatTurns[trimmedTurnID]
		if turn == nil || strings.TrimSpace(turn.ConversationAnchorID) != trimmedAnchorID {
			return status.Error(codes.FailedPrecondition, "committed transcript live turn is unavailable under conversation anchor")
		}
		if commitContext == nil {
			return status.Error(codes.FailedPrecondition, "durable transcript commit context is unavailable")
		}
		if err := commitContext.Err(); err != nil {
			return status.FromContextError(err).Err()
		}
		if turn.Interrupted {
			return status.Errorf(codes.Canceled, "public chat turn interrupted before durable commit: %s", firstNonEmpty(strings.TrimSpace(turn.InterruptReason), "user_cancel"))
		}
	}

	transcriptBefore := clonePublicChatCommittedTranscript(session.CommittedTranscript)
	activeBefore := clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	lastBefore := clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	completedBefore := clonePublicChatTurnProjectionStateMap(session.CompletedTurnSnapshots)
	lastTurnIDBefore := session.LastTurnID
	lastMessageIDBefore := session.LastMessageID
	updatedAtBefore := session.UpdatedAt
	versionBefore := s.chatSurfaceVersion
	var projectionBefore *publicChatTurnProjectionState
	if turn != nil {
		projectionBefore = clonePublicChatTurnProjectionState(turn.Projection)
	}
	rollback := func() {
		session.CommittedTranscript = transcriptBefore
		session.ActiveTurnSnapshot = activeBefore
		session.LastTurnSnapshot = lastBefore
		session.CompletedTurnSnapshots = completedBefore
		session.LastTurnID = lastTurnIDBefore
		session.LastMessageID = lastMessageIDBefore
		session.UpdatedAt = updatedAtBefore
		s.chatSurfaceVersion = versionBefore
		if turn != nil {
			turn.Projection = projectionBefore
		}
	}

	replayed := false
	committedTurnID := trimmedTurnID
	if committedTurnID == "" && len(session.CommittedTranscript) > 0 {
		last := session.CommittedTranscript[len(session.CommittedTranscript)-1]
		replayed = last.Origin == origin && last.InputText == trimmedInput && last.AssistantText == trimmedAssistant
		if replayed {
			committedTurnID = last.TurnID
		}
	}
	if !replayed {
		sequence := uint64(len(session.CommittedTranscript))
		committedTurnID = publicChatCommittedTranscriptTurnID(committedTurnID, sequence, origin, trimmedInput, trimmedAssistant)
		var err error
		replayed, err = validatePublicChatCommittedTurnIDReplay(session.CommittedTranscript, committedTurnID, origin, trimmedInput, trimmedAssistant)
		if err != nil {
			return status.Error(codes.DataLoss, err.Error())
		}
		if !replayed {
			session.CommittedTranscript = append(session.CommittedTranscript, publicChatCommittedTranscriptTurn{
				TurnID:        committedTurnID,
				Sequence:      sequence,
				Origin:        origin,
				InputText:     trimmedInput,
				AssistantText: trimmedAssistant,
			})
		}
	}

	if finalizeProjection != nil {
		if turn.Projection == nil {
			turn.Projection = newPublicChatTurnProjection(turn)
		}
		finalizeProjection(turn.Projection)
		turn.Projection.UpdatedAt = time.Now().UTC()
		if turn.Projection.Status != publicChatTurnStatusCompleted ||
			strings.TrimSpace(turn.Projection.MessageID) == "" ||
			strings.TrimSpace(turn.Projection.AssistantText) == "" {
			rollback()
			return status.Error(codes.FailedPrecondition, "durable transcript commit requires completed message projection")
		}
		session.ActiveTurnSnapshot = nil
		session.LastTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		session.LastTurnID = trimmedTurnID
		session.LastMessageID = strings.TrimSpace(turn.Projection.MessageID)
		if session.CompletedTurnSnapshots == nil {
			session.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
		}
		session.CompletedTurnSnapshots[trimmedTurnID] = clonePublicChatTurnProjectionState(turn.Projection)
	}
	if replayed && finalizeProjection == nil {
		return nil
	}
	session.UpdatedAt = time.Now().UTC()
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		rollback()
		return status.Errorf(codes.Internal, "persist committed Runtime transcript: %v", err)
	}
	return nil
}

func validatePublicChatCommittedTranscript(transcript []publicChatCommittedTranscriptTurn) error {
	seen := make(map[string]struct{}, len(transcript))
	for index, turn := range transcript {
		if turn.Sequence != uint64(index) || strings.TrimSpace(turn.TurnID) == "" || turn.TurnID != strings.TrimSpace(turn.TurnID) || strings.TrimSpace(turn.InputText) == "" || strings.TrimSpace(turn.AssistantText) == "" ||
			turn.InputText != strings.TrimSpace(turn.InputText) || turn.AssistantText != strings.TrimSpace(turn.AssistantText) ||
			(turn.Origin != publicChatTurnOriginUser && turn.Origin != publicChatTurnOriginFollowUp) {
			return fmt.Errorf("Runtime committed transcript turn is invalid")
		}
		if _, duplicate := seen[turn.TurnID]; duplicate {
			return fmt.Errorf("Runtime committed transcript contains duplicate turn id")
		}
		seen[turn.TurnID] = struct{}{}
	}
	return nil
}

func validatePublicChatCommittedTurnIDReplay(transcript []publicChatCommittedTranscriptTurn, turnID string, origin string, inputText string, assistantText string) (bool, error) {
	for _, turn := range transcript {
		if turn.TurnID != turnID {
			continue
		}
		if turn.Origin == origin && turn.InputText == inputText && turn.AssistantText == assistantText {
			return true, nil
		}
		return false, fmt.Errorf("Runtime committed transcript turn id conflicts with existing content")
	}
	return false, nil
}

func publicChatCommittedTranscriptTurnID(turnID string, sequence uint64, origin string, inputText string, assistantText string) string {
	if trimmed := strings.TrimSpace(turnID); trimmed != "" {
		return trimmed
	}
	digest := sourceMaterializationBytesDigest([]byte(fmt.Sprintf("%d\x00%s\x00%s\x00%s", sequence, origin, inputText, assistantText)))
	return "agent_turn_committed_" + digest[:24]
}

func clonePublicChatCommittedTranscript(input []publicChatCommittedTranscriptTurn) []publicChatCommittedTranscriptTurn {
	if len(input) == 0 {
		return nil
	}
	return append([]publicChatCommittedTranscriptTurn(nil), input...)
}

// publicChatTranscriptProjection derives the app-facing message
// history from the canonical committed transcript. Runtime follow-up turns are
// intentionally absent from this projection while remaining available to the
// next context composition.
func publicChatTranscriptProjection(transcript []publicChatCommittedTranscriptTurn) ([]*runtimev1.ChatMessage, error) {
	if err := validatePublicChatCommittedTranscript(transcript); err != nil {
		return nil, err
	}
	messages := make([]*runtimev1.ChatMessage, 0, len(transcript)*2)
	for _, turn := range transcript {
		if turn.Origin != publicChatTurnOriginUser {
			continue
		}
		messages = append(messages,
			&runtimev1.ChatMessage{Role: "user", Content: turn.InputText},
			&runtimev1.ChatMessage{Role: "assistant", Content: turn.AssistantText},
		)
	}
	return messages, nil
}

func validRuntimeOwnedCurrentUserMessage(message *runtimev1.ChatMessage) bool {
	if message == nil || strings.TrimSpace(message.GetRole()) != "user" || strings.TrimSpace(message.GetName()) != "" ||
		len(message.GetToolCalls()) > 0 || strings.TrimSpace(message.GetToolCallId()) != "" ||
		len(message.GetToolResults()) > 0 || len(message.GetToolApprovalResponses()) > 0 {
		return false
	}
	return strings.TrimSpace(message.GetContent()) != "" && len(message.GetParts()) == 0
}

func clonePublicChatTurnProjectionStateMap(input map[string]*publicChatTurnProjectionState) map[string]*publicChatTurnProjectionState {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]*publicChatTurnProjectionState, len(input))
	for key, projection := range input {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" && projection != nil {
			trimmedKey = strings.TrimSpace(projection.TurnID)
		}
		if trimmedKey == "" || projection == nil {
			continue
		}
		out[trimmedKey] = clonePublicChatTurnProjectionState(projection)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (p *publicChatTurnProjectionState) payload() map[string]any {
	if p == nil {
		return map[string]any{}
	}
	out := map[string]any{
		"turn_id":             strings.TrimSpace(p.TurnID),
		"stream_id":           strings.TrimSpace(p.StreamID),
		"status":              strings.TrimSpace(p.Status),
		"stream_sequence":     p.StreamSequence,
		"turn_origin":         firstNonEmpty(strings.TrimSpace(p.Origin), publicChatTurnOriginUser),
		"follow_up_depth":     p.FollowUpDepth,
		"max_follow_up_turns": p.MaxFollowUpTurns,
		"output_observed":     p.OutputObserved,
		"reasoning_observed":  p.ReasoningObserved,
		"updated_at":          p.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if !p.TimelineStartedAt.IsZero() {
		out["timeline_started_at"] = p.TimelineStartedAt.UTC().Format(time.RFC3339Nano)
	}
	if strings.TrimSpace(p.TraceID) != "" {
		out["trace_id"] = strings.TrimSpace(p.TraceID)
	}
	if strings.TrimSpace(p.ChainID) != "" {
		out["chain_id"] = strings.TrimSpace(p.ChainID)
	}
	if strings.TrimSpace(p.SourceTurnID) != "" {
		out["source_turn_id"] = strings.TrimSpace(p.SourceTurnID)
	}
	if strings.TrimSpace(p.SourceActionID) != "" {
		out["source_action_id"] = strings.TrimSpace(p.SourceActionID)
	}
	if strings.TrimSpace(p.ModelResolved) != "" {
		out["model_resolved"] = strings.TrimSpace(p.ModelResolved)
	}
	if p.RouteDecision != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		out["route_decision"] = publicChatRouteLabel(p.RouteDecision)
	}
	if strings.TrimSpace(p.MessageID) != "" {
		out["message_id"] = strings.TrimSpace(p.MessageID)
	}
	if strings.TrimSpace(p.AssistantText) != "" {
		out["text"] = strings.TrimSpace(p.AssistantText)
	}
	if p.Structured != nil {
		out["structured"] = p.Structured.payload()
	}
	if p.AssistantMemory != nil {
		out["assistant_memory"] = p.AssistantMemory.payload()
	}
	if p.Sidecar != nil {
		out["chat_sidecar"] = p.Sidecar.payload()
	}
	if p.FollowUp != nil {
		out["follow_up"] = p.FollowUp.payload()
	}
	if contextSummary := publicChatTurnContextSummaryPayload(p.ContextSummary); contextSummary != nil {
		out["context_summary"] = contextSummary
	}
	if strings.TrimSpace(p.FinishReason) != "" {
		out["finish_reason"] = strings.TrimSpace(p.FinishReason)
	}
	if p.StreamSimulated {
		out["stream_simulated"] = true
	}
	if p.Usage != nil {
		out["usage"] = usagePayload(p.Usage)
	}
	if p.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		out["reason_code"] = publicChatReasonCodeLabel(p.ReasonCode)
	}
	if strings.TrimSpace(p.ActionHint) != "" {
		out["action_hint"] = strings.TrimSpace(p.ActionHint)
	}
	if strings.TrimSpace(p.Message) != "" {
		out["message"] = strings.TrimSpace(p.Message)
	}
	return out
}

func publicChatTurnContextSummaryPayload(input *runtimev1.AgentTurnContextSummary) map[string]any {
	if input == nil {
		return nil
	}
	raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(input)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func publicChatExecutionBindingProjectionPayload(binding publicChatExecutionBinding) map[string]any {
	out := map[string]any{
		"route":    publicChatRouteLabel(binding.RoutePolicy),
		"model_id": strings.TrimSpace(binding.ModelID),
	}
	if strings.TrimSpace(binding.ConnectorID) != "" {
		out["connector_id"] = strings.TrimSpace(binding.ConnectorID)
	}
	if targetRef := publicChatTargetRefProjectionPayload(binding.TargetRef); targetRef != nil {
		out["target_ref"] = targetRef
	}
	return out
}

func publicChatTargetRefProjectionPayload(targetRef *runtimev1.RuntimeDurableTargetRef) map[string]any {
	if targetRef == nil {
		return nil
	}
	raw, err := (protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: false}).Marshal(targetRef)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func publicChatExecutionBindingsProjectionPayload(bindings publicChatExecutionBindings, textBinding publicChatExecutionBinding) map[string]any {
	effective := clonePublicChatExecutionBindings(bindings)
	if len(effective) == 0 && strings.TrimSpace(textBinding.ModelID) != "" {
		effective = publicChatExecutionBindings{"text.generate": textBinding}
	}
	out := make(map[string]any, len(effective))
	for capability, binding := range effective {
		trimmedCapability := strings.TrimSpace(capability)
		if trimmedCapability == "" {
			continue
		}
		out[trimmedCapability] = publicChatExecutionBindingProjectionPayload(binding)
	}
	return out
}

func publicChatPendingFollowUpPayload(followUp *publicChatFollowUpState) map[string]any {
	if followUp == nil {
		return map[string]any{}
	}
	return map[string]any{
		"status":              "scheduled",
		"follow_up_id":        followUp.FollowUpID,
		"scheduled_for":       followUp.ScheduledFor.UTC().Format(time.RFC3339Nano),
		"chain_id":            followUp.ChainID,
		"follow_up_depth":     followUp.FollowUpDepth,
		"max_follow_up_turns": followUp.MaxFollowUpTurns,
		"source_turn_id":      followUp.SourceTurnID,
		"source_action_id":    followUp.SourceActionID,
	}
}

func (s *Service) mutatePublicChatTurnProjection(turnID string, persist bool, mutate func(*publicChatTurnProjectionState)) *publicChatTurnProjectionState {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	if turn.Projection == nil {
		turn.Projection = newPublicChatTurnProjection(turn)
	}
	projection := turn.Projection
	if mutate != nil {
		mutate(projection)
	}
	projection.UpdatedAt = time.Now().UTC()
	if session := s.chatAnchors[turn.ConversationAnchorID]; session != nil {
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	}
	out := clonePublicChatTurnProjectionState(projection)
	s.chatSurfaceMu.Unlock()
	if persist {
		s.persistCurrentPublicChatSurfaceState()
	}
	return out
}

func (s *Service) finalizePublicChatTurnProjection(turnID string, persist bool, mutate func(*publicChatTurnProjectionState)) *publicChatTurnProjectionState {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	if turn.Projection == nil {
		turn.Projection = newPublicChatTurnProjection(turn)
	}
	projection := turn.Projection
	if mutate != nil {
		mutate(projection)
	}
	projection.UpdatedAt = time.Now().UTC()
	out := clonePublicChatTurnProjectionState(projection)
	if session := s.chatAnchors[turn.ConversationAnchorID]; session != nil {
		session.ActiveTurnSnapshot = nil
		session.LastTurnSnapshot = clonePublicChatTurnProjectionState(projection)
		if strings.TrimSpace(projection.MessageID) != "" {
			session.LastMessageID = strings.TrimSpace(projection.MessageID)
		}
		if projection.Status == publicChatTurnStatusCompleted &&
			strings.TrimSpace(projection.TurnID) != "" &&
			strings.TrimSpace(projection.MessageID) != "" {
			if session.CompletedTurnSnapshots == nil {
				session.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
			}
			session.CompletedTurnSnapshots[trimmedTurnID] = clonePublicChatTurnProjectionState(projection)
		}
		session.LastTurnID = trimmedTurnID
		session.UpdatedAt = time.Now().UTC()
	}
	s.chatSurfaceMu.Unlock()
	if persist {
		s.persistCurrentPublicChatSurfaceState()
	}
	return out
}

// snapshotPublicChatAnchorForCaller returns an anchor snapshot for a given
// caller. Per K-AGCORE-034 the lookup key is `conversation_anchor_id` (the
// only admitted cross-surface continuity scope). Late-join surfaces recover
// continuity through this anchor-native snapshot, not through app-local
// history replay.
func (s *Service) snapshotPublicChatAnchorForCaller(callerAppID string, anchorID string) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if strings.TrimSpace(callerAppID) == "" || trimmedAnchorID == "" {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.InvalidArgument, "public chat anchor snapshot requires caller app and conversation_anchor_id")
	}
	return s.snapshotPublicChatAnchor(trimmedAnchorID, "", false)
}

func (s *Service) snapshotPublicChatAnchorForScopedBinding(anchorID string) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedAnchorID == "" {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.InvalidArgument, "public chat scoped anchor snapshot requires conversation_anchor_id")
	}
	return s.snapshotPublicChatAnchor(trimmedAnchorID, "", false)
}

func (s *Service) snapshotPublicChatAnchorForAvatarLiveInstance(callerAppID string, anchorID string, identity localAgentIdentity) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	trimmedCallerAppID := strings.TrimSpace(callerAppID)
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedCallerAppID == "" || trimmedAnchorID == "" {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.InvalidArgument, "public chat avatar snapshot requires caller app and conversation_anchor_id")
	}

	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[trimmedAnchorID]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if session.LocalAgentRef != identity.LocalAgentRef || session.OwnerUserID != identity.OwnerUserID || session.RuntimeSourceRef != identity.RuntimeSourceRef {
		s.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.PermissionDenied, "public chat anchor local identity mismatch")
	}
	s.chatSurfaceMu.Unlock()

	return s.snapshotPublicChatAnchor(trimmedAnchorID, "", false)
}

func (s *Service) snapshotPublicChatAnchor(anchorID string, callerAppID string, enforceCaller bool) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.DataLoss, err.Error())
	}
	_ = callerAppID
	_ = enforceCaller
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.CommittedTranscript = clonePublicChatCommittedTranscript(session.CommittedTranscript)
	snapshot.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	snapshot.LastTurnSnapshot = clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	snapshot.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(session.CompletedTurnSnapshots)
	var activeTurn *publicChatTurnProjectionState
	if trimmedActiveTurnID := strings.TrimSpace(session.ActiveTurnID); trimmedActiveTurnID != "" && session.ActiveTurnSnapshot != nil {
		if turn := s.chatTurns[trimmedActiveTurnID]; turn != nil {
			activeTurn = clonePublicChatTurnProjectionState(turn.Projection)
		}
	}
	if activeTurn == nil {
		activeTurn = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	}
	lastTurn := clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	var pendingFollowUp *publicChatFollowUpState
	if trimmedFollowUpID := strings.TrimSpace(session.PendingFollowUpID); trimmedFollowUpID != "" {
		if followUp := s.chatFollowUps[trimmedFollowUpID]; followUp != nil {
			copyFollowUp := *followUp
			pendingFollowUp = &copyFollowUp
		}
	}
	return snapshot, activeTurn, lastTurn, pendingFollowUp, nil
}

func publicChatSessionStatus(activeTurn *publicChatTurnProjectionState, pendingFollowUp *publicChatFollowUpState) string {
	if activeTurn != nil && strings.TrimSpace(activeTurn.TurnID) != "" {
		return "turn_active"
	}
	if pendingFollowUp != nil && strings.TrimSpace(pendingFollowUp.FollowUpID) != "" {
		return "follow_up_pending"
	}
	return "idle"
}

func clonePublicChatStructuredEnvelope(input *publicChatStructuredEnvelope) *publicChatStructuredEnvelope {
	if input == nil {
		return nil
	}
	out := &publicChatStructuredEnvelope{
		SchemaID: strings.TrimSpace(input.SchemaID),
		Message: publicChatStructuredMessage{
			MessageID: strings.TrimSpace(input.Message.MessageID),
			Text:      strings.TrimSpace(input.Message.Text),
		},
		Actions: make([]publicChatStructuredAction, 0, len(input.Actions)),
	}
	if input.StatusCue != nil {
		statusCue := *input.StatusCue
		if input.StatusCue.Intensity != nil {
			intensity := *input.StatusCue.Intensity
			statusCue.Intensity = &intensity
		}
		out.StatusCue = &statusCue
	}
	for _, action := range input.Actions {
		out.Actions = append(out.Actions, action)
	}
	return out
}

func clonePublicChatAssistantMemoryOutcome(input *publicChatAssistantMemoryOutcome) *publicChatAssistantMemoryOutcome {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}

func clonePublicChatSidecarOutcome(input *publicChatSidecarOutcome) *publicChatSidecarOutcome {
	if input == nil {
		return nil
	}
	out := *input
	out.CanceledHookIDs = append([]string(nil), input.CanceledHookIDs...)
	return &out
}

func clonePublicChatFollowUpOutcome(input *publicChatFollowUpOutcome) *publicChatFollowUpOutcome {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}
