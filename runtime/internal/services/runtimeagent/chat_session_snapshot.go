package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
		TurnID:           turn.TurnID,
		StreamID:         turn.StreamID,
		Status:           publicChatTurnStatusAccepted,
		Origin:           firstNonEmpty(strings.TrimSpace(turn.Origin), publicChatTurnOriginUser),
		ChainID:          strings.TrimSpace(turn.ChainID),
		FollowUpDepth:    turn.FollowUpDepth,
		MaxFollowUpTurns: turn.MaxFollowUpTurns,
		SourceTurnID:     strings.TrimSpace(turn.SourceTurnID),
		SourceActionID:   strings.TrimSpace(turn.SourceActionID),
		UpdatedAt:        time.Now().UTC(),
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
	if input.Usage != nil {
		out.Usage = proto.Clone(input.Usage).(*runtimev1.UsageStats)
	}
	return &out
}

func reconcilePublicChatSessionTranscript(current []*runtimev1.ChatMessage, incoming []*runtimev1.ChatMessage) []*runtimev1.ChatMessage {
	if len(incoming) == 0 {
		return cloneChatMessages(current)
	}
	if len(current) == 0 {
		return cloneChatMessages(incoming)
	}
	if publicChatTranscriptHasPrefix(incoming, current) {
		return cloneChatMessages(incoming)
	}
	if publicChatTranscriptHasPrefix(current, incoming) {
		return cloneChatMessages(current)
	}
	if overlap := publicChatTranscriptSuffixPrefixOverlap(current, incoming); overlap > 0 {
		merged := cloneChatMessages(current)
		merged = append(merged, cloneChatMessages(incoming[overlap:])...)
		return merged
	}
	if publicChatTranscriptAssistantCount(incoming) < publicChatTranscriptAssistantCount(current) {
		return appendPublicChatUnmatchedIncomingTranscript(current, incoming)
	}
	if prefix := publicChatTranscriptCommonPrefixLength(current, incoming); prefix > 0 {
		merged := cloneChatMessages(current)
		merged = append(merged, cloneChatMessages(incoming[prefix:])...)
		return merged
	}
	return cloneChatMessages(incoming)
}

func appendPublicChatUnmatchedIncomingTranscript(current []*runtimev1.ChatMessage, incoming []*runtimev1.ChatMessage) []*runtimev1.ChatMessage {
	merged := cloneChatMessages(current)
	currentIndex := 0
	for _, incomingMessage := range incoming {
		matched := false
		for scanIndex := currentIndex; scanIndex < len(current); scanIndex++ {
			if publicChatMessagesEquivalent(current[scanIndex], incomingMessage) {
				currentIndex = scanIndex + 1
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		merged = append(merged, cloneChatMessages([]*runtimev1.ChatMessage{incomingMessage})...)
	}
	return merged
}

func publicChatTranscriptWithCommittedAssistant(transcript []*runtimev1.ChatMessage, projection *publicChatTurnProjectionState) []*runtimev1.ChatMessage {
	out := cloneChatMessages(transcript)
	if projection == nil || projection.Status != publicChatTurnStatusCompleted {
		return out
	}
	return appendPublicChatAssistantTranscript(out, projection.AssistantText)
}

func appendPublicChatAssistantTranscript(transcript []*runtimev1.ChatMessage, assistantText string) []*runtimev1.ChatMessage {
	trimmedText := strings.TrimSpace(assistantText)
	out := cloneChatMessages(transcript)
	if trimmedText == "" {
		return out
	}
	assistant := &runtimev1.ChatMessage{
		Role:    "assistant",
		Content: trimmedText,
	}
	if len(out) > 0 && publicChatMessagesEquivalent(out[len(out)-1], assistant) {
		return out
	}
	out = append(out, assistant)
	return out
}

func publicChatTranscriptHasPrefix(messages []*runtimev1.ChatMessage, prefix []*runtimev1.ChatMessage) bool {
	if len(prefix) > len(messages) {
		return false
	}
	for i := range prefix {
		if !publicChatMessagesEquivalent(messages[i], prefix[i]) {
			return false
		}
	}
	return true
}

func publicChatTranscriptSuffixPrefixOverlap(current []*runtimev1.ChatMessage, incoming []*runtimev1.ChatMessage) int {
	limit := len(current)
	if len(incoming) < limit {
		limit = len(incoming)
	}
	for size := limit; size > 0; size-- {
		matches := true
		offset := len(current) - size
		for i := 0; i < size; i++ {
			if !publicChatMessagesEquivalent(current[offset+i], incoming[i]) {
				matches = false
				break
			}
		}
		if matches {
			return size
		}
	}
	return 0
}

func publicChatTranscriptCommonPrefixLength(left []*runtimev1.ChatMessage, right []*runtimev1.ChatMessage) int {
	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for i := 0; i < limit; i++ {
		if !publicChatMessagesEquivalent(left[i], right[i]) {
			return i
		}
	}
	return limit
}

func publicChatTranscriptAssistantCount(messages []*runtimev1.ChatMessage) int {
	count := 0
	for _, message := range messages {
		if strings.TrimSpace(message.GetRole()) == "assistant" && strings.TrimSpace(message.GetContent()) != "" {
			count++
		}
	}
	return count
}

func publicChatMessagesEquivalent(left *runtimev1.ChatMessage, right *runtimev1.ChatMessage) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if strings.TrimSpace(left.GetRole()) != strings.TrimSpace(right.GetRole()) {
		return false
	}
	if strings.TrimSpace(left.GetName()) != strings.TrimSpace(right.GetName()) {
		return false
	}
	if left.GetContent() != right.GetContent() {
		return false
	}
	return proto.Equal(left, right)
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

func publicChatExecutionBindingProjectionPayload(binding publicChatExecutionBinding) map[string]any {
	out := map[string]any{
		"route":    publicChatRouteLabel(binding.RoutePolicy),
		"model_id": strings.TrimSpace(binding.ModelID),
	}
	if strings.TrimSpace(binding.ConnectorID) != "" {
		out["connector_id"] = strings.TrimSpace(binding.ConnectorID)
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
		session.Transcript = publicChatTranscriptWithCommittedAssistant(session.Transcript, projection)
		if strings.TrimSpace(projection.MessageID) != "" {
			session.LastMessageID = strings.TrimSpace(projection.MessageID)
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
	return s.snapshotPublicChatAnchor(trimmedAnchorID, strings.TrimSpace(callerAppID), true)
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
	if session.CallerAppID != trimmedCallerAppID && !s.avatarLiveInstanceBindingAuthorizesAnchorLocked(trimmedCallerAppID, trimmedAnchorID, identity) {
		s.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
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
	if enforceCaller && session.CallerAppID != strings.TrimSpace(callerAppID) {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.Transcript = cloneChatMessages(session.Transcript)
	snapshot.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	snapshot.LastTurnSnapshot = clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	if strings.TrimSpace(snapshot.ActiveTurnID) == "" {
		snapshot.Transcript = publicChatTranscriptWithCommittedAssistant(snapshot.Transcript, snapshot.LastTurnSnapshot)
	}
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
