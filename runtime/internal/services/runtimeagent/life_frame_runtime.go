package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
)

func lifeEnabled(entry *agentEntry) bool {
	return entry != nil && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE && entry.Agent.GetAutonomy().GetEnabled() && autonomyMode(entry.Agent.GetAutonomy().GetConfig()) != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF
}

func lifePlanningInterval(entry *agentEntry) time.Duration {
	base := 2 * time.Hour
	switch autonomyMode(entry.Agent.GetAutonomy().GetConfig()) {
	case runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH:
		base = 30 * time.Minute
	case runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM:
		base = time.Hour
	}
	if minimum := entry.Agent.GetAutonomy().GetConfig().GetMinPlanningInterval(); minimum != nil && minimum.AsDuration() > base {
		base = minimum.AsDuration()
	}
	return base
}

func pacedLifePlanningInterval(entry *agentEntry, now time.Time) time.Duration {
	base := lifePlanningInterval(entry)
	autonomy := entry.Agent.GetAutonomy()
	budget := autonomy.GetConfig().GetDailyTokenBudget()
	if budget == 0 || autonomy.WindowStartedAt == nil {
		return base
	}
	end := autonomy.WindowStartedAt.AsTime().Add(24 * time.Hour)
	remaining := end.Sub(now)
	if remaining <= 0 {
		return base
	}
	estimate := max(entry.Life.LastPlanningTokens, int64(2048))
	slots := max((budget-autonomy.UsedTokensInWindow)/estimate, 1)

	return max(base, remaining/time.Duration(max(slots, 1)))
}

// @nimi-authority: rule.nimi.runtime.agent-life.timeline
// Sweeps do bounded owner work; inference never blocks other Agents.
func (s *Service) runLifeFrameSweep(ctx context.Context, now time.Time) error {
	s.mu.RLock()
	refs := make([]string, 0, len(s.agents))
	for ref := range s.agents {
		refs = append(refs, ref)
	}
	s.mu.RUnlock()
	sort.Strings(refs)
	var sweepErrors []error
	for _, ref := range refs {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(sweepErrors, err)...)
		}
		source, found := s.turnSourceView(ref)
		if !found {
			continue
		}
		var shouldPlan, shouldContact, delivered bool
		var proactive *lifeProactiveIntent
		s.cognitionMemoryOwnerLifecycleMu.Lock()
		err := s.mutateAgent(ref, func(entry *agentEntry) (outEvents []*runtimev1.AgentEvent, outHook runtimeAgentStateTxHook, outErr error) {
			beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
			hadCurrent := entry.Life.Current != nil
			defer func() {
				if outErr == nil {
					outEvents = append(outEvents, optionalEvents(budgetEventForTransition(ref, beforeBudget, entry.Agent.GetAutonomy(), now), s.syncLifePresentation(entry, hadCurrent, now))...)
				}
			}()
			advanceAutonomyWindow(entry, now)
			l := entry.Life
			shouldContact = lifeContactAllowed(entry, now) && !l.ContactNextAt.IsZero() && !now.Before(l.ContactNextAt)
			if source.WorldTimeDecodeFailure != "" {
				l.WaitReason = "source_snapshot_invalid"
				return nil, nil, nil
			}
			proactive = selectLifeProactive(entry, now)
			if i := l.Interaction; i != nil {
				if s.lifeInteractionBusy(ref) || now.Before(i.LastActivityAt.Add(lifeInteractionSilence)) {
					l.WaitReason = "interaction"
					return nil, nil, nil
				}
				if err := l.finishInteraction(now); err != nil {
					return nil, nil, err
				}
				// Valid retained coverage wins over a model call, even after new chat.
				if l.Current != nil || len(l.Future) > 0 {
					_, err := l.advance(now, source.LifeWorldPaused)
					return nil, nil, err
				}
			}
			if !lifeEnabled(entry) {
				return nil, nil, nil
			}
			if l.StartedAt.IsZero() {
				l.StartedAt = now
				l.SettledAt = now
				if err := l.changed(); err != nil {
					return nil, nil, err
				}
			}
			completed, err := l.advance(now, source.LifeWorldPaused)
			if err != nil {
				return nil, nil, err
			}

			proactive = selectLifeProactive(entry, now)
			hook, err := s.lifeActivityMemoryTxHook(entry, completed, now)
			if err != nil {
				return nil, nil, err
			}
			delivered = hook != nil
			if source.LifeWorldPaused {
				l.WaitReason = "world_paused"
				return nil, hook, nil
			}
			if entry.Agent.GetAutonomy().GetBudgetExhausted() {
				l.WaitReason = "budget_exhausted"
				return nil, hook, nil
			}
			if until := entry.Agent.GetAutonomy().GetSuspendedUntil(); until != nil && until.AsTime().After(now) {
				l.WaitReason = "suspended"
				return nil, hook, nil
			}
			minimum := 30 * time.Second
			if configured := entry.Agent.GetAutonomy().GetConfig().GetMinPlanningInterval(); configured != nil {
				minimum = max(minimum, configured.AsDuration())
			}
			shouldPlan = l.canPlanAt(now, source.LifeFlowRatio) && !now.Before(l.LastLifeAttempt.Add(minimum))
			return nil, hook, nil
		})
		s.cognitionMemoryOwnerLifecycleMu.Unlock()
		if err != nil {
			sweepErrors = append(sweepErrors, fmt.Errorf("maintain life for %s: %w", ref, err))
			continue
		}
		if delivered {
			s.triggerCognitionMemory(ref)
		}
		if proactive != nil {
			s.chatSurfaceMu.Lock()
			busy := s.localAgentExecutionBusyLocked(ref) || s.foregroundWaitingByAgent[ref] > 0
			s.chatSurfaceMu.Unlock()
			if !busy {
				intent := *proactive
				s.startPublicChatAsync(func() { s.launchLifeProactive(ref, intent) })
			}
			continue
		}
		if !shouldPlan && !shouldContact {
			continue
		}
		purpose := "life_planning"
		if !shouldPlan {
			purpose = "contact_judgment"
		}
		work := s.claimAgentBackgroundFor(ctx, ref, purpose)
		if work == nil {
			continue
		}
		s.lifeFrameWG.Add(1)
		go func() {
			defer s.lifeFrameWG.Done()
			defer s.releaseAgentBackground(ref, work)
			s.runLifeFramePlanning(work, ref, source, now)
		}()
	}
	return errors.Join(sweepErrors...)
}

