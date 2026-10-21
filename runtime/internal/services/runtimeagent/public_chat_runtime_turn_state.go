package runtimeagent

import (
	"context"
	"database/sql"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
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
	r.svc.chatSurfaceMu.Lock()
	if anchor := r.svc.chatAnchors[anchorID]; anchor != nil && anchor.LocalAgentRef == localAgentRef && !r.svc.agentTerminationFencedLocked(localAgentRef) {
		if reused, found, err := reusedPublicChatAdmission(anchor, req); found || err != nil {
			snapshot := *anchor
			r.svc.chatSurfaceMu.Unlock()
			return snapshot, reused, parent, err
		}
	}
	r.svc.chatSurfaceMu.Unlock()

	if callerAppID == "" && req.proactiveClaim == nil && req.followUpClaim == nil {
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
	if req.followUpClaim == nil && req.proactiveClaim == nil {
		releasePriority, waitErr := r.svc.yieldAgentBackground(parent, localAgentRef)
		if waitErr != nil {
			return publicChatAnchorState{}, publicChatTurnState{}, nil, waitErr
		}
		defer releasePriority()
	}
	var resolvedBindings publicChatExecutionBindings
	var configRevision uint64
	var bindingRelease func()
	primaryCapability := runtimeAgentAIConfigCapabilityTextGenerate
	if req.realtimeBinding != nil {
		if req.realtimeBinding.CapabilityContract != "realtime.interact" || req.realtimeBinding.ContextWindowTokens == 0 {
			return publicChatAnchorState{}, publicChatTurnState{}, nil, localAppConversationInvalid("captured Realtime context is unavailable")
		}
		primaryCapability = "realtime.interact"
		resolvedBindings = publicChatExecutionBindings{primaryCapability: *req.realtimeBinding}
	} else {
		resolvedBindings, configRevision, bindingRelease, err = r.svc.resolveExecutionBindingsFromConfig(parent, localAgentRef, subjectUserID, req)
	}
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
	imageAvailability := publicChatImageActionNotConfigured
	var imageBinding publicChatExecutionBinding
	if req.realtimeBinding == nil {
		imageBinding, imageAvailability = r.svc.resolvePublicChatImageActionBinding(parent, localAgentRef)
	}
	if imageAvailability == publicChatImageActionAvailable {
		resolvedBindings[runtimeAgentAIConfigCapabilityImageGenerate] = imageBinding
	}
	availableActions := publicChatAvailableActions{
		ImageGenerate: imageAvailability,
		TextOnly:      req.RetryOfTurnID != "",
	}
	reasoning := normalizePublicChatReasoning(req.Reasoning)
	source, _ := r.svc.turnSourceView(localAgentRef)
	r.svc.cognitionMemoryOwnerLifecycleMu.Lock()
	r.svc.mu.Lock()
	memoryReady := false
	defer func() {
		r.svc.mu.Unlock()
		r.svc.cognitionMemoryOwnerLifecycleMu.Unlock()
		if memoryReady {
			r.svc.triggerCognitionMemory(localAgentRef)
		}
	}()
	for {
		r.svc.chatSurfaceMu.Lock()
		if r.svc.agentTerminationFencedLocked(localAgentRef) {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
		}
		if anchor := r.svc.chatAnchors[anchorID]; anchor != nil && anchor.LocalAgentRef == localAgentRef {
			if reused, found, err := reusedPublicChatAdmission(anchor, req); found || err != nil {
				snapshot := *anchor
				r.svc.chatSurfaceMu.Unlock()
				return snapshot, reused, parent, err
			}
		}
		ownBackground := req.backgroundAdmission != nil && r.svc.backgroundByAgent[localAgentRef] == req.backgroundAdmission && !req.backgroundAdmission.invalidated && parent.Err() == nil && r.svc.chatActiveByAgent[localAgentRef] == "" && r.svc.localAppWorkActiveByAgent[localAgentRef] == ""
		if r.svc.localAgentExecutionBusyLocked(localAgentRef) && !ownBackground || req.backgroundAdmission != nil && !ownBackground {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AGENT_BUSY)
		}
		session := r.svc.chatAnchors[anchorID]
		if req.proactiveClaim != nil && !validLifeProactiveClaim(r.svc.agents[localAgentRef], req.proactiveClaim, time.Now().UTC()) {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "proactive intent is no longer eligible")
		}
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
			return publicChatAnchorState{}, publicChatTurnState{}, nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AGENT_BUSY)
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
		if claim := req.followUpClaim; claim != nil {
			pending := r.svc.chatFollowUps[session.PendingFollowUpID]
			if !lifeContactAllowed(r.svc.agents[localAgentRef], time.Now().UTC()) || pending == nil || !followUpSourceSelected(session, pending.SourceTurnID) || time.Now().UTC().After(pending.ScheduledFor.Add(publicChatFollowUpGrace)) || pending.FollowUpID != claim.FollowUpID || pending.Revision != claim.Revision || pending.ScheduledFor.After(time.Now().UTC()) || pending.FollowUpDepth > pending.MaxFollowUpTurns {
				r.svc.chatSurfaceMu.Unlock()
				return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "follow-up is no longer pending or enabled")
			}
		}
		if req.RetryOfTurnID != "" && !publicChatCanRegenerate(session, req.RetryOfTurnID) {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, localAppConversationInvalid("This turn cannot be regenerated. Continue with a new message.")
		}
		if req.RetryOfTurnID == "" {
			for _, attachment := range req.resolvedAttachments {
				if (!attachment.ExpiresAt.IsZero() && !time.Now().UTC().Before(attachment.ExpiresAt)) || publicChatAttachmentIsMember(session, attachment.ArtifactID) {
					r.svc.chatSurfaceMu.Unlock()
					return publicChatAnchorState{}, publicChatTurnState{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
				}
			}
		}
		before := *session
		versionBefore := r.svc.chatSurfaceVersion
		// K-AGCORE-147: the anchor no longer owns binding truth. Every turn
		// admission overwrites the session projection fields with the
		// admission-resolved bindings and the committed config revision.
		session.Binding = resolvedBindings[primaryCapability]
		session.Bindings = clonePublicChatExecutionBindings(resolvedBindings)
		session.ConfigRevision = configRevision
		if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" {
			session.SubjectUserID = trimmed
		}
		// app_id is retained only as last-turn-origin information. Conversation
		// delivery and authorization never target or partition by this field.
		if callerAppID != "" {
			session.CallerAppID = callerAppID
		}
		if req.MaxOutputTokens > 0 || session.MaxTokens == 0 {
			session.MaxTokens = req.MaxOutputTokens
		}
		if reasoning != nil || session.Reasoning == nil {
			session.Reasoning = clonePublicChatReasoningConfig(reasoning)
		}
		effectiveReasoning := clonePublicChatReasoningConfig(session.Reasoning)
		// Request-carried messages are current-turn input only. Runtime-owned
		// committed transcript is appended atomically at the message commit
		// point; caller history never reconciles, replaces, or extends it here.
		turnID := "agent_turn_" + ulid.Make().String()
		streamID := "agent_stream_" + ulid.Make().String()
		timelineStartedAt := time.Now()
		availableActions.FollowUpEnabled = lifeContactAllowed(r.svc.agents[localAgentRef], time.Now().UTC()) && req.RetryOfTurnID == ""
		turn := &publicChatTurnState{
			AgentCreatedAt:       cloneTimestamp(r.svc.agents[localAgentRef].Agent.GetCreatedAt()),
			ConversationAnchorID: session.ConversationAnchorID,
			TurnID:               turnID,
			RequestID:            req.RequestID,
			RetryOfTurnID:        req.RetryOfTurnID,
			StreamID:             streamID,
			AgentID:              session.AgentID,
			CallerAppID:          callerAppID,
			SubjectUserID:        session.SubjectUserID,
			ThreadID:             session.ThreadID,
			TimelineStartedAt:    timelineStartedAt,
			Origin:               publicChatTurnOriginUser,
			ConfigRevision:       configRevision,
			AvailableActions:     availableActions,
			Reasoning:            effectiveReasoning,
			BindingRelease:       bindingRelease,
		}

		if claim := req.followUpClaim; claim != nil {
			turn.Origin = publicChatTurnOriginFollowUp
			turn.ChainID = claim.ChainID
			turn.FollowUpDepth = claim.FollowUpDepth
			turn.MaxFollowUpTurns = claim.MaxFollowUpTurns
			turn.SourceTurnID = claim.SourceTurnID
			turn.SourceActionID = claim.SourceActionID
		}
		if claim := req.proactiveClaim; claim != nil {
			copy := *claim
			turn.ProactiveIntent = &copy
			turn.Origin = claim.Source
			turn.MemoryReadSet = req.proactiveMemoryReadSet
			turn.ConversationRead = req.proactiveConversationRead
		}
		if isProactiveOrigin(turn.Origin) {
			turn.BackgroundReleased = make(chan struct{})
			turn.AvailableActions.ImageGenerate = publicChatImageActionNotConfigured
		}
		turn.Projection = newPublicChatTurnProjection(turn)
		session.ActiveTurnID = turnID
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		session.UpdatedAt = time.Now().UTC()
		r.svc.chatTurns[turnID] = turn
		r.svc.chatActiveByAgent[localAgentRef] = turnID
		session.Recoveries = clonePublicChatRecoveries(session.Recoveries)
		if recovery := newPublicChatTurnRecovery(*turn, req, session); recovery != nil {
			session.Recoveries[turnID] = recovery
		}
		session.LatestAcceptedTurnID = turnID
		canceled := r.svc.chatFollowUps[session.PendingFollowUpID]
		if canceled != nil {
			delete(r.svc.chatFollowUps, canceled.FollowUpID)
		}
		session.PendingFollowUpID = ""
		// Keep the original caller context until new input is durably admitted.
		// A deduplicated read or Runtime-owned follow-up is not a new App commit.
		var commitErr error
		nextEntry := cloneAgentEntry(r.svc.agents[localAgentRef])
		var interactionHook runtimeAgentStateTxHook
		if turn.Origin == publicChatTurnOriginUser {
			if req.RetryOfTurnID == "" {
				nextEntry.Life.ContactSinceUser = false
				// A prepared check-in predates this real user input. It is not a
				// life intention and must not be delivered after the new reply.
				nextEntry.Life.cancelFreeIntents("contact")
				turn.AvailableActions.FollowUpEnabled = lifeContactAllowed(nextEntry, timelineStartedAt)
			}
			var completed []string
			completed, commitErr = nextEntry.Life.beginInteraction(turnID, timelineStartedAt, lifeEnabled(nextEntry), source.LifeWorldPaused)
			if commitErr == nil {
				interactionHook, commitErr = r.svc.lifeActivityMemoryTxHook(nextEntry, completed, timelineStartedAt)
			}
		}
		lifeHook := func(tx *sql.Tx) error {
			if err := persistAgentLifeTx(tx, localAgentRef, nextEntry.Life); err != nil {
				return err
			}
			if interactionHook != nil {
				return interactionHook(tx)
			}
			return nil
		}
		if commitErr == nil && req.localAppAdmission != nil {
			commitErr = r.svc.persistLocalAppConversationCommitLocked(parent, localappop.IngressConversationTurnSend, *req.localAppAdmission, session.ConversationAnchorID, lifeHook)
		} else if commitErr == nil {
			commitErr = r.svc.persistPublicChatSurfaceStateWithTxHookLocked(lifeHook, session.ConversationAnchorID)
		}
		if commitErr != nil {
			*session = before
			r.svc.chatSurfaceVersion = versionBefore
			delete(r.svc.chatTurns, turnID)
			delete(r.svc.chatActiveByAgent, localAgentRef)
			if canceled != nil {
				r.svc.chatFollowUps[canceled.FollowUpID] = canceled
			}
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, commitErr
		}
		r.svc.agents[localAgentRef] = nextEntry
		memoryReady = interactionHook != nil
		// Only accepted work outlives the RPC. Preserve authority values for Job
		// custody and the existing explicit Stop/provider timeout ownership.
		turnParent := context.WithoutCancel(parent)
		if req.backgroundAdmission != nil {
			turnParent = parent
		}
		turnCtx, cancel := context.WithCancel(turnParent)
		turn.Cancel = cancel
		if work := req.backgroundAdmission; work != nil {
			work.transferred = true
			delete(r.svc.backgroundByAgent, localAgentRef)
			turn.BackgroundReleased = work.done
			turn.Cancel = func() { cancel(); work.cancel() }
		}
		if req.followUpClaim == nil {
			turn.CanceledFollowUp = canceled
		}
		releaseUnclaimedBinding = nil
		snapshot := *session
		snapshot.CallerAppID = callerAppID
		snapshot.Reasoning = clonePublicChatReasoningConfig(effectiveReasoning)
		snapshot.CommittedTranscript = clonePublicChatCommittedTranscript(session.CommittedTranscript)
		turnSnapshot := *turn
		turnSnapshot.Reasoning = clonePublicChatReasoningConfig(turn.Reasoning)
		r.svc.chatSurfaceMu.Unlock()
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
	if session := r.svc.chatAnchors[trimmedAnchorID]; session != nil {
		if publishTerminal && turn != nil && turn.TerminalProjection != nil {
			terminal := clonePublicChatTurnProjectionState(turn.TerminalProjection)
			terminal.StreamSequence = turn.StreamSequence
			terminal.UpdatedAt = time.Now().UTC()
			if session.CompletedTurnSnapshots == nil {
				session.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
			}
			session.CompletedTurnSnapshots[trimmedTurnID] = terminal
			if session.ActiveTurnID == trimmedTurnID || session.LatestAcceptedTurnID == trimmedTurnID || session.LastTurnID == trimmedTurnID {
				session.LastTurnSnapshot = clonePublicChatTurnProjectionState(terminal)
				session.LastTurnID = trimmedTurnID
				if terminal.MessageID != "" {
					session.LastMessageID = terminal.MessageID
				}
			}
		}
		if session.ActiveTurnID == trimmedTurnID {
			session.ActiveTurnID = ""
			session.ActiveTurnSnapshot = nil
		}
		session.UpdatedAt = time.Now().UTC()
	}
	if turn != nil && strings.TrimSpace(r.svc.chatActiveByAgent[turn.AgentID]) == trimmedTurnID {
		delete(r.svc.chatActiveByAgent, turn.AgentID)
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState(trimmedAnchorID)

	if bindingRelease != nil {
		bindingRelease()
	}
	if turn != nil && turn.BackgroundReleased != nil {
		if turn.Cancel != nil {
			turn.Cancel()
		}
		close(turn.BackgroundReleased)
	}
	if turn != nil {
		r.svc.recordLifeInteractionRelease(turn.AgentID, turn.TurnID, time.Now().UTC())
	}
	r.svc.wakeDuePublicChatFollowUp(trimmedAnchorID)
}

