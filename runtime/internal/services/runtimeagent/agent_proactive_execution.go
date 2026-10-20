package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/protobuf/proto"
)

func isProactiveOrigin(origin string) bool {
	return origin == publicChatTurnOriginFollowUp || origin == "life" || origin == "contact"
}

func (s *Service) accountProactiveUsage(turn publicChatTurnState, usage *runtimev1.UsageStats) {
	now := time.Now().UTC()
	err := s.mutateAgent(turn.AgentID, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		if !proto.Equal(e.Agent.GetCreatedAt(), turn.AgentCreatedAt) {
			return nil, nil, nil
		}
		before := snapshotAutonomy(e.Agent.GetAutonomy())
		applyTokenUsage(e, addNonNegativeUsage(usage.GetInputTokens(), usage.GetOutputTokens()), now)
		if turn.ProactiveIntent != nil {
			for i := range e.Life.Intents {
				if e.Life.Intents[i].ID == turn.ProactiveIntent.ID {
					e.Life.Intents[i].DueAt = now.Add(5 * time.Minute)
				}
			}
		}
		return optionalEvents(budgetEventForTransition(turn.AgentID, before, e.Agent.GetAutonomy(), now)), nil, nil
	})
	if err != nil && s.logger != nil {
		s.logger.Warn("background Conversation accounting failed", "error", err)
	}
}

func selectLifeProactive(entry *agentEntry, now time.Time) *lifeProactiveIntent {
	kept := entry.Life.Intents[:0]
	for _, intent := range entry.Life.Intents {
		if intent.ExpiresAt.IsZero() || !now.After(intent.ExpiresAt) {
			kept = append(kept, intent)
		}
	}
	entry.Life.Intents = kept
	var selected *lifeProactiveIntent
	for _, intent := range kept {
		if validLifeProactiveClaim(entry, &intent, now) && (selected == nil || intent.DueAt.Before(selected.DueAt)) {
			copy := intent
			selected = &copy
		}
	}
	return selected
}

func validLifeProactiveClaim(entry *agentEntry, claim *lifeProactiveIntent, now time.Time) bool {
	if entry == nil || entry.Life == nil || claim == nil || entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return false
	}
	for _, intent := range entry.Life.Intents {
		if intent.ID != claim.ID || intent.Source != claim.Source || intent.DueAt.After(now) || !intent.ExpiresAt.IsZero() && now.After(intent.ExpiresAt) {
			continue
		}
		if intent.Source == "life" {
			a := entry.Life.Activities[intent.ActivityRef]
			if a == nil || a.Phase == lifeCanceled {
				return false
			}
		}
		if intent.Source == "contact" {
			return intent.Text != "" && lifeContactPermitted(entry, now)
		}
		return lifeContactAllowed(entry, now)
	}
	return false
}