func (s *Service) runLifeFramePlanning(work *agentBackgroundExecution, ref string, source localAgentTurnSourceViewV1, now time.Time) {
	entry, err := s.agentByID(ref)
	if err != nil || s.runtimeAccountProjection == nil {
		return
	}
	projection, ready := s.runtimeAccountProjection.AuthenticatedRuntimeProjection(work.ctx)
	if !ready || projection.GetAccountId() != entry.Agent.GetOwnerUserId() {
		// Account restoration is an eligibility condition, not a failed model
		// attempt. Leave the opportunity due so the existing sweep can resume.
		return
	}
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	entry, err = s.qualifyLifeState(work.ctx, ref)
	s.cognitionMemoryOwnerLifecycleMu.Unlock()
	if err != nil {
		entry, err = s.agentByID(ref)
		if err != nil {
			return
		}
		entry.Life.Explanation = nil
		entry.Life.MemoryReadSet = cognitionmemory.MemoryReadSet{}
		for _, a := range entry.Life.Activities {
			if len(a.MemoryRefs) > 0 {
				a.Title = "Activity"
				a.MemoryRefs = nil
			}
		}
		for _, f := range entry.Life.frames() {
			if len(f.MemoryRefs) > 0 {
				f.Title = "Activity"
				f.MemoryRefs = nil
			}
		}
	}
	if work.source != "contact_judgment" && !lifeEnabled(entry) {
		return
	}
	if work.source == "contact_judgment" && !lifeContactAllowed(entry, time.Now().UTC()) {
		return
	}
	ctx := executionintent.WithRuntimeAccountSubject(work.ctx, entry.Agent.GetOwnerUserId())
	binding, _, err := s.committedTextGenerateExecutionBinding(ref)
	if err != nil {
		s.recordLifePlanningFailure(work, entry, err, 0)
		return
	}
	outputCap := entry.Agent.GetAutonomy().GetConfig().GetMaxBackgroundOutputTokens()
	if outputCap == 0 {
		outputCap = lifeFrameDefaultOutputTokens
	}
	binding, release, err := s.resolvePublicChatTextExecutionBinding(ctx, entry.Agent.GetOwnerUserId(), binding, publicChatTurnRequestPayload{MaxOutputTokens: int32(outputCap)})
	if err != nil {
		s.recordLifePlanningFailure(work, entry, err, 0)
		return
	}
	if release != nil {
		defer release()
	}
	input := lifeFrameExecutionInput{Entry: entry, Source: source, Binding: binding, Now: now, RequestID: "life_" + ulid.Make().String(), Work: work, ContactOnly: work.source == "contact_judgment", Context: projectLifeContext(entry.Life, true, false, s.lifeConversationSelection(ref), now, source.LifeFlowRatio)}
	var omitSupplemental bool
	input.Transcript, input.TranscriptRead, omitSupplemental, err = s.lifeConversationInput(ref)
	if err != nil {
		s.recordLifePlanningFailure(work, entry, err, 0)
		return
	}
	// Conversation selection bounds the chat we actually consume. Its
	// supplemental-omission switch does not disable solitary life's own Memory.
	omitSupplemental = input.ContactOnly && omitSupplemental
	input.Context = projectLifeContext(entry.Life, !input.ContactOnly, omitSupplemental, input.TranscriptRead, now, source.LifeFlowRatio)
	input.Context.Planning = true
	if s.cognitionMemoryFacade != nil && !omitSupplemental {
		query := entry.Agent.GetDisplayName() + " ongoing activities interests"
		query += " " + input.Context.RecallQuery
		// Solitary work already has one cancelable 90s owner budget, including
		// model loading. Do not apply the foreground's index-only wait window
		// to embedding execution and repeatedly abort a cold model.
		recalled, recallErr := s.cognitionMemoryFacade.Recall(ctx, cognitionmemory.RecallIntent{IncludeRecentLife: true, LocalAgentRef: ref, Query: query, Limit: 8})
		if recallErr == nil {
			input.Memory, err = publicChatCognitionMemoryInputs(recalled.Hits)
			if err != nil {
				s.recordLifePlanningFailure(work, entry, err, 0)
				return
			}
			input.ReadSet = recalled.ReadSet
		}
	}
	input.ReadSet, input.Memory = mergeLifeReadSet(input.Context.CoreMemoryReadSet, input.ReadSet, input.Memory)
	if input.Context.Explanation != "" {
		merged, err := unionMemoryReadSet(input.ReadSet, input.Context.MemoryReadSet)
		if err != nil {
			input.Context.Explanation = ""
			input.Context.MemoryReadSet = cognitionmemory.MemoryReadSet{}
			input.Context.ExplanationConversationRead = nil
		} else {
			input.ReadSet = merged
		}
	}
	result, usage, err := s.executeLifeFrames(ctx, &input)
	if err != nil {

		s.recordLifePlanningFailure(work, entry, err, usage)
		return
	}
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	if len(input.ReadSet.Refs) > 0 {
		qualified, checkErr := s.cognitionMemoryFacade.QualifyReadSet(ctx, ref, input.ReadSet)
		if checkErr != nil || len(qualified) != len(input.ReadSet.Refs) {
			s.recordLifePlanningFailure(work, entry, fmt.Errorf("life Memory inputs changed"), usage)
			return
		}
	}
	err = s.commitLifeFramePlanning(work, input, result, usage)
	if err != nil {
		s.recordLifePlanningFailure(work, entry, err, usage)
	} else {
		s.triggerCognitionMemory(ref)
	}
}

