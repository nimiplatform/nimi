package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (r publicChatRuntime) reserveTurn(
	parent context.Context,
	callerAppID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatAnchorState, publicChatTurnState, context.Context, error) {
	agentID := strings.TrimSpace(req.AgentID)
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	if callerAppID == "" || agentID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires caller app and agent id")
	}
	if anchorID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires conversation_anchor_id")
	}
	entry, err := r.svc.agentByID(agentID)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}
	binding, hasBinding, err := r.svc.resolvePublicChatBinding(parent, subjectUserID, req)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, err
	}
	reasoning := normalizePublicChatReasoning(req.Reasoning)
	transcript := cloneChatMessages(toProtoPublicChatMessages(req.Messages))
	r.svc.chatSurfaceMu.Lock()
	if activeTurnID := strings.TrimSpace(r.svc.chatActiveByAgent[agentID]); activeTurnID != "" {
		if activeTurn := r.svc.chatTurns[activeTurnID]; activeTurn != nil {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent already has an active public chat turn")
		}
		delete(r.svc.chatActiveByAgent, agentID)
	}
	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		// Hard fail: runtime.agent.turn.request must reference an existing
		// ConversationAnchor opened through OpenConversationAnchor.
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.NotFound, "conversation_anchor_id not found; open ConversationAnchor first")
	}
	if session.CallerAppID != callerAppID {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	if session.AgentID != agentID {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor agent mismatch")
	}
	if session.Status == runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "conversation anchor is closed")
	}
	if session.ActiveTurnID != "" {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor already has an active turn")
	}
	if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" &&
		strings.TrimSpace(session.SubjectUserID) != "" &&
		strings.TrimSpace(session.SubjectUserID) != trimmed {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor subject_user_id mismatch")
	}
	if trimmed := strings.TrimSpace(req.ThreadID); trimmed != "" &&
		strings.TrimSpace(session.ThreadID) != "" &&
		strings.TrimSpace(session.ThreadID) != trimmed {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor thread_id mismatch")
	}
	if hasBinding {
		if session.Binding.ModelID != "" && publicChatExecutionBindingMismatch(session.Binding, binding) {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor execution_binding mismatch")
		}
		session.Binding = binding
	}
	if session.Binding.ModelID == "" || session.Binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat anchor requires execution_binding")
	}
	if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" {
		session.SubjectUserID = trimmed
	}
	if trimmed := strings.TrimSpace(req.ThreadID); trimmed != "" {
		session.ThreadID = trimmed
	}
	if trimmed := strings.TrimSpace(req.SystemPrompt); trimmed != "" || session.SystemPrompt == "" {
		session.SystemPrompt = trimmed
	}
	if req.MaxOutputTokens > 0 || session.MaxTokens == 0 {
		session.MaxTokens = req.MaxOutputTokens
	}
	if reasoning != nil || session.Reasoning == nil {
		session.Reasoning = clonePublicChatReasoningConfig(reasoning)
	}
	session.Transcript = publicChatTranscriptWithCommittedAssistant(session.Transcript, session.LastTurnSnapshot)
	if len(transcript) > 0 {
		session.Transcript = reconcilePublicChatSessionTranscript(session.Transcript, transcript)
	}
	// Public chat turn execution is asynchronous relative to the ingress
	// app-message handler. The runtime-owned turn context must therefore not
	// inherit the handler/request lifetime; otherwise the handler returning can
	// cancel the turn before AI execution even starts and surface false
	// AI_PROVIDER_UNAVAILABLE failures from downstream scheduler/provider paths.
	parent = context.Background()
	turnID := "agent_turn_" + ulid.Make().String()
	streamID := "agent_stream_" + ulid.Make().String()
	timelineStartedAt := time.Now()
	turnCtx, cancel := context.WithCancel(parent)
	turn := &publicChatTurnState{
		ConversationAnchorID: session.ConversationAnchorID,
		TurnID:               turnID,
		StreamID:             streamID,
		AgentID:              session.AgentID,
		CallerAppID:          session.CallerAppID,
		SubjectUserID:        session.SubjectUserID,
		ThreadID:             session.ThreadID,
		Cancel:               cancel,
		TimelineStartedAt:    timelineStartedAt,
		Origin:               publicChatTurnOriginUser,
	}
	turn.Projection = newPublicChatTurnProjection(turn)
	session.ActiveTurnID = turnID
	session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
	session.UpdatedAt = time.Now().UTC()
	r.svc.chatTurns[turnID] = turn
	r.svc.chatActiveByAgent[agentID] = turnID
	snapshot := *session
	turnSnapshot := *turn
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
	return snapshot, turnSnapshot, turnCtx, nil
}

func (r publicChatRuntime) releaseTurn(anchorID string, turnID string) {
	r.svc.chatSurfaceMu.Lock()
	turn := r.svc.chatTurns[strings.TrimSpace(turnID)]
	delete(r.svc.chatTurns, strings.TrimSpace(turnID))
	if session := r.svc.chatAnchors[strings.TrimSpace(anchorID)]; session != nil && session.ActiveTurnID == strings.TrimSpace(turnID) {
		session.ActiveTurnID = ""
		session.ActiveTurnSnapshot = nil
		session.UpdatedAt = time.Now().UTC()
	}
	if turn != nil && strings.TrimSpace(r.svc.chatActiveByAgent[turn.AgentID]) == strings.TrimSpace(turnID) {
		delete(r.svc.chatActiveByAgent, turn.AgentID)
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
}

func (r publicChatRuntime) lookupTurnForInterrupt(
	callerAppID string,
	req publicChatTurnInterruptPayload,
) (publicChatAnchorState, publicChatTurnState, error) {
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	if callerAppID == "" || anchorID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.InvalidArgument, "public chat interrupt requires caller app and conversation_anchor_id")
	}
	r.svc.chatSurfaceMu.Lock()
	defer r.svc.chatSurfaceMu.Unlock()
	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if session.CallerAppID != callerAppID {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	turnID := firstNonEmpty(strings.TrimSpace(req.TurnID), session.ActiveTurnID)
	turn := r.svc.chatTurns[turnID]
	if turn == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found")
	}
	// Anchor-scoped isolation: the resolved turn must live under the
	// referenced anchor. Different anchors under the same agent MUST NOT
	// share interrupt propagation by implication (K-AGCORE-035).
	if strings.TrimSpace(turn.ConversationAnchorID) != "" && turn.ConversationAnchorID != session.ConversationAnchorID {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found under referenced anchor")
	}
	return *session, *turn, nil
}