func (r publicChatRuntime) finishTurnReservation(session publicChatAnchorState, turnID string) {
	if r.svc == nil {
		return
	}
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return
	}
	r.releaseTurnReservation(session.ConversationAnchorID, trimmedTurnID, true)
	r.setIdleIfTextUnclaimed(session, trimmedTurnID)
}

func (r publicChatRuntime) setIdleIfTextUnclaimed(session publicChatAnchorState, trimmedTurnID string) {
	// Serialize the old turn's final execution-state transition against a new
	// reserveTurn. A terminal callback may synchronously start the next turn;
	// in that case the newer reservation owns CHAT_ACTIVE and must not be
	// overwritten by this finalizer.
	r.svc.mu.Lock()
	r.svc.chatSurfaceMu.Lock()
	activeTurnID := strings.TrimSpace(r.svc.chatActiveByAgent[strings.TrimSpace(session.AgentID)])
	if activeTurnID != "" && activeTurnID != trimmedTurnID {
		r.svc.chatSurfaceMu.Unlock()
		r.svc.mu.Unlock()
		return
	}
	committedEvents, targetsByEvent, err := r.setExecutionStateWithOriginLocked(
		session.AgentID,
		"",
		"",
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
		stateEventOrigin{},
	)
	r.svc.chatSurfaceMu.Unlock()
	r.svc.mu.Unlock()
	if err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("set public chat agent idle state failed", "agent_id", session.AgentID, "turn_id", trimmedTurnID, "error", err)
		}
		return
	}
	r.svc.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
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
	turnID := firstNonEmpty(strings.TrimSpace(req.ExpectedTurnID), strings.TrimSpace(req.TurnID), session.ActiveTurnID)
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

