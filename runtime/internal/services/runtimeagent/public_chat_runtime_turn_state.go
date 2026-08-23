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
	identity, err := validateLocalAgentIdentity(req.OwnerUserID, req.RuntimeSourceRef, req.LocalAgentRef)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, publicChatDiagnosticError(
			err,
			"runtime_agent_public_chat_identity",
		)
	}
	localAgentRef := identity.LocalAgentRef
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	if callerAppID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires caller app")
	}
	if anchorID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires conversation_anchor_id")
	}
	entry, err := r.svc.agentByID(localAgentRef)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, publicChatDiagnosticError(
			err,
			"runtime_agent_public_chat_agent_lookup",
		)
	}
	if err := validateLocalAgentRecordIdentity(entry.Agent, identity); err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, publicChatDiagnosticError(
			err,
			"runtime_agent_public_chat_agent_identity",
		)
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}
	if len(req.ExecutionBindings) > 0 {
		// K-AGCORE-147 hard cut: request-carried execution_bindings are not
		// admitted; turn admission binds to the committed Runtime Agent AI Config.
		return publicChatAnchorState{}, publicChatTurnState{}, nil, errPublicChatRequestExecutionBindingsNotAdmitted
	}
	resolvedBindings, configRevision, bindingRelease, err := r.svc.resolveExecutionBindingsFromConfig(parent, localAgentRef, subjectUserID, req)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, publicChatDiagnosticError(
			err,
			"runtime_agent_public_chat_binding_resolution",
		)
	}
	releaseUnclaimedBinding := bindingRelease
	defer func() {
		if releaseUnclaimedBinding != nil {
			releaseUnclaimedBinding()
		}
	}()
	imageBinding, hasImageBinding := resolvedBindings[runtimeAgentAIConfigCapabilityImageGenerate]
	availableActions := publicChatAvailableActions{
		ImageGenerate: r.svc.deriveImageActionAvailability(localAgentRef, configRevision, imageBinding, hasImageBinding),
	}
	reasoning := normalizePublicChatReasoning(req.Reasoning)
	for {
		r.svc.chatSurfaceMu.Lock()
		if activeTurnID := strings.TrimSpace(r.svc.chatActiveByAgent[localAgentRef]); activeTurnID != "" {
			if activeTurn := r.svc.chatTurns[activeTurnID]; activeTurn != nil {
				r.svc.chatSurfaceMu.Unlock()
				return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent already has an active public chat turn")
			}
			delete(r.svc.chatActiveByAgent, localAgentRef)
		}
		session := r.svc.chatAnchors[anchorID]
		if session == nil {
			// Hard fail: runtime.agent.turn.request must reference an existing
			// ConversationAnchor opened through OpenConversationAnchor.
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.NotFound, "conversation_anchor_id not found; open ConversationAnchor first")
		}
		if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.DataLoss, err.Error())
		}
		if session.AgentID != localAgentRef {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor local_agent_ref mismatch")
		}
		if session.OwnerUserID != identity.OwnerUserID || session.RuntimeSourceRef != identity.RuntimeSourceRef || session.LocalAgentRef != identity.LocalAgentRef {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor local identity mismatch")
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
		// thread_id is a caller-carried correlation assertion only. Runtime
		// allocates and owns the thread identity when the anchor opens; a turn
		// can neither create nor overwrite it.
		if trimmed := strings.TrimSpace(req.ThreadID); trimmed != "" &&
			strings.TrimSpace(session.ThreadID) != trimmed {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor thread_id mismatch")
		}
		// K-AGCORE-147: the anchor no longer owns binding truth. Every turn
		// admission overwrites the session projection fields with the
		// admission-resolved bindings and the committed config revision.
		session.Binding = resolvedBindings[runtimeAgentAIConfigCapabilityTextGenerate]
		session.Bindings = clonePublicChatExecutionBindings(resolvedBindings)
		session.ConfigRevision = configRevision
		if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" {
			session.SubjectUserID = trimmed
		}
		// app_id is retained only as last-turn-origin information. Conversation
		// delivery and authorization never target or partition by this field.
		session.CallerAppID = callerAppID
		if req.MaxOutputTokens > 0 || session.MaxTokens == 0 {
			session.MaxTokens = req.MaxOutputTokens
		}
		if reasoning != nil || session.Reasoning == nil {
			session.Reasoning = clonePublicChatReasoningConfig(reasoning)
		}
		// Request-carried messages are current-turn input only. Runtime-owned
		// committed transcript is appended atomically at the message commit
		// point; caller history never reconciles, replaces, or extends it here.
		// Public chat turn execution is asynchronous relative to the ingress
		// app-message handler. The runtime-owned turn context must therefore not
		// inherit the handler/request lifetime; otherwise the handler returning can
		// cancel the turn before AI execution even starts and surface false
		// AI_PROVIDER_UNAVAILABLE failures from downstream scheduler/provider paths.
		parent = context.Background()
		turnID := "agent_turn_" + ulid.Make().String()
		streamID := "agent_stream_" + ulid.Make().String()
		timelineStartedAt := time.Now()
		// Runtime AI owns text-stream first-packet, idle, and absolute timeout
		// semantics. The public-chat turn retains explicit interruption through
		// this cancel function but must not race the provider timeout with a
		// duplicate outer deadline that can misproject it as turn interruption.
		turnCtx, cancel := context.WithCancel(parent)
		turn := &publicChatTurnState{
			ConversationAnchorID: session.ConversationAnchorID,
			TurnID:               turnID,
			StreamID:             streamID,
			AgentID:              session.AgentID,
			CallerAppID:          callerAppID,
			SubjectUserID:        session.SubjectUserID,
			ThreadID:             session.ThreadID,
			Cancel:               cancel,
			TimelineStartedAt:    timelineStartedAt,
			Origin:               publicChatTurnOriginUser,
			ConfigRevision:       configRevision,
			AvailableActions:     availableActions,
			BindingRelease:       bindingRelease,
		}
		releaseUnclaimedBinding = nil
		turn.Projection = newPublicChatTurnProjection(turn)
		session.ActiveTurnID = turnID
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		session.UpdatedAt = time.Now().UTC()
		r.svc.chatTurns[turnID] = turn
		r.svc.chatActiveByAgent[localAgentRef] = turnID
		snapshot := *session
		snapshot.CommittedTranscript = clonePublicChatCommittedTranscript(session.CommittedTranscript)
		turnSnapshot := *turn
		r.svc.chatSurfaceMu.Unlock()
		r.svc.persistCurrentPublicChatSurfaceState()
		return snapshot, turnSnapshot, turnCtx, nil
	}
}