// @nimi-authority: rule.nimi.runtime.agent-life.proactive-execution
func (s *Service) launchLifeProactive(ref string, intent lifeProactiveIntent) {
	work := s.claimAgentBackgroundFor(s.publicChatAsyncLifetime(), ref, intent.Source)
	if work == nil {
		return
	}
	defer s.releaseAgentBackground(ref, work)
	if s.runtimeAccountProjection == nil {
		return
	}
	projection, ok := s.runtimeAccountProjection.AuthenticatedRuntimeProjection(work.ctx)
	if !ok {
		return
	}
	entry, err := s.agentByID(ref)
	if err != nil || entry.Agent.GetOwnerUserId() != projection.GetAccountId() || !validLifeProactiveClaim(entry, &intent, time.Now().UTC()) {
		return
	}
	selection := s.lifeConversationSelection(ref)
	s.chatSurfaceMu.Lock()
	work.conversationRead = projectConversationRead(intent.ConversationRead, selection)
	s.chatSurfaceMu.Unlock()
	if !sourceConversationAllowed(intent.ConversationRead, selection) {
		_ = s.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			kept := e.Life.Intents[:0]
			for _, item := range e.Life.Intents {
				if item.ID != intent.ID {
					kept = append(kept, item)
				}
			}
			e.Life.Intents = kept
			return nil, nil, nil
		})
		return
	}
	read := subsetMemoryReadSet(entry.Life.MemoryReadSet, intent.MemoryRefs)
	if len(read.Refs) > 0 {
		if s.cognitionMemoryFacade == nil {
			return
		}
		s.cognitionMemoryOwnerLifecycleMu.Lock()
		qualified, qualifyErr := s.cognitionMemoryFacade.QualifyReadSet(work.ctx, ref, read)
		if qualifyErr == nil && len(qualified) != len(read.Refs) {
			invalid := map[string]bool{}
			for _, id := range read.Refs {
				if !qualified[id] {
					invalid[id] = true
				}
			}
			qualifyErr = s.invalidateLifeMemorySources(ref, invalid, false)
		}
		s.cognitionMemoryOwnerLifecycleMu.Unlock()
		if qualifyErr != nil || len(qualified) != len(read.Refs) {
			return
		}
	}
	identity, err := validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), ref)
	if err != nil {
		return
	}
	opened, err := s.ensureAgentConversation(identity, "", "", nil)
	if err != nil {
		return
	}
	anchorID := opened.GetSnapshot().GetAnchor().GetConversationAnchorId()
	ctx := executionintent.WithRuntimeAccountSubject(work.ctx, identity.OwnerUserID)
	if intent.Source == "contact" {
		err = s.commitGeneratedContact(ctx, identity, anchorID, work, intent, read)
		if err != nil && s.logger != nil {
			s.logger.Warn("generated contact not committed", "error", err)
		}
		return
	}
	cap := entry.Agent.GetAutonomy().GetConfig().GetMaxBackgroundOutputTokens()
	if cap == 0 {
		cap = lifeFrameDefaultOutputTokens
	}
	instruction := "Runtime authorized proactive expression. Source: " + intent.Source + ". Express this once: " + intent.Purpose + ". This is not a user turn. Do not create user tasks or modify configuration. Do not claim a message was previously delivered."
	if a := entry.Life.Activities[intent.ActivityRef]; a != nil {
		instruction += " The source activity is currently " + string(a.Phase) + ". The expression intent is older than this state; adjust tense to the actual state."
	}

	_, err = s.publicChatRuntime().handleTurnRequestWithID(ctx, &runtimev1.AppMessageEvent{SubjectUserId: identity.OwnerUserID, MessageId: intent.ID}, publicChatTurnRequestPayload{backgroundAdmission: work, LocalAgentRef: ref, OwnerUserID: identity.OwnerUserID, RuntimeSourceRef: identity.RuntimeSourceRef, ConversationAnchorID: anchorID, RequestID: intent.ID, Messages: publicChatFollowUpInstructionInput(instruction), MaxOutputTokens: int32(cap), proactiveClaim: &intent, proactiveMemoryReadSet: read, proactiveConversationRead: projectConversationRead(intent.ConversationRead, selection)})
	if err != nil && s.logger != nil {
		s.logger.Warn("proactive expression not admitted", "error", err)
	}
}