func (s *Service) commitLifeFramePlanning(work *agentBackgroundExecution, input lifeFrameExecutionInput, result *lifeFrameResult, usage int64) error {
	ref := input.Entry.Agent.GetLocalAgentRef()
	now := time.Now().UTC()
	return s.mutateAgentWithPersistence(ref, func(current *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		if !proto.Equal(current.Agent.GetCreatedAt(), input.Entry.Agent.GetCreatedAt()) {
			return nil, nil, nil
		}
		beforeBudget := snapshotAutonomy(current.Agent.GetAutonomy())
		applyTokenUsage(current, usage, time.Now().UTC())
		budgetEvents := optionalEvents(budgetEventForTransition(ref, beforeBudget, current.Agent.GetAutonomy(), time.Now().UTC()))
		if usage > 0 {
			current.Life.LastPlanningTokens = usage
		}
		if work.ctx.Err() != nil || (!input.ContactOnly && !lifeEnabled(current)) || (!input.ContactOnly && current.Life.Revision != input.Entry.Life.Revision) || (input.ContactOnly && current.Life.ContactEpoch != input.Entry.Life.ContactEpoch) {
			return budgetEvents, nil, nil
		}
		l := current.Life
		if input.ContactOnly {
			// Generation was admitted before spending this usage. Exhausting
			// its allowance must not discard the paid message or no-send.
			if !lifeContactPermitted(current, now) {
				return budgetEvents, nil, nil
			}
			l.ContactConsideredAt = input.Now
			l.ContactNextAt = now.Add(6 * time.Hour)
			if result.Contact != "" {
				l.Intents = append(l.Intents, lifeProactiveIntent{ID: "intent_" + ulid.Make().String(), Source: "contact", DueAt: now, ExpiresAt: now.Add(30 * time.Minute), Text: result.Contact, MemoryRefs: append([]string(nil), input.ReadSet.Refs...), ConversationRead: input.ConversationRead})
				stored, err := unionStoredMemoryReadSets(l.MemoryReadSet, input.ReadSet)
				if err != nil {
					return nil, nil, err
				}
				l.MemoryReadSet = stored
			}
			if err := l.changed(); err != nil {
				return nil, nil, err
			}
			return budgetEvents, func(tx *sql.Tx) error {
				if err := work.ctx.Err(); err != nil {
					return err
				}
				if work.invalidated || s.backgroundByAgent[ref] != work || !s.lifeConversationReadCurrentLocked(input.ConversationRead) {
					return fmt.Errorf("contact source invalidated")
				}
				return nil
			}, nil
		}
		if input.PastFrom.After(l.SettledAt) {
			l.SettledAt = input.PastFrom
		}
		completed, err := l.acceptPast(result.Past, input.Now, input.Source.LifeFlowRatio, input.ReadSet.Refs, input.ConversationRead != nil)
		if err != nil {
			return nil, nil, err
		}
		var intentionHook runtimeAgentStateTxHook
		intentionAccepted := false
		if raw := strings.TrimSpace(string(result.SelfIntention)); raw != "" && raw != "null" {
			proposal, invalid := decodeSelfIntention(raw)
			if invalid == nil && (proposal.Action == "change" || proposal.Action == "abandon") {
				next := cloneAgentLifeState(l)
				accepted, acceptErr := acceptSelfIntention(next, proposal, now)
				if acceptErr == nil {
					current.Life, l = next, next
					intentionAccepted = true
					intentionHook, err = s.selfIntentionMemoryTxHook(current, proposal, accepted, input.RequestID, now)
					if err != nil {
						return nil, nil, err
					}
				}
			}
			if !intentionAccepted {
				// New dependent proposals cannot assume a rejected mutation.
				// Previously accepted unrelated future stays untouched.
				copy := *result
				copy.Future, copy.Explanation, copy.Contact = nil, "", ""
				result = &copy
			}
		}
		if len(result.Future) > 0 {
			if err := l.acceptFuture(result.Future, now, input.Source.LifeFlowRatio, input.ReadSet.Refs, input.ConversationRead != nil); err != nil {
				return nil, nil, err
			}
		}
		if _, err := l.advance(now, false); err != nil {
			return nil, nil, err
		}
		oldFrames := map[string]bool{}
		for _, f := range input.Entry.Life.frames() {
			oldFrames[f.ID] = true
		}
		for _, f := range l.frames() {
			if !oldFrames[f.ID] {
				f.ConversationRead = input.ConversationRead
			}
		}
		storedRead, mergeErr := unionStoredMemoryReadSets(l.MemoryReadSet, input.ReadSet)
		if mergeErr != nil {
			return nil, nil, mergeErr
		}
		l.MemoryReadSet = storedRead
		l.Explanation = nil
		if text := strings.TrimSpace(result.Explanation); text != "" {
			l.Explanation = &lifeExplanation{Text: text, MemoryRefs: append([]string(nil), input.ReadSet.Refs...), ConversationRead: input.ConversationRead}
		}
		l.NextCheckAt = now.Add(max(pacedLifePlanningInterval(current, now), time.Duration(result.NextCheckMinutes)*time.Minute))
		if current.Life.ContactEpoch == input.Entry.Life.ContactEpoch && lifeContactPermitted(current, now) && lifeContactAllowed(input.Entry, input.Now) &&
			!input.Entry.Life.ContactNextAt.IsZero() && !input.Entry.Life.ContactNextAt.After(input.Now) {
			// A due contact opportunity was already considered by this joint
			// generation, including no-send. Do not immediately ask again.
			l.ContactConsideredAt = input.Now
			l.ContactNextAt = now.Add(6 * time.Hour)
		}
		if intentionAccepted && l.Current == nil {
			l.NextCheckAt = now
		}
		l.WaitReason = ""
		if result.Contact != "" && current.Life.ContactEpoch == input.Entry.Life.ContactEpoch && lifeContactAllowed(current, now) {
			activityRef := ""
			if l.Current != nil {
				activityRef = l.Current.ActivityRef
			} else if len(completed) > 0 {
				for _, frame := range l.Recent {
					if frame.ID == completed[len(completed)-1] {
						activityRef = frame.ActivityRef
					}
				}
			}
			if activityRef != "" {
				l.cancelFreeIntents("life")
				l.Intents = append(l.Intents, lifeProactiveIntent{ID: "intent_" + ulid.Make().String(), Source: "life", ActivityRef: activityRef, DueAt: now, Purpose: result.Contact, ExpiresAt: now.Add(lifePlanningInterval(current)), MemoryRefs: append([]string(nil), input.ReadSet.Refs...), ConversationRead: input.ConversationRead})
			}
		}
		if err := l.changed(); err != nil {
			return nil, nil, err
		}
		hook, err := s.lifeActivityMemoryTxHook(current, completed, time.Now().UTC())
		if err != nil {
			return nil, nil, err
		}
		return append(budgetEvents, optionalEvents(s.syncLifePresentation(current, false, now))...), func(tx *sql.Tx) error {
			if err := work.ctx.Err(); err != nil {
				return err
			}
			// mutateAgent holds chatSurfaceMu through commit, ordered with yield.
			if work.invalidated || s.backgroundByAgent[ref] != work || !s.lifeConversationReadCurrentLocked(input.ConversationRead) {
				return fmt.Errorf("life planning yielded to foreground")
			}
			if hook != nil {
				if err := hook(tx); err != nil {
					return err
				}
			}
			if intentionHook != nil {
				return intentionHook(tx)
			}
			return nil
		}, nil
	}, func(entry *agentEntry, events []*runtimev1.AgentEvent, sequence uint64, hook runtimeAgentStateTxHook) error {
		if hook == nil {
			// Actual usage remains accountable after cancellation. This branch
			// carries no new life or contact effects.
			return s.stateRepo.persistAgentDelta(entry, events, sequence, nil)
		}
		return s.stateRepo.persistAgentDeltaContext(work.ctx, entry, events, sequence, hook)
	})
}

