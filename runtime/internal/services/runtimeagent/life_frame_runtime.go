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
	for _, ref := range refs {
		if err := ctx.Err(); err != nil {
			return err
		}
		source, found := s.turnSourceView(ref)
		if !found {
			continue
		}
		var shouldPlan bool
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
			if source.WorldTimeDecodeFailure != "" {
				l.WaitReason = "source_snapshot_invalid"
				return nil, nil, nil
			}
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
			_, err := l.advance(now, source.LifeWorldPaused)
			if err != nil {
				return nil, nil, err
			}

			if source.LifeWorldPaused {
				l.WaitReason = "world_paused"
				return nil, nil, nil
			}
			if entry.Agent.GetAutonomy().GetBudgetExhausted() {
				l.WaitReason = "budget_exhausted"
				return nil, nil, nil
			}
			if until := entry.Agent.GetAutonomy().GetSuspendedUntil(); until != nil && until.AsTime().After(now) {
				l.WaitReason = "suspended"
				return nil, nil, nil
			}
			minimum := 30 * time.Second
			if configured := entry.Agent.GetAutonomy().GetConfig().GetMinPlanningInterval(); configured != nil {
				minimum = max(minimum, configured.AsDuration())
			}
			shouldPlan = l.canPlanAt(now, source.LifeFlowRatio) && !now.Before(l.LastLifeAttempt.Add(minimum))
			return nil, nil, nil
		})
		s.cognitionMemoryOwnerLifecycleMu.Unlock()
		if err != nil {
			return err
		}

		if !shouldPlan {
			continue
		}
		purpose := "life_planning"

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
	return nil
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
	if !lifeEnabled(entry) {
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
	input := lifeFrameExecutionInput{Entry: entry, Source: source, Binding: binding, Now: now, RequestID: "life_" + ulid.Make().String(), Work: work, Context: projectLifeContext(entry.Life, true, false, s.lifeConversationSelection(ref), now, source.LifeFlowRatio)}

	if s.cognitionMemoryFacade != nil {
		query := entry.Agent.GetDisplayName() + " ongoing activities interests"
		query += " " + input.Context.RecallQuery
		optional, cancel := context.WithTimeout(ctx, publicChatOptionalContextBudget)
		recalled, recallErr := s.cognitionMemoryFacade.Recall(optional, cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: query, Limit: 8})
		cancel()
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
	}
}

func (s *Service) commitLifeFramePlanning(work *agentBackgroundExecution, input lifeFrameExecutionInput, result *lifeFrameResult, usage int64) error {
	ref := input.Entry.Agent.GetLocalAgentRef()
	now := time.Now().UTC()
	return s.mutateAgent(ref, func(current *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		if !proto.Equal(current.Agent.GetCreatedAt(), input.Entry.Agent.GetCreatedAt()) {
			return nil, nil, nil
		}
		beforeBudget := snapshotAutonomy(current.Agent.GetAutonomy())
		applyTokenUsage(current, usage, time.Now().UTC())
		budgetEvents := optionalEvents(budgetEventForTransition(ref, beforeBudget, current.Agent.GetAutonomy(), time.Now().UTC()))
		if usage > 0 {
			current.Life.LastPlanningTokens = usage
		}
		if work.ctx.Err() != nil || !lifeEnabled(current) || current.Life.Revision != input.Entry.Life.Revision {
			return budgetEvents, nil, nil
		}
		l := current.Life

		if input.PastFrom.After(l.SettledAt) {
			l.SettledAt = input.PastFrom
		}
		_, err := l.acceptPast(result.Past, input.Now, input.Source.LifeFlowRatio, input.ReadSet.Refs, input.ConversationRead != nil)
		if err != nil {
			return nil, nil, err
		}
		if len(result.Future) > 0 {
			if err := l.acceptFuture(result.Future, now, input.Source.LifeFlowRatio, input.ReadSet.Refs, input.ConversationRead != nil); err != nil {
				return nil, nil, err
			}
		}
		if _, err := l.advance(now, false); err != nil {
			return nil, nil, err
		}
		for ref, a := range l.Activities {
			if input.Entry.Life.Activities[ref] == nil {
				a.ConversationRead = input.ConversationRead
			}
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
		l.WaitReason = ""

		if err := l.changed(); err != nil {
			return nil, nil, err
		}
		return append(budgetEvents, optionalEvents(s.syncLifePresentation(current, false, now))...), func(tx *sql.Tx) error {
			// mutateAgent holds chatSurfaceMu through commit, ordered with yield.
			if work.invalidated || s.backgroundByAgent[ref] != work || !s.lifeConversationReadCurrentLocked(input.ConversationRead) {
				return fmt.Errorf("life planning yielded to foreground")
			}
			return nil
		}, nil
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