// Releasing the text slot keeps the original turn, binding and cancellation
// scope alive until its independent media really terminates.
func (s *Service) releasePublicChatTextSlot(anchorID, turnID string) error {
	s.localAppConversationPublishMu.Lock()
	defer s.localAppConversationPublishMu.Unlock()
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	turn := s.chatTurns[turnID]
	if anchor == nil || turn == nil || anchor.ActiveTurnID != turnID || !publicChatHasCompleteAnswer(anchor, turnID) || s.agentTerminationFencedLocked(turn.AgentID) {
		s.chatSurfaceMu.Unlock()
		return localAppConversationOwnerUnavailable()
	}
	before := *anchor
	version := s.chatSurfaceVersion
	active := s.chatActiveByAgent[turn.AgentID]
	anchor.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(anchor.CompletedTurnSnapshots)
	if anchor.CompletedTurnSnapshots == nil {
		anchor.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
	}
	anchor.CompletedTurnSnapshots[turnID] = clonePublicChatTurnProjectionState(turn.Projection)
	anchor.ActiveTurnID = ""
	anchor.ActiveTurnSnapshot = nil
	if active == turnID {
		delete(s.chatActiveByAgent, turn.AgentID)
	}
	anchor.LocalAppSequence++
	err := s.persistPublicChatSurfaceStateLocked(anchorID)
	if err != nil {
		*anchor = before
		s.chatSurfaceVersion = version
		if active != "" {
			s.chatActiveByAgent[turn.AgentID] = active
		}
		s.chatSurfaceMu.Unlock()
		return err
	}
	state := s.localAppConversationStateLocked(anchor)
	event := &runtimev1.LocalAppConversationEvent{ConversationAnchorId: anchorID, Sequence: anchor.LocalAppSequence, Event: &runtimev1.LocalAppConversationEvent_StateChanged{StateChanged: state}}
	accountID := anchor.SubjectUserID
	s.chatSurfaceMu.Unlock()
	s.broadcastLocalAppConversationEvents(accountID, anchorID, []*runtimev1.LocalAppConversationEvent{event})
	return nil
}