func (r publicChatRuntime) releaseTurn(anchorID string, turnID string) {
	r.releaseTurnReservation(anchorID, turnID, false)
}

func (r publicChatRuntime) releaseTurnReservation(anchorID string, turnID string, publishTerminal bool) {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	trimmedTurnID := strings.TrimSpace(turnID)
	r.svc.chatSurfaceMu.Lock()
	turn := r.svc.chatTurns[trimmedTurnID]
	var bindingRelease func()
	if turn != nil {
		bindingRelease = turn.BindingRelease
		turn.BindingRelease = nil
	}
	delete(r.svc.chatTurns, trimmedTurnID)
	if session := r.svc.chatAnchors[trimmedAnchorID]; session != nil && session.ActiveTurnID == trimmedTurnID {
		if publishTerminal && turn != nil && turn.TerminalProjection != nil {
			terminal := clonePublicChatTurnProjectionState(turn.TerminalProjection)
			terminal.StreamSequence = turn.StreamSequence
			terminal.UpdatedAt = time.Now().UTC()
			session.LastTurnSnapshot = terminal
			session.LastTurnID = trimmedTurnID
			if messageID := strings.TrimSpace(terminal.MessageID); messageID != "" {
				session.LastMessageID = messageID
			}
			if publicChatTurnProjectionIsTerminal(terminal) {
				if session.CompletedTurnSnapshots == nil {
					session.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
				}
				session.CompletedTurnSnapshots[trimmedTurnID] = clonePublicChatTurnProjectionState(terminal)
			}
		}
		session.ActiveTurnID = ""
		session.ActiveTurnSnapshot = nil
		session.UpdatedAt = time.Now().UTC()
	}
	if turn != nil && strings.TrimSpace(r.svc.chatActiveByAgent[turn.AgentID]) == trimmedTurnID {
		delete(r.svc.chatActiveByAgent, turn.AgentID)
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
	if bindingRelease != nil {
		bindingRelease()
	}
}

func (r publicChatRuntime) finishTurnReservation(session publicChatAnchorState, turnID string) {
	if r.svc == nil {
		return
	}
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return
	}
	r.svc.chatSurfaceMu.Lock()
	anchor := r.svc.chatAnchors[strings.TrimSpace(session.ConversationAnchorID)]
	reservationOwned := anchor != nil && strings.TrimSpace(anchor.ActiveTurnID) == trimmedTurnID
	if !reservationOwned {
		reservationOwned = strings.TrimSpace(r.svc.chatActiveByAgent[strings.TrimSpace(session.AgentID)]) == trimmedTurnID
	}
	r.svc.chatSurfaceMu.Unlock()
	if reservationOwned {
		r.releaseTurnReservation(session.ConversationAnchorID, trimmedTurnID, true)
	}
	// Serialize the old turn's final execution-state transition against a new
	// reserveTurn. A terminal callback may synchronously start the next turn;
	// in that case the newer reservation owns CHAT_ACTIVE and must not be
	// overwritten by this finalizer.
	r.svc.chatSurfaceMu.Lock()
	activeTurnID := strings.TrimSpace(r.svc.chatActiveByAgent[strings.TrimSpace(session.AgentID)])
	if activeTurnID != "" && activeTurnID != trimmedTurnID {
		r.svc.chatSurfaceMu.Unlock()
		return
	}
	err := r.setExecutionState(session.AgentID, "", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE)
	r.svc.chatSurfaceMu.Unlock()
	if err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("set public chat agent idle state failed", "agent_id", session.AgentID, "turn_id", trimmedTurnID, "error", err)
	}
}

func (r publicChatRuntime) lookupTurnForInterrupt(
	callerAppID string,
	subjectUserID string,
	req publicChatTurnInterruptPayload,
) (publicChatAnchorState, publicChatTurnState, error) {
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	trimmedSubjectUserID := strings.TrimSpace(subjectUserID)
	if callerAppID == "" || trimmedSubjectUserID == "" || anchorID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.InvalidArgument, "public chat interrupt requires caller app, subject_user_id, and conversation_anchor_id")
	}
	r.svc.chatSurfaceMu.Lock()
	defer r.svc.chatSurfaceMu.Unlock()
	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if strings.TrimSpace(session.SubjectUserID) != trimmedSubjectUserID {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.PermissionDenied, "public chat anchor subject_user_id mismatch")
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
	if strings.TrimSpace(turn.SubjectUserID) != "" && strings.TrimSpace(turn.SubjectUserID) != trimmedSubjectUserID {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.PermissionDenied, "public chat turn subject_user_id mismatch")
	}
	return *session, *turn, nil
}