// @nimi-authority: rule.nimi.runtime.agent-life.proactive-execution
// Contact-only generation has already produced and paid for this message.
// Reuse Conversation admission and its atomic source/contact/Memory commit;
// there is no second model execution or simulated stream here.
func (s *Service) commitGeneratedContact(ctx context.Context, identity localAgentIdentity, anchorID string, work *agentBackgroundExecution, intent lifeProactiveIntent, read cognitionmemory.MemoryReadSet) (err error) {
	text, ok := publicChatPlainReplyText(intent.Text)
	if !ok {
		return fmt.Errorf("generated contact has no public text")
	}
	req := publicChatTurnRequestPayload{
		backgroundAdmission: work, LocalAgentRef: identity.LocalAgentRef,
		OwnerUserID: identity.OwnerUserID, RuntimeSourceRef: identity.RuntimeSourceRef,
		ConversationAnchorID: anchorID, RequestID: intent.ID,
		Messages:       publicChatFollowUpInstructionInput("Runtime generated contact."),
		proactiveClaim: &intent, proactiveMemoryReadSet: read,
		proactiveConversationRead: projectConversationRead(intent.ConversationRead, s.lifeConversationSelection(identity.LocalAgentRef)),
	}
	runtime := s.publicChatRuntime()
	session, turn, turnCtx, err := runtime.reserveTurn(ctx, "", identity.OwnerUserID, req)
	if err != nil || turn.AdmissionReused {
		return err
	}
	structured := &publicChatStructuredEnvelope{SchemaID: publicChatStructuredSchemaID, Message: publicChatStructuredMessage{Text: text}}
	assignPublicChatOutputIdentities(structured, turn.TurnID)
	finish := &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}
	outcome := &publicChatPostTurnOutcome{FollowUp: publicChatFollowUpOutcome{Status: "skipped"}}
	committed := false
	defer func() {
		if err != nil && !committed {
			if turnCtx.Err() != nil {
				s.finalizePublicChatTurnProjection(turn.TurnID, true, func(p *publicChatTurnProjectionState) { p.Status = publicChatTurnStatusInterrupted })
				runtime.emitTurnInterrupted(session, turn, "", "", 0, "background_cancel")
			} else {
				runtime.failUncommittedPublicChatTurn(session, turn, "", "", 0, nil, nil, finish, runtimev1.ReasonCode_AI_STREAM_BROKEN, err.Error())
			}
		} else if err != nil {
			runtime.completeCommittedPublicChatTurnWithDiagnostic(session, turn, "", "", 0, structured, nil, finish, outcome, runtimev1.ReasonCode_AI_STREAM_BROKEN, err.Error())
		}
		runtime.finishTurnReservation(session, turn.TurnID)
	}()
	if err = runtime.emitTurnEvent(session, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(intent.ID)); err != nil {
		return err
	}
	if err = runtime.emitTurnEvent(session, turn.TurnID, publicChatTurnStartedType, map[string]any{}); err != nil {
		return err
	}
	err = s.commitPublicChatFollowUpTranscriptWithProjection(turnCtx, anchorID, turn.TurnID, req.Messages[0].Content, text, func(p *publicChatTurnProjectionState) {
		applyCommittedPublicChatMessageProjection(p, "", "", 0, structured, nil, finish, outcome)
	})
	if err != nil {
		return err
	}
	committed = true
	if err = runtime.emitTurnMessageCommitted(session, turn.TurnID, structured.Message.MessageID, text); err != nil {
		return err
	}
	if err = s.releasePublicChatTextSlot(anchorID, turn.TurnID); err != nil {
		return err
	}
	runtime.setIdleIfTextUnclaimed(session, turn.TurnID)
	runtime.projectCommittedConversationVoice(turnCtx, session, turn, structured)
	s.finalizePublicChatTurnProjection(turn.TurnID, true, func(p *publicChatTurnProjectionState) {
		applyCompletedPublicChatTurnProjection(p, "", "", 0, structured, nil, finish, outcome)
	})
	return runtime.emitTurnEvent(session, turn.TurnID, publicChatTurnCompletedType, publicChatTurnCompletedDetail(runtimev1.FinishReason_FINISH_REASON_STOP))
}

// Caller holds Agent and Conversation commit locks. The returned state is
// published only after the same transaction persists the assistant message.
func (s *Service) prepareProactiveMessageCommit(entry *agentEntry, turn *publicChatTurnState, now time.Time) (*agentEntry, runtimeAgentStateTxHook, error) {
	if turn == nil || !isProactiveOrigin(turn.Origin) {
		return nil, nil, nil
	}
	if entry == nil {
		return nil, nil, fmt.Errorf("proactive Agent unavailable")
	}
	next := cloneAgentEntry(entry)
	if claim := turn.ProactiveIntent; claim != nil {
		if !validLifeProactiveClaim(next, claim, now) {
			return nil, nil, fmt.Errorf("proactive source changed before message commit")
		}
		out := next.Life.Intents[:0]
		for _, intent := range next.Life.Intents {
			if intent.ID != claim.ID {
				out = append(out, intent)
			}
		}
		next.Life.Intents = out

	}
	{
		if !lifeContactPermitted(next, now) {
			return nil, nil, fmt.Errorf("free contact is no longer permitted")
		}
		kept := next.Life.ContactTimes[:0]
		for _, at := range next.Life.ContactTimes {
			if at.After(now.Add(-24 * time.Hour)) {
				kept = append(kept, at)
			}
		}
		next.Life.ContactTimes = append(kept, now)
		next.Life.ContactSinceUser = true
	}
	return next, func(tx *sql.Tx) error { return persistAgentLifeTx(tx, entry.Agent.GetLocalAgentRef(), next.Life) }, nil
}