func (s *Service) recordLifePlanningFailure(work *agentBackgroundExecution, attempt *agentEntry, cause error, usage int64) {
	ref, revision := attempt.Agent.GetLocalAgentRef(), attempt.Life.Revision
	now := time.Now().UTC()
	err := s.mutateAgent(ref, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		if !proto.Equal(entry.Agent.GetCreatedAt(), attempt.Agent.GetCreatedAt()) {
			return nil, nil, nil
		}
		before := snapshotAutonomy(entry.Agent.GetAutonomy())
		applyTokenUsage(entry, usage, now)
		if usage > 0 {
			entry.Life.LastPlanningTokens = usage
		}
		budgetEvents := optionalEvents(budgetEventForTransition(ref, before, entry.Agent.GetAutonomy(), now))
		contact := work.source == "contact_judgment"
		if work.ctx.Err() == context.Canceled ||
			contact && (!entry.Agent.GetAutonomy().GetConfig().GetFreeContactEnabled() || entry.Life.ContactEpoch != attempt.Life.ContactEpoch) ||
			!contact && (!lifeEnabled(entry) || entry.Life.Revision != revision) {
			return budgetEvents, nil, nil
		}
		var allowance *lifeBudgetUnavailable
		if errors.As(cause, &allowance) {
			entry.Life.WaitReason = "budget_exhausted"
			nextWindow := entry.Agent.GetAutonomy().GetWindowStartedAt().AsTime().Add(24 * time.Hour)
			if contact {
				entry.Life.ContactNextAt = nextWindow
				entry.Life.ContactBudgetWaiting = true
			} else {
				entry.Life.NextCheckAt = nextWindow
				entry.Life.LifeBudgetWaiting = true
			}
			if allowance.minimum {
				entry.Life.WaitReason = "budget_insufficient"
			}
			return optionalEvents(budgetEventForTransition(ref, before, entry.Agent.GetAutonomy(), now)), nil, nil
		}
		if work.source == "contact_judgment" {
			entry.Life.ContactNextAt = maxTime(entry.Life.ContactNextAt, now.Add(30*time.Minute))
			return optionalEvents(budgetEventForTransition(ref, before, entry.Agent.GetAutonomy(), now)), nil, nil
		}
		if work.ctx.Err() != context.Canceled && entry.Life.Revision == revision && lifeEnabled(entry) {
			entry.Life.NextCheckAt = now.Add(pacedLifePlanningInterval(entry, now))
			entry.Life.WaitReason = "planning_unavailable"
		}
		return optionalEvents(budgetEventForTransition(ref, before, entry.Agent.GetAutonomy(), now)), nil, nil
	})
	if s.logger != nil && cause != nil && (work.ctx.Err() != context.Canceled || err != nil) {
		s.logger.Warn("life planning unavailable", "local_agent_ref", ref, "error", cause, "accounting_error", err)
	}
}
